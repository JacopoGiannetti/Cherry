import Foundation
import FirebaseFirestore

// L'unico canale dati dell'app: listener realtime su Firestore.
// Il backend scrive, l'app osserva. Niente risposte HTTP con dati.
enum FirestoreService {
    static var db: Firestore { Firestore.firestore(database: AppConfig.firestoreDatabaseID) }

    // MARK: - Listener generici

    /// Osserva un documento e lo decodifica. Ritorna la registration da tenere viva.
    static func listenDocument<T: Decodable>(
        _ path: String,
        as type: T.Type,
        onChange: @escaping (T?) -> Void
    ) -> ListenerRegistration? {
        guard FirebaseBootstrap.isConfigured else { return nil }
        return db.document(path).addSnapshotListener { snapshot, error in
            if let error { print("[Firestore] \(path): \(error.localizedDescription)"); return }
            guard let snapshot, snapshot.exists else { onChange(nil); return }
            onChange(try? snapshot.data(as: T.self))
        }
    }

    /// Osserva una query e decodifica tutti i documenti.
    static func listenCollection<T: Decodable>(
        _ query: Query?,
        as type: T.Type,
        onChange: @escaping ([T]) -> Void
    ) -> ListenerRegistration? {
        guard FirebaseBootstrap.isConfigured, let query else { return nil }
        return query.addSnapshotListener { snapshot, error in
            if let error { print("[Firestore] query: \(error.localizedDescription)"); return }
            let items = snapshot?.documents.compactMap { try? $0.data(as: T.self) } ?? []
            onChange(items)
        }
    }

    // MARK: - Percorsi tipici

    static func userPath(_ uid: String) -> String { "users/\(uid)" }

    /// Le liste seguono lo scope: mio albero o spazio condiviso.
    static func runPath(_ scope: DataScope, _ runId: String) -> String {
        "\(scope.root)/runs/\(runId)"
    }

    static func recipesQuery(scope: DataScope, runId: String) -> Query? {
        guard FirebaseBootstrap.isConfigured else { return nil }
        return db.collection("\(runPath(scope, runId))/recipes").order(by: "order")
    }

    static func runsQuery(scope: DataScope) -> Query? {
        guard FirebaseBootstrap.isConfigured else { return nil }
        return db.collection("\(scope.root)/runs").order(by: "createdAt", descending: true).limit(to: 30)
    }

    /// Gli spazi di cui faccio parte.
    static func spacesQuery(uid: String) -> Query? {
        guard FirebaseBootstrap.isConfigured else { return nil }
        return db.collection("spaces").whereField("memberUids", arrayContains: uid)
    }

    static func savedRecipesQuery(uid: String) -> Query? {
        guard FirebaseBootstrap.isConfigured else { return nil }
        return db.collection("users/\(uid)/savedRecipes").order(by: "createdAt", descending: true)
    }

    /// Scansioni completate di un tipo (menu / product), più recenti prima.
    static func scansQuery(uid: String, type: String, limit: Int = 12) -> Query? {
        guard FirebaseBootstrap.isConfigured else { return nil }
        return db.collection("users/\(uid)/scans")
            .whereField("type", isEqualTo: type)
            .order(by: "createdAt", descending: true)
            .limit(to: limit)
    }

    static func swapsQuery(uid: String) -> Query? {
        guard FirebaseBootstrap.isConfigured else { return nil }
        return db.collection("users/\(uid)/swaps").order(by: "createdAt", descending: true).limit(to: 20)
    }

    static func inboxPreviewsQuery(uid: String) -> Query? {
        guard FirebaseBootstrap.isConfigured else { return nil }
        return db.collection("users/\(uid)/inboxPreviews")
    }

    // MARK: - Scritture lato app (solo albero utente: profilo, decisioni, spunte)

    static func setUserFields(_ uid: String, _ fields: [String: Any]) {
        guard FirebaseBootstrap.isConfigured else { return }
        db.document("users/\(uid)").setData(fields, merge: true)
    }

    static func setRecipeDecision(scope: DataScope, runId: String, recipeId: String, decision: RecipeDecision) {
        guard FirebaseBootstrap.isConfigured else { return }
        db.document("\(runPath(scope, runId))/recipes/\(recipeId)")
            .setData(["decision": decision.rawValue], merge: true)
    }

    static func setRunFields(scope: DataScope, runId: String, _ fields: [String: Any]) {
        guard FirebaseBootstrap.isConfigured else { return }
        db.document(runPath(scope, runId)).setData(fields, merge: true)
    }

