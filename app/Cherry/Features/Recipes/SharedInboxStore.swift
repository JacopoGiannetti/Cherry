import Foundation
import CryptoKit
import FirebaseFirestore

// Metadati di anteprima per un link condiviso in attesa di veganize.
struct InboxPreview: Codable, Identifiable {
    @DocumentID var id: String?
    var url: String = ""
    var title: String?
    var thumbnail: String?
    var platform: String?
    var status: String = "loading"
    var errorMessage: String?
    var updatedAt: Date?

    var isReady: Bool { status == "ready" }
    var isLoading: Bool { status == "loading" }
}

enum SharedInbox {
    /// Stesso id usato dal backend (hash SHA256 dell'URL normalizzato).
    static func previewId(for url: String) -> String {
        let digest = SHA256.hash(data: Data(normalize(url).utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func normalize(_ url: String) -> String {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: trimmed) else { return trimmed.lowercased() }
        parts.query = nil
        parts.fragment = nil
        return (parts.string ?? trimmed).lowercased()
    }
}

@MainActor
final class SharedInboxStore: ObservableObject {
    @Published private(set) var previews: [String: InboxPreview] = [:]

    /// Gli swap recenti per intero (serve `createdAt`, non solo lo
    /// status): dice alla riga in inbox se la ricetta elaborata in
    /// background è pronta, al lavoro, o morta a metà strada.
    @Published private(set) var swaps: [String: Swap] = [:]

    /// Prewarm il cui job è terminato in errore: la riga torna allo
    /// stato normale (Veganize) invece di promettere un "Reading…"
    /// che non finirà mai.
    @Published private(set) var failedPrewarms = Set<String>()

    private var uid: String = ""
    private var jobs: JobClient?
    private var listener: ListenerRegistration?
    private var swapsListener: ListenerRegistration?
    private var jobWatchers: [String: ListenerRegistration] = [:]
    private var previewing = Set<String>()
    private var prewarmedSwaps = Set<String>()

    /// Oltre questa età uno swap non arrivato in fondo si considera in
    /// stallo (job morto senza scrivere l'errore): si può ritentare.
    private let staleAfter: TimeInterval = 180

    /// True dopo il primo snapshot da Firestore. Prima di allora non si
    /// sa quali anteprime esistono già: chiedere il re-fetch a ogni
    /// avvio era ciò che faceva sparire titoli e foto.
    private var hasLoadedPreviews = false
    private var queuedWarm: [String] = []

    /// Stessa protezione per gli swap: prima del primo snapshot ogni
    /// ricetta sembrerebbe mai elaborata e l'import ripartirebbe da
    /// zero a ogni avvio, anche per quelle già pronte.
    private var hasLoadedSwaps = false
    private var queuedPrewarm: [String] = []

    func start(uid: String, jobs: JobClient) {
        guard self.uid != uid || listener == nil else { return }
        self.uid = uid
        self.jobs = jobs
        hasLoadedPreviews = false
        listener?.remove()
        listener = FirestoreService.listenCollection(
            FirestoreService.inboxPreviewsQuery(uid: uid),
            as: InboxPreview.self
        ) { [weak self] items in
            guard let self else { return }
            var map: [String: InboxPreview] = [:]
            for item in items where !item.url.isEmpty {
                map[item.url] = item
            }
            self.previews = map
            if !self.hasLoadedPreviews {
                self.hasLoadedPreviews = true
                let queued = self.queuedWarm
                self.queuedWarm = []
                self.warmPreviews(for: queued)
            }
        }
        if listener == nil {
            // Firebase non configurato: nessuno snapshot arriverà mai,
            // inutile tenere le richieste in coda.
            hasLoadedPreviews = true
        }
        hasLoadedSwaps = false
        swapsListener?.remove()
        swapsListener = FirestoreService.listenCollection(
            FirestoreService.swapsQuery(uid: uid),
            as: Swap.self
        ) { [weak self] items in
            guard let self else { return }
            var map: [String: Swap] = [:]
            for swap in items {
                if let id = swap.id { map[id] = swap }
            }
            self.swaps = map
            if !self.hasLoadedSwaps {
                self.hasLoadedSwaps = true
                let queued = self.queuedPrewarm
                self.queuedPrewarm = []
                self.prewarmSwaps(for: queued)
            }
        }
        if swapsListener == nil {
            hasLoadedSwaps = true
        }
    }

    func stop() {
        listener?.remove()
        listener = nil
        swapsListener?.remove()
        swapsListener = nil
        jobWatchers.values.forEach { $0.remove() }
        jobWatchers.removeAll()
        previewing.removeAll()
        prewarmedSwaps.removeAll()
        failedPrewarms.removeAll()
        hasLoadedPreviews = false
        queuedWarm = []
        hasLoadedSwaps = false
        queuedPrewarm = []
    }

    /// Per ogni link in coda senza anteprima pronta, chiede al backend
    /// titolo e foto (solo metadati, niente Gemini).
    func warmPreviews(for urls: [String]) {
        guard let jobs else { return }
        guard hasLoadedPreviews else {
            // Troppo presto: senza lo snapshot iniziale ogni anteprima
            // sembrerebbe mancante e verrebbe richiesta di nuovo.
            queuedWarm = urls
            return
        }
        for url in urls {
            if let existing = previews[url], existing.isReady || existing.isLoading { continue }
            guard !previewing.contains(url) else { continue }
            previewing.insert(url)
            Task {
                defer { previewing.remove(url) }
                _ = try? await jobs.start("/swap/preview", body: ["url": url])
            }
        }
    }

    // MARK: - Elaborazione in background dei link condivisi

    /// Id dello swap per un link: derivato dall'URL, così prewarm e tap
    /// su Veganize puntano allo stesso documento.
    static func swapId(for url: String) -> String {
        SharedInbox.previewId(for: url)
    }

    /// La ricetta pronta da aprire: estrazione e ledger già fatti.
    func isSwapReady(for url: String) -> Bool {
        switch swaps[Self.swapId(for: url)]?.status {
        case "extracted", "ledger_ready", "generating_photo", "finalized": return true
        default: return false
        }
    }

    /// Elaborazione davvero in corso: swap esistente, non pronto, non
    /// fallito e partito da poco. Uno swap fermo su "extracting" da
    /// oltre `staleAfter` è un job morto, non un lavoro in corso — la
    /// riga non deve promettere un caricamento che non arriverà.
    func isSwapInProgress(for url: String) -> Bool {
        let swapId = Self.swapId(for: url)
        guard !failedPrewarms.contains(swapId) else { return false }
        guard let swap = swaps[swapId], !isSwapReady(for: url) else { return false }
        return isFresh(swap)
    }

    private func isFresh(_ swap: Swap) -> Bool {
        // createdAt nil = serverTimestamp non ancora risolto: appena creato.
        guard let created = swap.createdAt else { return true }
        return Date().timeIntervalSince(created) < staleAfter
    }

    /// Avvia l'estrazione completa per i link appena arrivati: magari
    /// la ricetta è già vegana e l'utente vuole solo ritrovarla pronta
    /// da salvare. Il backend salta il lavoro se lo swap è già in uno
    /// stato finale; gli swap in stallo vengono rilanciati (l'import
    /// riparte e rinfresca `createdAt`, quindi niente retry a raffica).
    func prewarmSwaps(for urls: [String]) {
        guard let jobs else { return }
        guard hasLoadedSwaps else {
            queuedPrewarm = urls
            return
        }
        for url in urls {
            let swapId = Self.swapId(for: url)
            if isSwapReady(for: url) { continue }
            if failedPrewarms.contains(swapId) { continue }
            if let swap = swaps[swapId], isFresh(swap) { continue }
            // Avviato in questa sessione ma il documento non è ancora
            // apparso: non duplicare la partenza.
            if swaps[swapId] == nil, prewarmedSwaps.contains(swapId) { continue }
            prewarmedSwaps.insert(swapId)
            Task {
                do {
                    let jobId = try await jobs.start("/swap/import", body: [
                        "swapId": swapId,
                        "source": ["type": "link", "url": url],
                    ])
                    self.watchPrewarmJob(jobId, swapId: swapId)
                } catch {
                    self.failedPrewarms.insert(swapId)
                    self.prewarmedSwaps.remove(swapId)
                }
            }
        }
    }

    /// Segue il job del prewarm fino in fondo: se muore con un errore
    /// il documento dello swap resta su "extracting" per sempre, e
    /// senza questo ascolto nessuno se ne accorgerebbe.
    private func watchPrewarmJob(_ jobId: String, swapId: String) {
        jobWatchers[swapId]?.remove()
        jobWatchers[swapId] = FirestoreService.listenDocument(
            "users/\(uid)/jobs/\(jobId)",
            as: Job.self
        ) { [weak self] job in
            guard let self, let job else { return }
            switch job.status {
            case .error:
                self.failedPrewarms.insert(swapId)
                self.prewarmedSwaps.remove(swapId)
                self.jobWatchers.removeValue(forKey: swapId)?.remove()
            case .done:
                self.failedPrewarms.remove(swapId)
                self.jobWatchers.removeValue(forKey: swapId)?.remove()
            case .running:
                break
            }
        }
    }

    func discardPreview(_ url: String) {
        previews.removeValue(forKey: url)
        guard FirebaseBootstrap.isConfigured else { return }
        let id = SharedInbox.previewId(for: url)
        FirestoreService.db.document("users/\(uid)/inboxPreviews/\(id)").delete()
    }
}
