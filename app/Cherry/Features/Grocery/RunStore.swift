import Foundation
import SwiftUI
import FirebaseFirestore

// Lo stato vivo di una Grocery Run. Ascolta Firestore (il backend
// scrive le ricette man mano) ed espone il deck già ri-ordinato:
// le ricette che condividono ingredienti col carrello salgono (§4.1).
@MainActor
final class RunStore: ObservableObject, Identifiable {
    /// Dove vive questa lista: mio albero o spazio condiviso.
    let scope: DataScope
    let runId: String
    let jobs: JobClient

    /// Ricette salvate, storico gusti e job restano personali anche
    /// mentre si fa la spesa insieme.
    var uid: String { scope.uid }

    /// Nome con cui appaio all'altra persona quando spunto qualcosa.
    var actorName: String = "Me"

    /// Nome dello spazio, per la Live Activity che nasce qui: gli
    /// attributi si fissano alla `request` e non si correggono dopo,
    /// quindi senza questo la scheda resterebbe "in the cart" per
    /// sempre invece di dire in quale cucina si sta facendo la spesa.
    var spaceName: String?

    @Published var run: Run?
    @Published var recipes: [Recipe] = []
    @Published var startError: String?
    @Published var isGeneratingMore = false
    /// Da quando si aspetta il deck: fa partire la percentuale del
    /// caricamento. Si azzera a ogni generazione.
    @Published private(set) var loadingStartedAt = Date()

    /// Ricette già messe in collezione dalla stella: serve a non creare
    /// doppioni e a mostrare la stella piena sulla carta.
    @Published private(set) var savedRecipeIds: Set<String> = []

    @Published private(set) var deckImagesReady = true

    /// Prova guidata dell'onboarding: stesso wizard, stesse schermate,
    /// ma il deck è locale e nessuna scrittura esce dal telefono —
    /// l'utente non ha ancora un account né un abbonamento.
    private(set) var isDemo = false

    /// Ordine del deck, congelato. Si ricalcola quando cambia il
    /// carrello, ma la carta in cima resta al suo posto: era quella che
    /// si intravedeva dietro durante lo swipe precedente.
    @Published private var deckOrderIds: [String] = []

    /// True finché non abbiamo mostrato il deck con le foto già in
    /// cache: evita la carta grigia al primo frame.
    private var awaitingDeckImages = false
    private var preloadTask: Task<Void, Never>?
    private var didCheckInitialDeckImages = false

    /// Se valorizzato, al termine dello swipe questa run viene FUSA
    /// nella run indicata (scelta "Merge" all'avvio, §4 run multiple).
    var mergeTargetRunId: String?

    /// Broadcast alla Live Activity dell'altra persona, in attesa di una
    /// pausa nelle spunte (vedi `notifyPartner`).
    private var broadcastTask: Task<Void, Never>?

    private var runListener: ListenerRegistration?
    private var recipesListener: ListenerRegistration?
    private var jobListener: ListenerRegistration?

    init(scope: DataScope, jobs: JobClient, runId: String = UUID().uuidString) {
        self.scope = scope
        self.jobs = jobs
        self.runId = runId
    }

    deinit {
        runListener?.remove()
        recipesListener?.remove()
        jobListener?.remove()
        preloadTask?.cancel()
    }

    func listen() {
        runListener = FirestoreService.listenDocument(
            FirestoreService.runPath(scope, runId),
            as: Run.self
        ) { [weak self] run in
            self?.run = run
            if run?.progressStage == "done" { self?.isGeneratingMore = false }
        }
        recipesListener = FirestoreService.listenCollection(
            FirestoreService.recipesQuery(scope: scope, runId: runId),
            as: Recipe.self
        ) { [weak self] recipes in
            guard let self else { return }
            self.recipes = recipes
            self.syncDeckOrder()
            if !self.didCheckInitialDeckImages, !self.deck.isEmpty {
                self.didCheckInitialDeckImages = true
                let urls = self.deck.compactMap { $0.imageUrl.flatMap(URL.init) }
                if !urls.isEmpty, !urls.allSatisfy(ImageCache.isCached) {
                    self.awaitingDeckImages = true
                    self.deckImagesReady = false
                }
            }
            self.preloadDeckImagesIfNeeded()
        }
    }

