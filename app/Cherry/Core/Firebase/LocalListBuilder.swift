import Foundation
import FirebaseFirestore

// Lista della spesa dalle ricette salvate costruita sul telefono.
// Il backend faceva la stessa fusione deterministica (zero AI), ma
// richiedeva rete: al supermercato senza campo l'utente restava a mani
// vuote. Firestore accoda le scritture e i listener leggono dalla cache,
// quindi la lista compare subito e si sincronizza quando torna la linea.
enum LocalListBuilder {
    /// Ricette (e ingredienti) pronti da attaccare a una lista già aperta.
    struct AppendPlan {
        var items: [GroceryItem]
        var recipes: [Recipe]
        var recipeWrites: [(DocumentReference, [String: Any])]
    }

    /// Lista vuota: si apre e si scrive a mano, senza swipe.
    static func startBlankRun(scope: DataScope) -> String {
        startManualRun(scope: scope, itemNames: [], recipes: []) ?? {
            let runId = UUID().uuidString
            FirestoreService.setRunFields(scope: scope, runId: runId, [
                "status": RunStatus.shopping.rawValue,
                "craving": "manual",
                "title": "Shopping list",
                "budgetUsd": 0,
                "servings": 2,
                "groceryItems": [],
                "createdAt": FieldValue.serverTimestamp(),
            ])
            return runId
        }()
    }

    /// Lista nata già piena: niente documento 0/0. `nil` se non c'è
    /// nulla da mettere nel carrello.
    static func startManualRun(
        scope: DataScope,
        itemNames: [String],
        recipes: [SavedRecipe]
    ) -> String? {
        let names = itemNames
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !names.isEmpty || !recipes.isEmpty else { return nil }

        let runId = UUID().uuidString
        var items: [GroceryItem] = []
        var seen: Set<String> = []
        for name in names {
            let key = name.lowercased()
            guard seen.insert(key).inserted else { continue }
            items.append(GroceryItem(
                name: name,
                quantity: "",
                storeSection: AisleGuess.section(for: name),
                costUsd: 0,
                checked: false,
                recipeIds: [],
                manual: true
            ))
        }

        FirestoreService.archiveActiveRuns(scope: scope)

        if recipes.isEmpty {
            var fields: [String: Any] = [
                "status": RunStatus.shopping.rawValue,
                "craving": "manual",
                "title": "Shopping list",
                "budgetUsd": 0,
                "servings": 2,
                "createdAt": FieldValue.serverTimestamp(),
            ]
            if let encoded = encode(items) { fields["groceryItems"] = encoded }
            FirestoreService.setRunFields(scope: scope, runId: runId, fields)
            return runId
        }

        guard FirebaseBootstrap.isConfigured else { return nil }
        let plan = planAppend(
            recipes: recipes,
            toRun: runId,
            scope: scope,
            existingItems: items,
            startingOrder: 0
        )
        let runRef = FirestoreService.db.document(FirestoreService.runPath(scope, runId))
        let batch = FirestoreService.db.batch()
        for (ref, data) in plan.recipeWrites {
            batch.setData(data, forDocument: ref)
        }
        var runData: [String: Any] = [
            "status": RunStatus.shopping.rawValue,
            "craving": recipes.isEmpty ? "manual" : "from_recipes",
            "title": "Shopping list",
            "budgetUsd": ceil(recipes.reduce(0) { $0 + $1.costUsd }),
            "servings": recipes.first?.servings ?? 2,
            "progressStage": "done",
            "createdAt": FieldValue.serverTimestamp(),
        ]
        if let encoded = encode(plan.items) { runData["groceryItems"] = encoded }
        batch.setData(runData, forDocument: runRef)
        batch.commit()
        return runId
    }

    /// Restituisce l'id della run creata, o nil se non c'è nulla da costruire.
    @discardableResult
    static func buildRun(scope: DataScope, from recipes: [SavedRecipe]) -> String? {
        guard FirebaseBootstrap.isConfigured, !recipes.isEmpty else { return nil }
        FirestoreService.archiveActiveRuns(scope: scope)

        let runId = UUID().uuidString
        let runRef = FirestoreService.db.document(FirestoreService.runPath(scope, runId))
        let batch = FirestoreService.db.batch()

        var items: [GroceryItem] = []
        var indexByName: [String: Int] = [:]
        var totalCost: Double = 0

        for (order, recipe) in recipes.enumerated() {
            let recipeRef = runRef.collection("recipes").document()
            totalCost += recipe.costUsd
            batch.setData(recipePayload(from: recipe, order: order), forDocument: recipeRef)
            fold(recipe.ingredients, recipeId: recipeRef.documentID, into: &items, indexByName: &indexByName)
        }

        var runData: [String: Any] = [
            "status": RunStatus.shopping.rawValue,
            "craving": "from_recipes",
            "budgetUsd": ceil(totalCost),
            "servings": recipes.first?.servings ?? 2,
            "progressStage": "done",
            "createdAt": FieldValue.serverTimestamp(),
        ]
        if let encoded = encode(items) { runData["groceryItems"] = encoded }
        batch.setData(runData, forDocument: runRef)

        // Niente await: offline il commit resta in coda, ma la UI vede
        // già i dati grazie alla latency compensation di Firestore.
        batch.commit()
        return runId
    }

