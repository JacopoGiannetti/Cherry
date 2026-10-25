import Foundation
import SwiftUI
import FirebaseFirestore

// Stato vivo di uno swap (§6): avvia l'import, osserva il documento
// su Firestore mentre il backend estrae e costruisce il ledger,
// gestisce il ciclo delle alternative e il finalize.
@MainActor
final class SwapStore: ObservableObject, Identifiable {
    let uid: String
    let jobs: JobClient
    let swapId: String

    @Published var swap: Swap?
    @Published var errorMessage: String?
    /// Per ogni riga non compatibile, l'indice del sostituto scelto
    /// (il tap cicla le alternative).
    @Published var chosenIndexes: [String: Int] = [:]
    @Published var finalizing = false
    /// Obiettivo appena chiesto, finché il server non comincia a lavorarci:
    /// senza, per un attimo ricomparirebbe la schermata di prima.
    @Published private(set) var pendingGoal: SwapGoal?
    @Published private(set) var didSave = false
    /// Da quando si aspetta: lettura della ricetta, poi riscrittura.
    /// Fa partire la percentuale del caricamento.
    @Published private(set) var loadingStartedAt = Date()

    /// Si parte dalle sostituzioni invece che dalla ricetta com'è: chi
    /// arriva da una ricetta già salvata l'originale l'ha già davanti.
    var opensOnSwaps = false

    /// Ricetta salvata, col link da cui era arrivata: chi ha aperto lo
    /// swap toglie quel link dai pending.
    var onSaved: ((String) -> Void)?

    private var listener: ListenerRegistration?
    private var jobListener: ListenerRegistration?

    init(uid: String, jobs: JobClient, swapId: String = UUID().uuidString) {
        self.uid = uid
        self.jobs = jobs
        self.swapId = swapId
    }

    deinit {
        listener?.remove()
        jobListener?.remove()
    }

    func listen() {
        listener = FirestoreService.listenDocument("users/\(uid)/swaps/\(swapId)", as: Swap.self) { [weak self] swap in
            guard let self else { return }
            self.swap = swap
            // Finalize finisce solo quando la foto è pronta (o non c'è).
            if swap?.status == "finalized" { self.finalizing = false }
            if swap?.status == "generating_photo" { self.finalizing = true }
            if let pending = self.pendingGoal, swap?.goal == pending.rawValue,
               swap?.status == "building_ledger" || swap?.status == "ledger_ready" {
                self.pendingGoal = nil
            }
        }
    }

    /// Osserva il job avviato: se fallisce lato server, l'errore emerge
    /// qui invece di lasciare la schermata congelata.
    private func watchJob(_ jobId: String) {
        jobListener?.remove()
        jobListener = FirestoreService.listenDocument("users/\(uid)/jobs/\(jobId)", as: Job.self) { [weak self] job in
            guard let job, job.status == .error else { return }
            self?.errorMessage = job.errorMessage ?? "Something went wrong. Try again."
            self?.finalizing = false
            self?.pendingGoal = nil
        }
    }

    // MARK: - Obiettivo

    /// Ricostruisce il ledger per un altro obiettivo sulla ricetta già letta.
    func requestLedger(_ goal: SwapGoal) async {
        if swap?.goal == goal.rawValue, swap?.status == "ledger_ready" { return }
        pendingGoal = goal
        chosenIndexes = [:]
        loadingStartedAt = Date()
        Analytics.log("swap_goal", ["goal": goal.rawValue])
        do {
            let jobId = try await jobs.start("/swap/ledger", body: [
                "swapId": swapId,
                "goal": goal.rawValue,
            ])
            watchJob(jobId)
        } catch {
            pendingGoal = nil
            errorMessage = error.localizedDescription
        }
    }

    func startImport(source: [String: Any]) async {
        loadingStartedAt = Date()
        listen()
        Analytics.log("swap_imported", ["source": (source["type"] as? String) ?? "unknown"])
        do {
            let jobId = try await jobs.start("/swap/import", body: [
                "swapId": swapId,
                "source": source,
            ])
            watchJob(jobId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Ledger

    func chosenSubstitute(for line: LedgerLine) -> SubstituteOption? {
        guard !line.isCompatible, !line.substitutes.isEmpty else { return nil }
        let index = chosenIndexes[line.originalName] ?? 0
        return line.substitutes[index % line.substitutes.count]
    }

    /// Tap sul sostituto → cicla le alternative (§6).
    func cycle(_ line: LedgerLine) {
        guard !line.substitutes.isEmpty else { return }
        let current = chosenIndexes[line.originalName] ?? 0
        chosenIndexes[line.originalName] = (current + 1) % line.substitutes.count
    }

    // MARK: - Make it mine

    func finalize() async {
        guard let ledger = swap?.ledger else { return }
        // Resta true finché il listener non vede status "finalized"
        // (o il job fallisce): la riscrittura richiede decine di secondi.
        finalizing = true
        loadingStartedAt = Date()

        let chosen: [[String: Any]] = ledger.compactMap { line in
            guard let substitute = chosenSubstitute(for: line) else { return nil }
            return [
                "originalName": line.originalName,
                "substituteName": substitute.name,
                "quantity": substitute.quantity,
            ]
        }
        do {
            let jobId = try await jobs.start("/swap/finalize", body: [
                "swapId": swapId,
                "chosen": chosen,
            ])
            watchJob(jobId)
        } catch {
            errorMessage = error.localizedDescription
            finalizing = false
        }
    }

    // MARK: - Salvataggio nella collezione

    func saveFinalRecipe() {
        guard let recipe = swap?.finalRecipe else { return }
        persistRecipe(recipe, origin: "swap")
    }

    /// Salva la ricetta originale senza passare dal finalize.
    func saveOriginalRecipe() {
        guard let original = swap?.original else { return }
        persistRecipe(original, origin: "imported", fallbackImage: swap?.source?.thumbnail)
    }

    private func persistRecipe(_ recipe: SwapRecipe, origin: String, fallbackImage: String? = nil) {
        // Stella e pulsante finale portano allo stesso salvataggio:
        // senza questo l'utente si ritrova la ricetta doppia.
        guard !didSave else { return }
        didSave = true

        var payload: [String: Any] = [
            "title": recipe.title,
            "oneLiner": recipe.oneLiner ?? "",
            "cuisine": recipe.cuisine ?? "",
            "costUsd": recipe.costUsd ?? 0,
            "cookMinutes": recipe.cookMinutes,
            "servings": recipe.servings,
            "steps": recipe.steps,
            "origin": origin,
        ]
        if let imageUrl = recipe.imageUrl ?? fallbackImage { payload["imageUrl"] = imageUrl }
        if origin == "swap", let goal = swap?.goal { payload["swapGoal"] = goal }
        // Il link d'origine viaggia col salvataggio: dal dettaglio si
        // potrà riaprire il post, e veganizzare dopo un "Save as is".
        if let sourceUrl = swap?.source?.url { payload["sourceUrl"] = sourceUrl }
        if let data = try? JSONEncoder().encode(recipe.ingredients),
           let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            payload["ingredients"] = array
        }
        if let videoUrl = swap?.source?.videoUrl, let segments = recipe.segments, !segments.isEmpty,
           let data = try? JSONEncoder().encode(segments),
           let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            payload["videoUrl"] = videoUrl
            payload["segments"] = array
        }
        FirestoreService.saveRecipe(uid: uid, payload)
        jobs.ping("recipe.save")
        if let sourceUrl = swap?.source?.url { onSaved?(sourceUrl) }
    }
}