    /// Osserva il job avviato: se fallisce, l'errore arriva qui invece
    /// di lasciare la schermata a caricare per sempre.
    private func watchJob(_ jobId: String) {
        jobListener?.remove()
        jobListener = FirestoreService.listenDocument("users/\(uid)/jobs/\(jobId)", as: Job.self) { [weak self] job in
            guard let job, job.status == .error else { return }
            self?.startError = job.errorMessage ?? "Something went wrong. Try again."
            self?.isGeneratingMore = false
            self?.awaitingDeckImages = false
            self?.deckImagesReady = true
        }
    }

    // MARK: - Avvio e generazione

    /// Fase corrente della generazione, letta dalla run su Firestore.
    enum GenerationPhase: Equatable {
        case idle
        case recipes
        case images(done: Int, total: Int)
    }

    var generationPhase: GenerationPhase {
        switch run?.progressStage {
        case "recipes": return .recipes
        case "images": return .images(done: run?.imagesDone ?? 0, total: max(1, run?.imagesTotal ?? 1))
        case "done": return .idle
        default:
            // Run appena avviata: il backend non ha ancora scritto il documento.
            return run == nil && recipes.isEmpty ? .recipes : .idle
        }
    }

    /// `cravings` vuoto significa "sorprendimi". `adventure` 1–3:
    /// quanto spingersi oltre i piatti sicuri del profilo gusti.
    /// `appliances` viaggia nella richiesta oltre che nel profilo: la
    /// scrittura su Firestore potrebbe non essere ancora atterrata.
    func start(
        cravings: [String],
        budgetUsd: Double,
        servings: Int,
        adventure: Int = 2,
        occasion: String = "everyday",
        appliances: [String] = []
    ) async {
        if mergeTargetRunId == nil {
            FirestoreService.archiveActiveRuns(scope: scope, except: runId)
        }
        awaitingDeckImages = true
        deckImagesReady = false
        loadingStartedAt = Date()
        listen()
        Analytics.log("run_started", ["budget": budgetUsd, "servings": servings, "adventure": adventure, "occasion": occasion])
        do {
            let jobId = try await jobs.start("/runs/generate", body: scoped([
                "runId": runId,
                "cravings": cravings,
                "budgetUsd": budgetUsd,
                "servings": servings,
                "adventure": adventure,
                "occasion": occasion,
                "appliances": appliances,
            ]))
            watchJob(jobId)
        } catch {
            startError = error.localizedDescription
            awaitingDeckImages = false
            deckImagesReady = true
        }
    }

    /// Avvia la prova guidata: il deck arriva già pronto, quindi non
    /// c'è nulla da generare e nessun listener da aprire.
    func startDemo(deck seeded: [Recipe], budgetUsd: Double, servings: Int, craving: String) {
        isDemo = true

        var demoRun = Run()
        demoRun.id = runId
        demoRun.status = .swiping
        demoRun.craving = craving
        demoRun.budgetUsd = budgetUsd
        demoRun.servings = servings
        demoRun.progressStage = "done"
        run = demoRun

        recipes = seeded
        syncDeckOrder()
        warmDemoDeck()
    }

    /// Le foto della prova sono remote: si aspetta solo per le prime
    /// carte, e mai oltre qualche secondo — con la rete lenta la demo
    /// deve partire lo stesso, non restare sul teatrino.
    private func warmDemoDeck() {
        let urls = deck.prefix(3).compactMap { $0.imageUrl.flatMap(URL.init) }
        guard !urls.isEmpty, !urls.allSatisfy(ImageCache.isCached) else {
            deckImagesReady = true
            return
        }

        deckImagesReady = false
        preloadTask?.cancel()
        preloadTask = Task { @MainActor [weak self] in
            let warming = Task { await ImageCache.preload(Array(urls)) }
            let deadline = Task { @MainActor in
                try? await Task.sleep(for: .seconds(6))
                guard let self, !self.deckImagesReady else { return }
                warming.cancel()
                self.deckImagesReady = true
            }
            _ = await warming.value
            deadline.cancel()
            self?.deckImagesReady = true
        }
    }