    /// Prepara fusione ingredienti + documenti ricetta, senza scrivere.
    static func planAppend(
        recipes: [SavedRecipe],
        toRun runId: String,
        scope: DataScope,
        existingItems: [GroceryItem],
        startingOrder: Int
    ) -> AppendPlan {
        let runRef: DocumentReference? = FirebaseBootstrap.isConfigured
            ? FirestoreService.db.document(FirestoreService.runPath(scope, runId))
            : nil
        var items = existingItems
        var indexByName: [String: Int] = [:]
        for (index, item) in items.enumerated() {
            let key = item.name.lowercased().trimmingCharacters(in: .whitespaces)
            if indexByName[key] == nil { indexByName[key] = index }
        }

        var planned: [Recipe] = []
        var writes: [(DocumentReference, [String: Any])] = []

        for (offset, recipe) in recipes.enumerated() {
            let recipeId = UUID().uuidString
            let order = startingOrder + offset
            if let runRef {
                writes.append((runRef.collection("recipes").document(recipeId), recipePayload(from: recipe, order: order)))
            }
            planned.append(makeRecipe(from: recipe, id: recipeId, order: order))
            fold(recipe.ingredients, recipeId: recipeId, into: &items, indexByName: &indexByName)
        }

        return AppendPlan(items: items, recipes: planned, recipeWrites: writes)
    }

    /// Aggiunge ricette a una lista già aperta, senza crearne una seconda.
    @discardableResult
    static func appendRecipes(_ recipes: [SavedRecipe], toExisting run: Run, scope: DataScope) -> String? {
        guard let runId = run.id, !recipes.isEmpty else { return nil }
        let plan = planAppend(
            recipes: recipes,
            toRun: runId,
            scope: scope,
            existingItems: run.groceryItems ?? [],
            startingOrder: (run.groceryItems ?? []).count
        )
        guard FirebaseBootstrap.isConfigured else { return nil }
        let runRef = FirestoreService.db.document(FirestoreService.runPath(scope, runId))
        let batch = FirestoreService.db.batch()
        for (ref, data) in plan.recipeWrites {
            batch.setData(data, forDocument: ref)
        }
        var fields: [String: Any] = ["status": RunStatus.shopping.rawValue]
        if let encoded = encode(plan.items) { fields["groceryItems"] = encoded }
        batch.setData(fields, forDocument: runRef, merge: true)
        batch.commit()
        return runId
    }

    static func appendRecipes(
        _ recipes: [SavedRecipe],
        toRunId runId: String,
        scope: DataScope,
        done: @escaping (Bool) -> Void
    ) {
        guard FirebaseBootstrap.isConfigured else { done(false); return }
        FirestoreService.db.document(FirestoreService.runPath(scope, runId)).getDocument { snap, _ in
            guard let snap, let run = try? snap.data(as: Run.self) else {
                done(false)
                return
            }
            done(appendRecipes(recipes, toExisting: run, scope: scope) != nil)
        }
    }

    static func encode<T: Encodable>(_ value: [T]) -> [[String: Any]]? {
        guard let data = try? JSONEncoder().encode(value),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return nil }
        return array
    }

    private static func recipePayload(from recipe: SavedRecipe, order: Int) -> [String: Any] {
        var payload: [String: Any] = [
            "title": recipe.title,
            "oneLiner": recipe.oneLiner ?? "",
            "cuisine": recipe.cuisine ?? "",
            "costUsd": recipe.costUsd,
            "cookMinutes": recipe.cookMinutes,
            "servings": recipe.servings,
            "steps": recipe.steps,
            "decision": RecipeDecision.kept.rawValue,
            "order": order,
            "imageStatus": recipe.imageUrl == nil ? "failed" : "ready",
            "createdAt": FieldValue.serverTimestamp(),
        ]
        if let imageUrl = recipe.imageUrl { payload["imageUrl"] = imageUrl }
        if let savedId = recipe.id { payload["savedRecipeId"] = savedId }
        if let encoded = encode(recipe.ingredients) { payload["ingredients"] = encoded }
        return payload
    }

    private static func makeRecipe(from saved: SavedRecipe, id: String, order: Int) -> Recipe {
        var recipe = Recipe(title: saved.title)
        recipe.id = id
        recipe.oneLiner = saved.oneLiner ?? ""
        recipe.cuisine = saved.cuisine ?? ""
        recipe.costUsd = saved.costUsd
        recipe.cookMinutes = saved.cookMinutes
        recipe.servings = saved.servings
        recipe.ingredients = saved.ingredients
        recipe.steps = saved.steps
        recipe.imageUrl = saved.imageUrl
        recipe.imageStatus = saved.imageUrl == nil ? "failed" : "ready"
        recipe.decision = .kept
        recipe.order = order
        recipe.savedRecipeId = saved.id
        return recipe
    }

    private static func fold(
        _ ingredients: [Ingredient],
        recipeId: String,
        into items: inout [GroceryItem],
        indexByName: inout [String: Int]
    ) {
        for ingredient in ingredients {
            let key = ingredient.name.lowercased().trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { continue }

            if let index = indexByName[key] {
                if !ingredient.quantity.isEmpty,
                   !items[index].quantity.contains(ingredient.quantity) {
                    items[index].quantity += " + \(ingredient.quantity)"
                }
                // Ingrediente condiviso: si compra una volta sola,
                // quindi vale il costo maggiore, non la somma.
                items[index].costUsd = max(items[index].costUsd, ingredient.costUsd)
                if !items[index].recipeIds.contains(recipeId) {
                    items[index].recipeIds.append(recipeId)
                }
                // Ora appartiene a una ricetta: i pallini devono comparire,
                // e il reset lo deve poter riportare.
                items[index].manual = false
            } else {
                indexByName[key] = items.count
                items.append(
                    GroceryItem(
                        name: ingredient.name,
                        quantity: ingredient.quantity,
                        storeSection: ingredient.storeSection,
                        costUsd: ingredient.costUsd,
                        recipeIds: [recipeId]
                    )
                )
            }
        }
    }
}
