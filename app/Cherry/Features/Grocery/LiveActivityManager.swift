import Foundation
import ActivityKit

// Live Activity dello shopping (§4.3): nasce quando una lista entra in
// modalità spesa, resta viva mentre l'app è chiusa, muore quando la
// lista viene archiviata o svuotata.
//
// La scheda a schermo può essere nata in locale (`Activity.request`) o
// da un push dell'altra persona. In entrambi i casi `sync` deve
// aggiornare QUELLA istanza, non crearne una seconda: altrimenti chi
// spunta resta fermo sul numero vecchio e chi riceve il push vede il
// valore giusto.
@MainActor
final class LiveActivityManager {
    static let shared = LiveActivityManager()
    private init() {}

    private var activity: Activity<ShoppingActivityAttributes>?
    /// Chiave = `activity.id`: due Live Activity della stessa run (una
    /// da push, una locale) hanno lo stesso `runId` ma token diversi.
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private var startTokenTask: Task<Void, Never>?
    private var adoptionTask: Task<Void, Never>?

    /// Chiamato quando ActivityKit consegna il push token: serve al
    /// backend per aggiornare questa Live Activity da remoto (è così
    /// che la spunta dell'altra persona arriva a schermo bloccato).
    /// `spaceId` è quello della run, non dello scope UI corrente.
    var onPushToken: ((_ runId: String, _ spaceId: String?, _ token: String) -> Void)?

    /// Token "push to start": permette al backend di FAR NASCERE una
    /// Live Activity su questo telefono. È come la lista condivisa
    /// creata dall'altra persona compare senza aprire l'app.
    var onPushToStartToken: ((_ token: String) -> Void)?

    var currentRunId: String? { activity?.attributes.runId }

    struct Snapshot {
        let runId: String
        let listTitle: String
        let spaceName: String?
        let spaceId: String?
        let budgetUsd: Double
        let checked: Int
        let total: Int
        let spentUsd: Double
        var lastActorName: String?
        var lastItemName: String?
    }

    /// Riprende le Live Activity sopravvissute a un riavvio dell'app o
    /// nate da un push mentre l'app era chiusa: altrimenti resterebbero
    /// orfane, impossibili da aggiornare e da chiudere.
    func adoptExisting() {
        for existing in Activity<ShoppingActivityAttributes>.activities {
            if activity == nil { activity = existing }
            observePushToken(existing)
        }
        observeAdoptions()
        observePushToStart()
    }

    /// Live Activity nate da push ad app aperta (lista avviata
    /// dall'altra persona): vanno adottate al volo.
    private func observeAdoptions() {
        guard adoptionTask == nil else { return }
        adoptionTask = Task { [weak self] in
            for await started in Activity<ShoppingActivityAttributes>.activityUpdates {
                guard let self else { continue }
                if self.activity == nil
                    || self.activity?.attributes.runId == started.attributes.runId {
                    self.activity = started
                }
                self.observePushToken(started)
            }
        }
    }

    private func observePushToStart() {
        guard startTokenTask == nil else { return }
        startTokenTask = Task { [weak self] in
            for await tokenData in Activity<ShoppingActivityAttributes>.pushToStartTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                self?.onPushToStartToken?(token)
            }
        }
    }

    /// Unico ingresso: allinea la Live Activity allo stato della lista.
    func sync(_ snapshot: Snapshot) {
        guard snapshot.total > 0 else {
            end(runId: snapshot.runId)
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let state = ShoppingActivityAttributes.ContentState(
            checkedCount: snapshot.checked,
            totalCount: snapshot.total,
            spentUsd: snapshot.spentUsd,
            lastActorName: snapshot.lastActorName,
            lastItemName: snapshot.lastItemName
        )
        let content = ActivityContent(state: state, staleDate: nil)

        let existing = Self.activities(for: snapshot.runId)
        if !existing.isEmpty {
            activity = existing[0]
            for item in existing {
                observePushToken(item)
                Task { await item.update(content) }
            }
            return
        }

        // Nessuna scheda per questa lista: si chiude un'eventuale
        // Activity di un'altra run e se ne apre una nuova.
        if let current = activity, current.attributes.runId != snapshot.runId {
            end(runId: current.attributes.runId)
        }

        let attributes = ShoppingActivityAttributes(
            runId: snapshot.runId,
            budgetUsd: snapshot.budgetUsd,
            listTitle: snapshot.listTitle,
            spaceName: snapshot.spaceName,
            spaceId: snapshot.spaceId
        )
        do {
            let started = try Activity.request(
                attributes: attributes,
                content: content,
                // Il token serve anche per la spesa da soli: l'app in
                // background non può aggiornarsi da sé.
                pushType: .token
            )
            activity = started
            observePushToken(started)
        } catch {
            print("[LiveActivity] avvio fallito: \(error.localizedDescription)")
        }
    }

    func end() {
        if let runId = activity?.attributes.runId {
            end(runId: runId)
            return
        }
        // Niente puntatore, ma magari ne è rimasta una da un push.
        if let leftover = Activity<ShoppingActivityAttributes>.activities.first {
            end(runId: leftover.attributes.runId)
        }
    }

    /// Chiude solo se la Live Activity a schermo è quella indicata.
    func endIfShowing(runId: String) {
        guard activity?.attributes.runId == runId
            || Self.activities(for: runId).isEmpty == false else { return }
        end(runId: runId)
    }

    private func end(runId: String) {
        let items = Self.activities(for: runId)
        for item in items {
            tokenTasks.removeValue(forKey: item.id)?.cancel()
            let finalState = item.content.state
            Task { await item.end(.init(state: finalState, staleDate: nil), dismissalPolicy: .immediate) }
        }
        if activity?.attributes.runId == runId { activity = nil }
    }

    private static func activities(for runId: String) -> [Activity<ShoppingActivityAttributes>] {
        Activity<ShoppingActivityAttributes>.activities.filter { $0.attributes.runId == runId }
    }

    private func observePushToken(_ activity: Activity<ShoppingActivityAttributes>) {
        let id = activity.id
        guard tokenTasks[id] == nil else { return }
        let runId = activity.attributes.runId
        let spaceId = activity.attributes.spaceId
        tokenTasks[id] = Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                self?.onPushToken?(runId, spaceId, token)
            }
        }
    }
}