    func generateMore(correctionChips: [String] = []) async {
        guard !isDemo else { return }
        startError = nil
        awaitingDeckImages = true
        deckImagesReady = false
        isGeneratingMore = true
        loadingStartedAt = Date()
        do {
            let jobId = try await jobs.start("/runs/generate-more", body: scoped([
                "runId": runId,
                "correctionChips": correctionChips,
            ]))
            watchJob(jobId)
        } catch {
            startError = error.localizedDescription
            isGeneratingMore = false
            awaitingDeckImages = false
            deckImagesReady = true
        }
    }

    // MARK: - Deck

    var keptRecipes: [Recipe] { recipes.filter { $0.decision == .kept } }
    var passedRecipes: [Recipe] { recipes.filter { $0.decision == .passed } }

    /// Ingredienti già nel carrello (normalizzati), per il re-ranking e i badge.
    var basketIngredients: Set<String> {
        Set(keptRecipes.flatMap { $0.ingredients.map { $0.name.lowercased() } })
    }

    private var recipesById: [String: Recipe] {
        Dictionary(uniqueKeysWithValues: recipes.compactMap { recipe in
            recipe.id.map { ($0, recipe) }
        })
    }

    /// Il deck, nell'ordine congelato da `syncDeckOrder`.
    var deck: [Recipe] {
        let byId = recipesById
        return deckOrderIds.compactMap { byId[$0] }
    }

    /// Ri-ordina le ricette ancora da giudicare: chi condivide
    /// ingredienti col carrello sale (§4.1). La prima carta è esclusa
    /// dal riordino — cambiarla dopo un rilascio significherebbe
    /// mostrare una foto durante lo swipe e un'altra un istante dopo.
    private func syncDeckOrder() {
        let pendingIds = recipes
            .filter { ($0.decision ?? .pending) == .pending }
            .compactMap(\.id)
        let pending = Set(pendingIds)

        let surviving = deckOrderIds.filter { pending.contains($0) }
        let newcomers = pendingIds.filter { !surviving.contains($0) }

        let lead = surviving.first
        var rest = Array(surviving.dropFirst()) + newcomers

        let basket = basketIngredients
        if !basket.isEmpty {
            let byId = recipesById
            let position = Dictionary(
                uniqueKeysWithValues: rest.enumerated().map { ($0.element, $0.offset) }
            )
            func overlap(_ id: String) -> Int {
                guard let recipe = byId[id] else { return 0 }
                return recipe.ingredients.filter { basket.contains($0.name.lowercased()) }.count
            }
            rest.sort { a, b in
                let overlapA = overlap(a)
                let overlapB = overlap(b)
                if overlapA != overlapB { return overlapA > overlapB }
                return (position[a] ?? 0) < (position[b] ?? 0)
            }
        }

        let updated = [lead].compactMap { $0 } + rest
        if updated != deckOrderIds { deckOrderIds = updated }
    }

    /// Scarica in cache tutte le foto del deck prima di mostrarlo.
    /// Firestore consegna gli URL subito, ma la rete impiega un attimo:
    /// finché non sono in cache restiamo sul loading theater.
    private func preloadDeckImagesIfNeeded() {
        guard !deck.isEmpty else {
            if awaitingDeckImages {
                deckImagesReady = true
                awaitingDeckImages = false
            }
            return
        }

        let urls = deck.compactMap { $0.imageUrl.flatMap(URL.init) }

        if urls.isEmpty || urls.allSatisfy(ImageCache.isCached) {
            deckImagesReady = true
            awaitingDeckImages = false
            return
        }

        guard awaitingDeckImages else {
            preloadTask?.cancel()
            preloadTask = Task { await ImageCache.preload(Array(urls.prefix(3))) }
            return
        }

        deckImagesReady = false
        preloadTask?.cancel()
        preloadTask = Task { @MainActor in
            await ImageCache.preload(urls)
            guard !Task.isCancelled else { return }
            deckImagesReady = true
            awaitingDeckImages = false
        }
    }

    func sharedIngredients(of recipe: Recipe) -> [String] {
        let basket = basketIngredients
        return recipe.ingredients
            .map(\.name)
            .filter { basket.contains($0.lowercased()) }
    }

