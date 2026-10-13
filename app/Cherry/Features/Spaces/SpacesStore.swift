import Foundation
import SwiftUI
import FirebaseFirestore

// Gli spazi condivisi: "Just me" e, se l'utente li crea, uno o più
// spazi con un'altra persona. Massimo due membri per spazio: la
// promessa è "io e te", non un social network.
//
// Qui vive solo l'appartenenza. Dove finiscono i dati lo decide
// `DataScope`, che l'app costruisce da `activeSpaceId`.
@MainActor
final class SpacesStore: ObservableObject {
    @Published private(set) var spaces: [Space] = []
    @Published private(set) var activeSpaceId: String?
    @Published private(set) var isWorking = false
    @Published var errorMessage: String?

    /// Spese in corso negli spazi che NON sto guardando. Un banner
    /// per spazio: se ne ho due aperti, li vedo entrambi.
    @Published private(set) var awayRuns: [AwayShopping] = []

    private var listener: ListenerRegistration?
    private var awayListeners: [String: ListenerRegistration] = [:]
    private var uid: String = ""
    private var jobs: JobClient?
    private let defaults = UserDefaults.standard
    private var activeKey: String { "spaces.active.\(uid)" }
    /// Scelta letta dall'account, in attesa che la lista spazi arrivi.
    private var remoteChoice: String?

    /// Cosa ha scelto l'utente su QUESTO telefono. Assente = mai scelto
    /// qui; stringa vuota = ha scelto "Just me". La differenza conta: se
    /// trattassimo i due casi allo stesso modo, chi torna al personale se
    /// lo vedrebbe annullare al riavvio dalla scelta salvata sull'account.
    private var localChoice: String? { defaults.string(forKey: activeKey) }

    /// Lo spazio in cui sto lavorando, nil quando sono nel mio.
    var activeSpace: Space? {
        guard let activeSpaceId else { return nil }
        return spaces.first { $0.id == activeSpaceId }
    }

    var sharedSpace: Space? { spaces.first }

    /// Create / join restano sempre disponibili: un utente può stare
    /// in più spazi (due persone per spazio).
    var canCreateMore: Bool { true }

    var scopeName: String { activeSpace?.name ?? "Just me" }

    var partner: SpaceMember? { activeSpace?.partner(of: uid) }

    func start(uid: String, jobs: JobClient) {
        guard self.uid != uid || listener == nil else { return }
        self.uid = uid
        self.jobs = jobs
        // Account diverso, preferenze diverse: mai ereditare quelle del
        // precedente (utente di ritorno, account cancellato).
        remoteChoice = nil
        activeSpaceId = nil
        // Ripristino ottimistico: lo switch non deve lampeggiare in
        // attesa che Firestore risponda.
        if let local = localChoice {
            activeSpaceId = local.isEmpty ? nil : local
        }
        listener?.remove()
        awayListeners.values.forEach { $0.remove() }
        awayListeners.removeAll()
        awayRuns = []
        listener = FirestoreService.listenCollection(
            FirestoreService.spacesQuery(uid: uid),
            as: Space.self
        ) { [weak self] spaces in
            guard let self else { return }
            self.spaces = spaces
            // Spazio abbandonato o sciolto mentre ero dentro: si torna
            // al proprio, senza vicoli ciechi.
            if let active = self.activeSpaceId, !spaces.contains(where: { $0.id == active }) {
                self.select(spaceId: nil, userInitiated: false)
            }
            self.applyRemoteChoice()
            self.watchAwayRuns()
        }
    }

    /// Lo spazio in cui l'utente stava lavorando l'ultima volta, letto
    /// dall'account: serve su un telefono nuovo o dopo una
    /// reinstallazione, dove `UserDefaults` è vuoto e altrimenti si
    /// atterrerebbe su "Just me" con la lista condivisa apparentemente
    /// sparita. Non tocca mai una scelta già fatta su questo telefono.
    func adoptRemoteChoice(_ spaceId: String?) {
        guard !uid.isEmpty, localChoice == nil else { return }
        guard let spaceId, !spaceId.isEmpty else { return }
        remoteChoice = spaceId
        applyRemoteChoice()
    }

    /// Si applica solo quando la lista spazi è arrivata: senza, non si
    /// potrebbe sapere se quello spazio esiste ancora.
    private func applyRemoteChoice() {
        guard localChoice == nil, let wanted = remoteChoice else { return }
        guard spaces.contains(where: { $0.id == wanted }) else { return }
        remoteChoice = nil
        select(spaceId: wanted, userInitiated: false)
    }