    /// Una sola lista viva per scope: tutto ciò che è in corso, tranne
    /// eventualmente `keepId`, va in archivio.
    static func archiveActiveRuns(scope: DataScope, except keepId: String? = nil) {
        guard let query = runsQuery(scope: scope) else { return }
        query.getDocuments { snap, _ in
            for doc in snap?.documents ?? [] {
                if doc.documentID == keepId { continue }
                let status = doc.data()["status"] as? String ?? ""
                guard ["shopping", "swiping", "generating"].contains(status) else { continue }
                doc.reference.setData(["status": RunStatus.archived.rawValue], merge: true)
            }
        }
    }

    /// Storico dei gusti: un documento per ricetta giudicata (id = id
    /// della ricetta, così ri-giudicarla aggiorna invece di duplicare).
    /// Il backend ne legge gli ultimi 35 e li passa a Gemini.
    static func recordTasteFeedback(uid: String, recipeId: String, _ fields: [String: Any]) {
        guard FirebaseBootstrap.isConfigured else { return }
        var payload = fields
        payload["createdAt"] = FieldValue.serverTimestamp()
        db.document("users/\(uid)/tasteHistory/\(recipeId)").setData(payload, merge: true)
    }

    static func saveRecipe(uid: String, _ data: [String: Any]) {
        saveRecipe(uid: uid, recipeId: nil, data)
    }

    /// `recipeId` nil: nuova ricetta. Altrimenti aggiorna quella aperta
    /// dalla Collection, senza toccare `createdAt`.
    static func saveRecipe(uid: String, recipeId: String?, _ data: [String: Any]) {
        guard FirebaseBootstrap.isConfigured else { return }
        var payload = data
        if let recipeId, !recipeId.isEmpty {
            payload["updatedAt"] = FieldValue.serverTimestamp()
            db.document("users/\(uid)/savedRecipes/\(recipeId)").setData(payload, merge: true)
        } else {
            payload["createdAt"] = FieldValue.serverTimestamp()
            db.collection("users/\(uid)/savedRecipes").addDocument(data: payload)
        }
    }

    /// Elimina un meal plan e tutte le ricette nella sottocollezione.
    static func deleteRun(scope: DataScope, runId: String) async throws {
        guard FirebaseBootstrap.isConfigured else { return }
        let runRef = db.document(runPath(scope, runId))
        let recipes = try await runRef.collection("recipes").getDocuments()
        let batch = db.batch()
        recipes.documents.forEach { batch.deleteDocument($0.reference) }
        batch.deleteDocument(runRef)
        try await batch.commit()
    }

    static func deleteSavedRecipe(uid: String, recipeId: String) async throws {
        guard FirebaseBootstrap.isConfigured else { return }
        try await db.document("users/\(uid)/savedRecipes/\(recipeId)").delete()
    }

    static func deleteScan(uid: String, scanId: String) async throws {
        guard FirebaseBootstrap.isConfigured else { return }
        try await db.document("users/\(uid)/scans/\(scanId)").delete()
    }

    // MARK: - Live Activity

    /// Il token con cui il backend aggiorna la mia Live Activity da
    /// remoto: senza, la spunta dell'altra persona arriverebbe solo
    /// riaprendo l'app.
    static func registerLiveActivityToken(uid: String, runId: String, spaceId: String?, token: String) {
        guard FirebaseBootstrap.isConfigured else { return }
        var payload: [String: Any] = [
            "token": token,
            "runId": runId,
            "updatedAt": FieldValue.serverTimestamp(),
        ]
        // Firestore rifiuta gli Optional: il campo o c'è con un valore,
        // o non c'è.
        payload["spaceId"] = spaceId ?? FieldValue.delete()
        db.document("users/\(uid)/liveActivities/\(runId)").setData(payload, merge: true)
    }

    /// Token con cui il backend può far NASCERE una Live Activity su
    /// questo telefono: è così che la spesa avviata dall'altra persona
    /// compare senza aprire l'app.
    static func registerPushToStartToken(uid: String, token: String) {
        guard FirebaseBootstrap.isConfigured else { return }
        db.document("users/\(uid)/liveActivityStart/current").setData([
            "token": token,
            "updatedAt": FieldValue.serverTimestamp(),
        ], merge: true)
    }

    static func clearLiveActivityToken(uid: String, runId: String) {
        guard FirebaseBootstrap.isConfigured else { return }
        db.document("users/\(uid)/liveActivities/\(runId)").delete()
    }
}