    var spentUsd: Double { keptRecipes.reduce(0) { $0 + $1.costUsd } }
    var budgetUsd: Double { run?.budgetUsd ?? 50 }
    var remainingUsd: Double { max(0, budgetUsd - spentUsd) }
    var budgetFraction: Double { budgetUsd > 0 ? min(1, spentUsd / budgetUsd) : 0 }

    func wouldOvershoot(_ recipe: Recipe) -> Bool {
        spentUsd + recipe.costUsd > budgetUsd
    }

    /// Budget pieno = stato di vittoria (§4.1, decisione §11: auto-completamento).
    var budgetFull: Bool {
        guard !keptRecipes.isEmpty else { return false }
        let cheapestPending = deck.map(\.costUsd).min() ?? .infinity
        return spentUsd >= budgetUsd || (budgetUsd - spentUsd) < min(cheapestPending, 5)
    }

    /// Il backend deve sapere in quale spazio scrivere.
    private func scoped(_ body: [String: Any]) -> [String: Any] {
        guard let spaceId = scope.spaceId else { return body }
        var copy = body
        copy["spaceId"] = spaceId
        return copy
    }

    func keep(_ recipe: Recipe) {
        guard let id = recipe.id else { return }
        if !isDemo {
            FirestoreService.setRecipeDecision(scope: scope, runId: runId, recipeId: id, decision: .kept)
            recordTaste(recipe, verdict: .kept)
            jobs.ping("recipe.keep")
        }
        // Aggiornamento ottimistico: il listener confermerà.
        applyLocal(id: id, decision: .kept)
    }

    func pass(_ recipe: Recipe) {
        guard let id = recipe.id else { return }
        if !isDemo {
            FirestoreService.setRecipeDecision(scope: scope, runId: runId, recipeId: id, decision: .passed)
            recordTaste(recipe, verdict: .passed)
            jobs.ping("recipe.pass")
        }
        applyLocal(id: id, decision: .passed)
    }

    /// Prova guidata: rimette in gioco tutte le carte scartate.
    func resetDemoDeck() {
        guard isDemo else { return }
        for index in recipes.indices {
            recipes[index].decision = .pending
        }
        syncDeckOrder()
    }

    private func applyLocal(id: String, decision: RecipeDecision) {
        if let index = recipes.firstIndex(where: { $0.id == id }) {
            recipes[index].decision = decision
        }
        syncDeckOrder()
    }

    /// Ogni verdetto finisce nello storico dei gusti: il backend passa
    /// gli ultimi a Gemini, così i batch successivi imparano davvero
    /// cosa piace e cosa no, anche fra run diverse.
    private func recordTaste(_ recipe: Recipe, verdict: RecipeDecision) {
        guard let id = recipe.id else { return }
        FirestoreService.recordTasteFeedback(uid: uid, recipeId: id, [
            "title": recipe.title,
            "cuisine": recipe.cuisine,
            "mains": recipe.ingredients.prefix(5).map(\.name),
            "verdict": verdict.rawValue,
        ])
    }

    // MARK: - Chiusura run → grocery list

    /// Ingredienti che le ricette kept chiedono, fusi per nome.
    private func itemsFromKeptRecipes() -> [GroceryItem] {
        var merged: [String: GroceryItem] = [:]
        var order: [String] = []

        for recipe in keptRecipes {
            guard let recipeId = recipe.id else { continue }
            for ingredient in recipe.ingredients {
                let key = ingredient.name.lowercased().trimmingCharacters(in: .whitespaces)
                if var existing = merged[key] {
                    if !existing.quantity.contains(ingredient.quantity), !ingredient.quantity.isEmpty {
                        existing.quantity += " + \(ingredient.quantity)"
                    }
                    existing.costUsd = max(existing.costUsd, ingredient.costUsd)
                    existing.recipeIds.append(recipeId)
                    merged[key] = existing
                } else {
                    merged[key] = GroceryItem(
                        name: ingredient.name,
                        quantity: ingredient.quantity,
                        storeSection: ingredient.storeSection,
                        costUsd: ingredient.costUsd,
                        checked: false,
                        recipeIds: [recipeId]
                    )
                    order.append(key)
                }
            }
        }
        return order.compactMap { merged[$0] }
    }