    func stop() {
        listener?.remove()
        listener = nil
        awayListeners.values.forEach { $0.remove() }
        awayListeners.removeAll()
        awayRuns = []
    }

    /// Tiene d'occhio la spesa di ogni spazio in cui NON sono. Serve
    /// solo a poterla segnalare: i dati restano quelli dello scope attivo.
    private func watchAwayRuns() {
        let active = activeSpaceId
        let targets: [(String, Space)] = spaces.compactMap { space in
            guard let id = space.id, id != active else { return nil }
            return (id, space)
        }
        let wanted = Set(targets.map(\.0))

        for key in awayListeners.keys where !wanted.contains(key) {
            awayListeners[key]?.remove()
            awayListeners.removeValue(forKey: key)
            awayRuns.removeAll { $0.space.id == key }
        }

        for (id, space) in targets {
            guard awayListeners[id] == nil else { continue }
            awayListeners[id] = FirestoreService.listenCollection(
                FirestoreService.runsQuery(scope: DataScope(uid: uid, spaceId: id)),
                as: Run.self
            ) { [weak self] runs in
                guard let self else { return }
                self.awayRuns.removeAll { $0.space.id == id }
                if let run = runs.first(where: { $0.status == .shopping }) {
                    self.awayRuns.append(AwayShopping(run: run, space: space))
                }
            }
        }
    }

    /// Cambia lo spazio corrente. nil = spazio personale.
    func select(spaceId: String?) {
        select(spaceId: spaceId, userInitiated: true)
    }

    /// `userInitiated` false quando lo switch è un ripristino o una
    /// conseguenza (spazio sciolto): non è un gesto, e contarlo come tale
    /// falserebbe `space_switched`.
    private func select(spaceId: String?, userInitiated: Bool) {
        guard activeSpaceId != spaceId else { return }
        activeSpaceId = spaceId
        remoteChoice = nil
        watchAwayRuns()
        // Anche "Just me" va scritto (stringa vuota): è una scelta, e
        // deve vincere sul valore salvato nell'account.
        defaults.set(spaceId ?? "", forKey: activeKey)
        // Niente Optional dentro Firestore: uscire dallo spazio
        // significa togliere il campo, non scriverci null.
        FirestoreService.setUserFields(uid, ["activeSpaceId": spaceId ?? FieldValue.delete()])
        if userInitiated {
            Analytics.log("space_switched", ["shared": spaceId != nil])
        }
    }

    // MARK: - Creazione e ingresso (passano dal backend: è lui che
    // valida i codici e tiene il conto dei membri)

    func createSpace(name: String, myName: String) async -> Bool {
        await perform { jobs in
            let result = try await jobs.call("/spaces/create", body: [
                "name": name,
                "displayName": myName,
            ])
            if let spaceId = result["spaceId"] as? String {
                self.select(spaceId: spaceId)
            }
            Analytics.log("space_created", [:])
        }
    }

    func join(code: String, myName: String) async -> Bool {
        await perform { jobs in
            let result = try await jobs.call("/spaces/join", body: [
                "code": code.uppercased().trimmingCharacters(in: .whitespacesAndNewlines),
                "displayName": myName,
            ])
            if let spaceId = result["spaceId"] as? String {
                self.select(spaceId: spaceId)
            }
            Analytics.log("space_joined", [:])
        }
    }

    func leave(spaceId: String) async -> Bool {
        await perform { jobs in
            _ = try await jobs.call("/spaces/leave", body: ["spaceId": spaceId])
            self.select(spaceId: nil)
            Analytics.log("space_left", [:])
        }
    }

    func rename(spaceId: String, to name: String) async -> Bool {
        await perform { jobs in
            _ = try await jobs.call("/spaces/rename", body: ["spaceId": spaceId, "name": name])
        }
    }

    private func perform(_ work: @escaping (JobClient) async throws -> Void) async -> Bool {
        guard let jobs else { return false }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await work(jobs)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}

/// Una spesa aperta in uno spazio che non sto guardando: il banner
/// in home la segnala senza mescolare i dati dei due alberi.
struct AwayShopping: Identifiable {
    let run: Run
    let space: Space
    var id: String { "\(space.id ?? "")-\(run.id ?? "")" }
}