    /// Tiene gli item a mano che sono ANCORA in lista. Quelli cancellati
    /// restano fuori: il reset non deve far tornare il limone che hai
    /// tolto tu, solo l'aglio che apparteneva a una ricetta.
    private func appendingManuals(to recipeItems: [GroceryItem]) -> [GroceryItem] {
        var items = recipeItems
        var already = Set(items.map { $0.name.lowercased() })
        for extra in (run?.groceryItems ?? []).filter(\.isAddedByHand) {
            let key = extra.name.lowercased()
            if already.contains(key) { continue }
            items.append(extra)
            already.insert(key)
        }
        return items
    }

    /// Costruisce la lista della spesa dai kept (merge deterministico
    /// client-side: nessuna attesa del backend) e passa a shopping.
    func finishRun() {
        let items = appendingManuals(to: itemsFromKeptRecipes())

        guard !isDemo else {
            run?.groceryItems = items
            run?.status = .shopping
            return
        }

        guard let data = try? JSONEncoder().encode(items),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return }

        FirestoreService.setRunFields(scope: scope, runId: runId, [
            "status": RunStatus.shopping.rawValue,
            "groceryItems": array,
        ])
        jobs.ping("list.finish")
        publishOwnLiveActivity(items: items)

        // Lista condivisa appena pronta: l'altra persona se la vede
        // comparire sulla lock screen, senza aprire l'app.
        if scope.isShared {
            notifyPartner(
                checked: 0,
                total: items.count,
                spent: 0,
                itemName: nil
            )
        }

        // Fusione richiesta all'avvio: la lista appena costruita viene
        // unita dall'AI a quella della run target; questa run finisce
        // in archivio con il rimando. Flag ottimistico sulla target
        // così la card mostra subito "Merging lists…".
        if let target = mergeTargetRunId {
            FirestoreService.setRunFields(scope: scope, runId: target, ["merging": true])
            Task {
                try? await jobs.start("/runs/merge", body: scoped([
                    "targetRunId": target,
                    "sourceRunId": runId,
                ]))
            }
        }
    }

    /// Ingrediente (o detersivo) digitato o pescato dallo storico.
    /// Stesso nome già in lista: non si duplica, si torna false.
    @discardableResult
    func addManualItem(name: String, quantity: String = "") -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let key = trimmed.lowercased()
        var items = run?.groceryItems ?? []
        if items.contains(where: { $0.name.lowercased() == key }) { return false }
        items.append(GroceryItem(
            name: trimmed,
            quantity: quantity.trimmingCharacters(in: .whitespacesAndNewlines),
            storeSection: .other,
            costUsd: 0,
            checked: false,
            recipeIds: [],
            manual: true
        ))
        if run == nil {
            run = Run(
                id: runId,
                status: .shopping,
                craving: "manual",
                title: "Shopping list",
                groceryItems: items
            )
        }
        setItems(items)
        return true
    }

    /// Ricette salvate attaccate a una lista già aperta: ogni
    /// ingrediente entra (o si fonde per nome), la ricetta resta kept.
    /// Quelle già in lista (stesso `savedRecipeId`) si saltano.
    @discardableResult
    func addSavedRecipes(_ saved: [SavedRecipe]) -> [SavedRecipe] {
        let already = Set(recipes.compactMap(\.savedRecipeId))
        let toAdd = saved.filter { recipe in
            guard let id = recipe.id else { return true }
            return !already.contains(id)
        }
        guard !toAdd.isEmpty else { return [] }

        let startingOrder = (recipes.compactMap(\.order).max() ?? -1) + 1
        let plan = LocalListBuilder.planAppend(
            recipes: toAdd,
            toRun: runId,
            scope: scope,
            existingItems: run?.groceryItems ?? [],
            startingOrder: startingOrder
        )

        if isDemo {
            applyAppend(plan)
            return toAdd
        }

        guard FirebaseBootstrap.isConfigured else { return [] }
        let runRef = FirestoreService.db.document(FirestoreService.runPath(scope, runId))
        let batch = FirestoreService.db.batch()
        for (ref, data) in plan.recipeWrites {
            batch.setData(data, forDocument: ref)
        }
        var fields: [String: Any] = [:]
        if let encoded = LocalListBuilder.encode(plan.items) {
            fields["groceryItems"] = encoded
        }
        if scope.isShared {
            fields["lastActorUid"] = uid
            fields["lastActorName"] = actorName
        }
        if !fields.isEmpty {
            batch.setData(fields, forDocument: runRef, merge: true)
        }
        batch.commit()
        applyAppend(plan)
        publishOwnLiveActivity(items: plan.items)
        if scope.isShared {
            notifyPartner(
                checked: plan.items.filter(\.checked).count,
                total: plan.items.count,
                spent: plan.items.filter(\.checked).reduce(0) { $0 + $1.costUsd },
                itemName: nil
            )
        }
        return toAdd
    }

    private func applyAppend(_ plan: LocalListBuilder.AppendPlan) {
        if run == nil {
            run = Run(
                id: runId,
                status: .shopping,
                craving: "manual",
                title: "Shopping list",
                groceryItems: plan.items
            )
        } else {
            run?.groceryItems = plan.items
        }
        for recipe in plan.recipes where !recipes.contains(where: { $0.id == recipe.id }) {
            recipes.append(recipe)
        }
    }

    func removeItem(_ item: GroceryItem) {
        var items = run?.groceryItems ?? []
        items.removeAll { $0.id == item.id }
        setItems(items)
    }

    /// Rimette gli ingredienti delle ricette di questa lista. Gli item
    /// aggiunti a mano restano com'erano (cancellati restano cancellati).
    /// Le spunte sulle righe che c'erano ancora si conservano.
    func resetRecipeIngredients() {
        let current = run?.groceryItems ?? []
        let checkedNames = Set(
            current
                .filter { $0.checked && !$0.isAddedByHand }
                .map { $0.name.lowercased() }
        )
        var idsByName: [String: String] = [:]
        for item in current where !item.isAddedByHand {
            idsByName[item.name.lowercased()] = item.id
        }

        var recipeItems = itemsFromKeptRecipes()
        for index in recipeItems.indices {
            let key = recipeItems[index].name.lowercased()
            if let id = idsByName[key] {
                recipeItems[index].id = id
            }
            if checkedNames.contains(key) {
                recipeItems[index].checked = true
            }
        }
        setItems(appendingManuals(to: recipeItems))
    }

    /// `justChecked` è il nome dell'articolo appena messo nel carrello:
    /// viaggia fino alla lock screen dell'altra persona.
    func setBudget(_ amount: Double) {
        let value = max(0, amount)
        run?.budgetUsd = value
        guard !isDemo else { return }
        FirestoreService.setRunFields(scope: scope, runId: runId, ["budgetUsd": value])
    }

    func setItemPrice(id: String, costUsd: Double) {
        var items = run?.groceryItems ?? []
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].costUsd = max(0, costUsd)
        setItems(items)
    }

    func setItems(_ items: [GroceryItem], justChecked: String? = nil) {
        guard !isDemo else {
            run?.groceryItems = items
            return
        }
        guard let data = try? JSONEncoder().encode(items),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return }

        var fields: [String: Any] = ["groceryItems": array]
        if scope.isShared {
            fields["lastActorUid"] = uid
            fields["lastActorName"] = actorName
            // Deselezionare qualcosa non è una notizia da raccontare:
            // il campo si svuota invece di riportare l'ultima presa.
            fields["lastItemName"] = justChecked ?? FieldValue.delete()
        }
        FirestoreService.setRunFields(scope: scope, runId: runId, fields)
        run?.groceryItems = items
        publishOwnLiveActivity(items: items)

        guard scope.isShared else { return }
        let checked = items.filter(\.checked)
        notifyPartner(
            checked: checked.count,
            total: items.count,
            spent: checked.reduce(0) { $0 + $1.costUsd },
            itemName: justChecked
        )
    }

    /// La propria Live Activity non riceve il push (quello è per il
    /// partner). Senza questo aggiornamento immediato resta ferma sul
    /// numero di quando l'ha fatta nascere l'altra persona.
    private func publishOwnLiveActivity(items: [GroceryItem]) {
        let checked = items.filter(\.checked)
        LiveActivityManager.shared.sync(.init(
            runId: runId,
            listTitle: run.map(planTitle) ?? "Shopping run",
            spaceName: spaceName,
            spaceId: scope.spaceId,
            budgetUsd: budgetUsd,
            checked: checked.count,
            total: items.count,
            spentUsd: checked.reduce(0) { $0 + $1.costUsd },
            lastActorName: nil,
            lastItemName: nil
        ))
    }

    /// Sveglia la Live Activity dell'altra persona anche a telefono
    /// bloccato: senza push resterebbe ferma finché non riapre l'app.
    ///
    /// Al carrello si spuntano quattro cose di fila mentre si cammina.
    /// Un push per ognuna sono quattro aggiornamenti in due secondi, che
    /// APNs consegna nell'ordine che gli pare: si aspetta la pausa e si
    /// manda solo lo stato finale, che è l'unico che conta davvero.
    private func notifyPartner(checked: Int, total: Int, spent: Double, itemName: String?) {
        guard let spaceId = scope.spaceId else { return }
        var body: [String: Any] = [
            "spaceId": spaceId,
            "runId": runId,
            "checkedCount": checked,
            "totalCount": total,
            "spentUsd": spent,
            "actorName": actorName,
            "listTitle": run.map(planTitle) ?? "Shared list",
            "budgetUsd": budgetUsd,
        ]
        if let itemName { body["itemName"] = itemName }

        broadcastTask?.cancel()

        // L'avvio della spesa non è una spunta: è la notizia che fa
        // nascere la Live Activity dall'altra parte, e ritardarla
        // servirebbe solo a farla arrivare tardi.
        guard itemName != nil else {
            broadcastTask = nil
            Task { [jobs] in try? await jobs.call("/spaces/activity/broadcast", body: body) }
            return
        }

        broadcastTask = Task { [jobs] in
            try? await Task.sleep(for: .milliseconds(1200))
            guard !Task.isCancelled else { return }
            try? await jobs.call("/spaces/activity/broadcast", body: body)
        }
    }

    func archive() {
        guard !isDemo else { return }
        FirestoreService.setRunFields(scope: scope, runId: runId, ["status": RunStatus.archived.rawValue])
    }

    /// Lista nata e mai riempita: non resta sulla home come
    /// "Shopping now 0/0". True se l'abbiamo buttata.
    /// `run == nil` è caricamento, non vuoto: cancellare lì
    /// cancellerebbe una lista vera riaperta un frame troppo presto.
    @discardableResult
    func discardIfEmpty() -> Bool {
        guard let run else { return false }
        let items = run.groceryItems ?? []
        guard items.isEmpty, recipes.isEmpty else { return false }
        guard !isDemo else { return true }
        Task { try? await FirestoreService.deleteRun(scope: scope, runId: runId) }
        return true
    }

    // MARK: - Salvataggio ricette (stella → Recipes tab)

    func isSaved(_ recipe: Recipe) -> Bool {
        guard let id = recipe.id else { return false }
        return savedRecipeIds.contains(id)
    }

    func saveToCollection(_ recipe: Recipe) {
        guard !isDemo else { return }
        if let id = recipe.id {
            guard !savedRecipeIds.contains(id) else { return }
            savedRecipeIds.insert(id)
        }
        var payload: [String: Any] = [
            "title": recipe.title,
            "oneLiner": recipe.oneLiner,
            "cuisine": recipe.cuisine,
            "costUsd": recipe.costUsd,
            "cookMinutes": recipe.cookMinutes,
            "servings": recipe.servings,
            "steps": recipe.steps,
            "origin": "run",
        ]
        if let imageUrl = recipe.imageUrl { payload["imageUrl"] = imageUrl }
        if let data = try? JSONEncoder().encode(recipe.ingredients),
           let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            payload["ingredients"] = array
        }
        FirestoreService.saveRecipe(uid: uid, payload)
        jobs.ping("recipe.save")
    }
}
