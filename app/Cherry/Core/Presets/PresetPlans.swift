import Foundation
import FirebaseFirestore

// I 4 meal plan curati da Cherry, seminati al primo avvio perché la
// sezione dei piani passati non sia mai vuota. Tutti per 2 persone,
// budget distribuiti, 100% vegani. Le foto sono state generate una
// volta con fal (stesso stile delle ricette live) e restano hostate lì.
enum PresetPlans {
    struct PresetRecipe {
        let title: String
        let oneLiner: String
        let cuisine: String
        let costUsd: Double
        let cookMinutes: Int
        let imageUrl: String
        let ingredients: [Ingredient]
        let steps: [String]

        func asKeptRecipe(id: String, order: Int) -> Recipe {
            var recipe = Recipe(title: title)
            recipe.id = id
            recipe.oneLiner = oneLiner
            recipe.cuisine = cuisine
            recipe.costUsd = costUsd
            recipe.cookMinutes = cookMinutes
            recipe.servings = 2
            recipe.ingredients = ingredients
            recipe.steps = steps
            recipe.imageUrl = imageUrl
            recipe.imageStatus = "ready"
            recipe.decision = .kept
            recipe.order = order
            return recipe
        }
    }

    struct PresetPlan {
        let name: String
        let recipes: [PresetRecipe]
        var totalCostUsd: Double { recipes.reduce(0) { $0 + $1.costUsd } }
    }

    private static func ing(
        _ name: String, _ quantity: String,
        _ section: StoreSection, _ cost: Double
    ) -> Ingredient {
        Ingredient(name: name, quantity: quantity, storeSection: section, costUsd: cost)
    }

    // MARK: - Le ricette

    static let rigatoni = PresetRecipe(
        title: "Creamy Tomato & Basil Rigatoni",
        oneLiner: "The 25-minute pasta that tastes like Sunday.",
        cuisine: "Italian",
        costUsd: 8, cookMinutes: 25,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cb1/qJIbs9y0dxiurkP-j-w53.jpg",
        ingredients: [
            ing("rigatoni", "200 g", .grainsPasta, 1.5),
            ing("cherry tomatoes", "300 g", .produce, 2.2),
            ing("cashews", "60 g", .nutsSeeds, 1.4),
            ing("garlic", "3 cloves", .produce, 0.3),
            ing("fresh basil", "1 bunch", .produce, 1.5),
            ing("olive oil", "2 tbsp", .spicesCondiments, 0.4),
            ing("nutritional yeast", "2 tbsp", .spicesCondiments, 0.7),
        ],
        steps: [
            "Soak the cashews in boiling water while you cook; blend them later with 120 ml water into a silky cream.",
            "Cook the rigatoni in well-salted water until 1 minute short of al dente.",
            "Sizzle the garlic in olive oil, add the halved cherry tomatoes and cook 8 minutes until they collapse into a sauce.",
            "Stir in the cashew cream and nutritional yeast, then loosen with a ladle of pasta water.",
            "Toss the pasta in the sauce for the final minute, tear in the basil off the heat and serve.",
        ]
    )

    static let risotto = PresetRecipe(
        title: "Wild Mushroom Risotto",
        oneLiner: "Creamy, deep, and worth every stir.",
        cuisine: "Italian",
        costUsd: 11, cookMinutes: 35,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cb1/AxABWpqKeZPtoCdARzOir.jpg",
        ingredients: [
            ing("arborio rice", "180 g", .grainsPasta, 2.0),
            ing("mixed mushrooms", "300 g", .produce, 3.5),
            ing("vegetable stock", "750 ml", .cannedJarred, 1.0),
            ing("yellow onion", "1", .produce, 0.5),
            ing("garlic", "2 cloves", .produce, 0.2),
            ing("olive oil", "3 tbsp", .spicesCondiments, 0.6),
            ing("fresh parsley", "1 handful", .produce, 1.0),
            ing("nutritional yeast", "3 tbsp", .spicesCondiments, 1.0),
        ],
        steps: [
            "Sear the mushrooms in a hot dry pan until golden; set aside with a pinch of salt.",
            "Soften the diced onion and garlic in olive oil, then toast the rice for 2 minutes until translucent at the edges.",
            "Add hot stock one ladle at a time, stirring, waiting for each to absorb — about 18 minutes.",
            "Fold in the mushrooms and nutritional yeast with the last ladle of stock.",
            "Rest 2 minutes off the heat, shower with parsley and black pepper, serve immediately.",
        ]
    )

    static let ribollita = PresetRecipe(
        title: "Tuscan White Bean Ribollita",
        oneLiner: "The bean stew nonnas swear by.",
        cuisine: "Italian",
        costUsd: 9, cookMinutes: 30,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cc4/pgkwhaghcE_OtocHfOCvu.jpg",
        ingredients: [
            ing("cannellini beans", "2 cans", .cannedJarred, 2.2),
            ing("cavolo nero (or kale)", "200 g", .produce, 2.0),
            ing("sourdough bread", "4 thick slices", .bakery, 1.5),
            ing("carrot", "1", .produce, 0.3),
            ing("celery", "2 stalks", .produce, 0.4),
            ing("canned tomatoes", "400 g", .cannedJarred, 1.0),
            ing("rosemary", "2 sprigs", .produce, 0.5),
            ing("olive oil", "3 tbsp", .spicesCondiments, 0.6),
        ],
        steps: [
            "Sweat the diced carrot and celery in olive oil with the rosemary for 5 minutes.",
            "Add the tomatoes, beans with their liquid and 400 ml water; simmer 15 minutes.",
            "Stir in the shredded cavolo nero and cook 5 more minutes until tender.",
            "Tear in the bread and let it drink up the broth — the stew should be thick enough to stand a spoon in.",
            "Finish with a generous swirl of olive oil and cracked pepper.",
        ]
    )

    static let gyros = PresetRecipe(
        title: "Crispy Chickpea Gyros",
        oneLiner: "Street-food Athens, zero lamb needed.",
        cuisine: "Greek",
        costUsd: 9, cookMinutes: 25,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cb1/UlYgEogCLxfXrlJhfL2p_.jpg",
        ingredients: [
            ing("chickpeas", "1 can", .cannedJarred, 1.1),
            ing("pita breads", "4", .bakery, 2.0),
            ing("soy yogurt", "200 g", .dairyAlternatives, 1.8),
            ing("cucumber", "1/2", .produce, 0.5),
            ing("tomato", "1 large", .produce, 0.7),
            ing("red onion", "1/2", .produce, 0.3),
            ing("smoked paprika", "2 tsp", .spicesCondiments, 0.3),
            ing("lemon", "1", .produce, 0.5),
        ],
        steps: [
            "Pat the chickpeas dry, toss with smoked paprika, oregano and oil, and roast at 220°C for 20 minutes until crackly.",
            "Grate the cucumber, squeeze it dry, and stir into the yogurt with lemon juice and garlic — instant tzatziki.",
            "Warm the pitas in the oven for the last 2 minutes.",
            "Load each pita with tzatziki, hot chickpeas, tomato and red onion.",
            "Wrap the bottom in paper like a street vendor and eat over the sink. Mandatory.",
        ]
    )

    static let briam = PresetRecipe(
        title: "Golden Roasted Briam",
        oneLiner: "Sunday-slow roasted veg, Greek-island style.",
        cuisine: "Greek",
        costUsd: 8, cookMinutes: 45,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cc4/pbK1Ugedo3NFtuOUqAdAc.jpg",
        ingredients: [
            ing("zucchini", "2", .produce, 1.2),
            ing("eggplant", "1", .produce, 1.3),
            ing("potatoes", "400 g", .produce, 0.9),
            ing("ripe tomatoes", "400 g", .produce, 1.8),
            ing("red onion", "1", .produce, 0.5),
            ing("olive oil", "80 ml", .spicesCondiments, 1.5),
            ing("dried oregano", "1 tbsp", .spicesCondiments, 0.2),
            ing("garlic", "4 cloves", .produce, 0.4),
        ],
        steps: [
            "Slice everything into thin rounds; grate half the tomatoes into a juice.",
            "Layer the vegetables in a baking dish, tucking garlic slivers between them.",
            "Pour over the tomato juice and olive oil — be brave with the oil, it IS the sauce.",
            "Roast at 200°C for 40-45 minutes until the edges catch and caramelize.",
            "Rest 10 minutes and serve warm, not hot, with bread for the juices.",
        ]
    )

    static let orzo = PresetRecipe(
        title: "Lemon Orzo with Tofu Feta",
        oneLiner: "Bright, briny, picnic-ready.",
        cuisine: "Greek",
        costUsd: 8, cookMinutes: 25,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cc6/C1om6QhF5-vEvCHqeDoSL.jpg",
        ingredients: [
            ing("orzo", "200 g", .grainsPasta, 1.4),
            ing("firm tofu", "200 g", .proteins, 1.9),
            ing("kalamata olives", "80 g", .cannedJarred, 1.5),
            ing("cherry tomatoes", "200 g", .produce, 1.5),
            ing("lemon", "1", .produce, 0.5),
            ing("olive oil", "3 tbsp", .spicesCondiments, 0.6),
            ing("dried oregano", "2 tsp", .spicesCondiments, 0.2),
        ],
        steps: [
            "Cube the tofu and marinate it 10 minutes in lemon juice, oregano and a big pinch of salt — it turns feta-ish.",
            "Cook the orzo, drain, and rinse briefly so it stays loose.",
            "Toss the orzo with olive oil, halved tomatoes and olives.",
            "Fold in the tofu feta with its marinade.",
            "Taste, add more lemon than you think, and serve at room temperature.",
        ]
    )

    static let friedRice = PresetRecipe(
        title: "Crispy Tofu Fried Rice",
        oneLiner: "Better than takeout, ready in 20.",
        cuisine: "Japanese",
        costUsd: 6, cookMinutes: 20,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cc4/e42wZnxaK4NKTJC9xpVuN.jpg",
        ingredients: [
            ing("jasmine rice", "180 g", .grainsPasta, 1.0),
            ing("firm tofu", "250 g", .proteins, 2.2),
            ing("frozen peas & carrots", "200 g", .frozen, 1.0),
            ing("soy sauce", "3 tbsp", .spicesCondiments, 0.4),
            ing("scallions", "3", .produce, 0.6),
            ing("garlic", "2 cloves", .produce, 0.2),
            ing("fresh ginger", "1 thumb", .produce, 0.4),
            ing("sesame oil", "1 tbsp", .spicesCondiments, 0.4),
        ],
        steps: [
            "Cook the rice ahead if you can — cold rice fries better.",
            "Crumble the tofu into a hot oiled pan and let it sit untouched until golden and crispy underneath.",
            "Push aside, sizzle the garlic and ginger, then add the frozen veg straight from the bag.",
            "Add the rice, break it up, and fry on high heat 3 minutes without stirring too much.",
            "Season with soy sauce and sesame oil, top with scallions, serve blazing hot.",
        ]
    )

    static let ramen = PresetRecipe(
        title: "Creamy Peanut Ramen",
        oneLiner: "The 15-minute bowl that hugs back.",
        cuisine: "Japanese",
        costUsd: 7, cookMinutes: 15,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cb1/CLxlnYR73wcFK6ox_OtbN.jpg",
        ingredients: [
            ing("ramen noodles", "2 portions", .grainsPasta, 1.8),
            ing("peanut butter", "3 tbsp", .nutsSeeds, 0.8),
            ing("bok choy", "2 heads", .produce, 1.6),
            ing("vegetable stock", "800 ml", .cannedJarred, 1.0),
            ing("soy sauce", "2 tbsp", .spicesCondiments, 0.3),
            ing("garlic", "2 cloves", .produce, 0.2),
            ing("fresh ginger", "1 thumb", .produce, 0.4),
            ing("chili oil", "to taste", .spicesCondiments, 0.5),
        ],
        steps: [
            "Sizzle the garlic and ginger, then whisk in the stock, soy sauce and peanut butter until creamy.",
            "Simmer 5 minutes so the broth thickens slightly.",
            "Drop in the halved bok choy for the last 2 minutes.",
            "Cook the noodles separately and divide between bowls — never boil noodles in the broth.",
            "Pour over the broth, drizzle with chili oil, slurp loudly.",
        ]
    )

    static let eggplant = PresetRecipe(
        title: "Sticky Teriyaki Eggplant Bowls",
        oneLiner: "Glossy, sticky, dangerously good.",
        cuisine: "Japanese",
        costUsd: 7, cookMinutes: 25,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cb1/KPyzLO1kSSJPq1dMnS-b9.jpg",
        ingredients: [
            ing("eggplants", "2", .produce, 2.6),
            ing("jasmine rice", "180 g", .grainsPasta, 1.0),
            ing("soy sauce", "4 tbsp", .spicesCondiments, 0.5),
            ing("maple syrup", "2 tbsp", .spicesCondiments, 0.7),
            ing("rice vinegar", "1 tbsp", .spicesCondiments, 0.3),
            ing("garlic", "2 cloves", .produce, 0.2),
            ing("sesame seeds", "1 tbsp", .nutsSeeds, 0.3),
            ing("scallions", "2", .produce, 0.4),
        ],
        steps: [
            "Score the eggplant flesh in a diamond pattern and pan-fry cut-side down until deeply golden.",
            "Whisk soy, maple, vinegar and garlic into a teriyaki sauce.",
            "Pour the sauce over the eggplant and let it bubble and glaze for 3-4 minutes, spooning it over.",
            "Steam the rice while the eggplant cooks.",
            "Serve the glossy eggplant over rice, showered with sesame and scallions.",
        ]
    )

    static let lasagna = PresetRecipe(
        title: "Mushroom & Lentil Lasagna",
        oneLiner: "The centerpiece that silences skeptics.",
        cuisine: "Italian",
        costUsd: 16, cookMinutes: 60,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cb1/7lY_QNHfXaRtepH7-xaGc.jpg",
        ingredients: [
            ing("lasagna sheets", "250 g", .grainsPasta, 2.0),
            ing("brown lentils", "250 g cooked", .cannedJarred, 1.3),
            ing("mushrooms", "400 g", .produce, 3.5),
            ing("canned tomatoes", "800 g", .cannedJarred, 2.0),
            ing("plant milk", "500 ml", .dairyAlternatives, 1.4),
            ing("flour", "3 tbsp", .grainsPasta, 0.2),
            ing("yellow onion", "1", .produce, 0.5),
            ing("nutritional yeast", "4 tbsp", .spicesCondiments, 1.3),
            ing("olive oil", "4 tbsp", .spicesCondiments, 0.8),
        ],
        steps: [
            "Brown the chopped mushrooms hard, then add onion, lentils and tomatoes; simmer 20 minutes into a rich ragù.",
            "Whisk oil, flour and plant milk over heat into a white sauce; season with nutritional yeast and nutmeg.",
            "Layer ragù, sheets and white sauce; repeat three times, ending with white sauce.",
            "Bake at 190°C for 35 minutes until burnished and bubbling at the edges.",
            "The hard part: rest it 15 minutes before cutting, or it collapses.",
        ]
    )

    static let butternutMac = PresetRecipe(
        title: "Butternut Mac & \"Cheese\"",
        oneLiner: "Velvet sauce, golden crunch.",
        cuisine: "American",
        costUsd: 12, cookMinutes: 35,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cb1/b7BBOBQ6xYreSnmjwXH6G.jpg",
        ingredients: [
            ing("macaroni", "250 g", .grainsPasta, 1.6),
            ing("butternut squash", "600 g", .produce, 2.4),
            ing("cashews", "80 g", .nutsSeeds, 1.9),
            ing("plant milk", "250 ml", .dairyAlternatives, 0.7),
            ing("nutritional yeast", "4 tbsp", .spicesCondiments, 1.3),
            ing("dijon mustard", "1 tsp", .spicesCondiments, 0.2),
            ing("breadcrumbs", "40 g", .bakery, 0.4),
            ing("garlic", "2 cloves", .produce, 0.2),
        ],
        steps: [
            "Roast the cubed squash at 200°C for 25 minutes until caramelized at the edges.",
            "Blend the squash with soaked cashews, plant milk, nutritional yeast, mustard and garlic until completely smooth.",
            "Cook the macaroni 2 minutes short of the packet time.",
            "Fold pasta and sauce together in a baking dish, top with breadcrumbs and a drizzle of oil.",
            "Grill 5 minutes until the top crackles. Serve in the dish, always.",
        ]
    )

    static let jackfruit = PresetRecipe(
        title: "Smoky BBQ Jackfruit Sliders",
        oneLiner: "Pulled-pork energy, plants only.",
        cuisine: "American",
        costUsd: 13, cookMinutes: 30,
        imageUrl: "https://v3b.fal.media/files/b/0aa65cb1/icaXGX33RJv5X2BoHAtrm.jpg",
        ingredients: [
            ing("young jackfruit", "2 cans", .cannedJarred, 4.0),
            ing("slider buns", "6", .bakery, 2.5),
            ing("BBQ sauce", "150 ml", .spicesCondiments, 1.5),
            ing("red cabbage", "1/4 head", .produce, 0.8),
            ing("vegan mayo", "3 tbsp", .dairyAlternatives, 0.8),
            ing("lime", "1", .produce, 0.5),
            ing("red onion", "1/2", .produce, 0.3),
            ing("smoked paprika", "2 tsp", .spicesCondiments, 0.3),
        ],
        steps: [
            "Drain the jackfruit, squeeze it dry and shred it with two forks — it pulls exactly like pork.",
            "Fry it in a hot pan with smoked paprika until the edges crisp, then stir in the BBQ sauce.",
            "Simmer 10 minutes, mashing occasionally, until sticky and shreddy.",
            "Toss the shredded cabbage and onion with mayo and lime into a sharp slaw.",
            "Pile jackfruit and slaw into toasted buns. Napkins are not optional.",
        ]
    )

    // MARK: - I 4 piani

    static let all: [PresetPlan] = [
        PresetPlan(name: "Tokyo Nights", recipes: [friedRice, ramen, eggplant]),
        PresetPlan(name: "Greek Escape", recipes: [gyros, briam, orzo]),
        PresetPlan(name: "Nonna's Week", recipes: [rigatoni, risotto, ribollita]),
        PresetPlan(name: "Weekend Feast", recipes: [lasagna, butternutMac, jackfruit]),
    ]

    /// Le 4 migliori, pre-caricate in My Collection come suggerimenti.
    static let collectionPicks: [PresetRecipe] = [ramen, gyros, lasagna, eggplant]
}

// MARK: - Seeder: scrive i preset su Firestore una sola volta per utente.

enum PresetSeeder {
    /// Un solo seed in volo per processo: due avvii ravvicinati
    /// vedevano entrambi `existing.isEmpty` e scrivevano due volte.
    private static let lock = NSLock()
    private static var inFlight = Set<String>()

    /// I preset non si seminano più: chi li aveva ricevuti li perde. Le
    /// liste che l'utente sta usando (riaperte per fare la spesa) restano.
    static func removePresets(uid: String) async {
        guard FirebaseBootstrap.isConfigured else { return }
        let db = FirestoreService.db

        if let recipes = try? await db.collection("users/\(uid)/savedRecipes")
            .whereField("preset", isEqualTo: true)
            .getDocuments(), !recipes.isEmpty {
            let batch = db.batch()
            recipes.documents.forEach { batch.deleteDocument($0.reference) }
            try? await batch.commit()
        }

        if let runs = try? await db.collection("users/\(uid)/runs")
            .whereField("preset", isEqualTo: true)
            .getDocuments() {
            let scope = DataScope.personal(uid)
            for doc in runs.documents {
                let status = doc.data()["status"] as? String ?? ""
                guard status == RunStatus.archived.rawValue else { continue }
                try? await FirestoreService.deleteRun(scope: scope, runId: doc.documentID)
            }
        }
    }

    static func seedIfNeeded(uid: String) async {
        guard FirebaseBootstrap.isConfigured else { return }
        let claimed = lock.withLock { () -> Bool in
            guard !inFlight.contains(uid) else { return false }
            inFlight.insert(uid)
            return true
        }
        guard claimed else { return }
        defer { lock.withLock { inFlight.remove(uid) } }

        let db = FirestoreService.db

        // Prima si pulisce: reinstall + vecchi id random lasciavano
        // copie affiancate ai nuovi `preset-{slug}`.
        await prunePresetDuplicates(uid: uid)

        let existing = try? await db.collection("users/\(uid)/runs")
            .whereField("preset", isEqualTo: true)
            .limit(to: 1)
            .getDocuments()
        guard let existing else { return }
        guard existing.isEmpty else {
            await repairMissingPresetRecipes(uid: uid)
            return
        }

        let batch = db.batch()
        let now = Date()

        for (planIndex, plan) in PresetPlans.all.enumerated() {
            let runRef = db.document("users/\(uid)/runs/preset-\(slug(plan.name))")
            let recipeIdsByIngredient = writeRecipes(plan, runRef: runRef, batch: batch)

            batch.setData([
                "status": RunStatus.archived.rawValue,
                "preset": true,
                "craving": plan.name,
                "budgetUsd": plan.totalCostUsd,
                "servings": 2,
                "groceryItems": mergedGroceryItems(for: plan, recipeIds: recipeIdsByIngredient),
                // Sfalsati di un minuto per mantenere l'ordine del catalogo.
                "createdAt": Timestamp(date: now.addingTimeInterval(Double(-60 * (planIndex + 1)))),
            ], forDocument: runRef)
        }

        // Le 4 migliori pre-caricate in My Collection. Id derivato dal
        // titolo: se il seeding riparte (batch a metà, avvio offline)
        // riscrive gli stessi documenti invece di duplicarli.
        for (index, recipe) in PresetPlans.collectionPicks.enumerated() {
            let savedRef = db.document("users/\(uid)/savedRecipes/preset-\(slug(recipe.title))")
            batch.setData([
                "title": recipe.title,
                "oneLiner": recipe.oneLiner,
                "cuisine": recipe.cuisine,
                "costUsd": recipe.costUsd,
                "cookMinutes": recipe.cookMinutes,
                "servings": 2,
                "ingredients": ingredientDicts(recipe.ingredients),
                "steps": recipe.steps,
                "imageUrl": recipe.imageUrl,
                "origin": "vego",
                "preset": true,
                "createdAt": Timestamp(date: now.addingTimeInterval(Double(-60 * (index + 1)))),
            ], forDocument: savedRef)
        }

        do {
            try await batch.commit()
            print("[Presets] 4 piani suggeriti + 4 ricette in collection seminati")
        } catch {
            print("[Presets] seeding fallito: \(error.localizedDescription)")
        }
    }

    /// Le ricette di un piano curato, nella sottocollezione della run.
    /// Ritorna, per ogni ingrediente, le ricette che lo usano: serve
    /// alla lista della spesa per i dot colorati.
    @discardableResult
    private static func writeRecipes(
        _ plan: PresetPlans.PresetPlan,
        runRef: DocumentReference,
        batch: WriteBatch
    ) -> [String: [String]] {
        var recipeIdsByIngredient: [String: [String]] = [:]
        for (order, recipe) in plan.recipes.enumerated() {
            let recipeRef = runRef.collection("recipes").document(slug(recipe.title))
            for ingredient in recipe.ingredients {
                recipeIdsByIngredient[ingredient.name.lowercased(), default: []]
                    .append(recipeRef.documentID)
            }
            batch.setData([
                "title": recipe.title,
                "oneLiner": recipe.oneLiner,
                "cuisine": recipe.cuisine,
                "costUsd": recipe.costUsd,
                "cookMinutes": recipe.cookMinutes,
                "servings": 2,
                "ingredients": ingredientDicts(recipe.ingredients),
                "steps": recipe.steps,
                "imageUrl": recipe.imageUrl,
                "imageStatus": "ready",
                "decision": RecipeDecision.kept.rawValue,
                "order": order,
            ], forDocument: recipeRef)
        }
        return recipeIdsByIngredient
    }

    /// Un piano curato incompleto è una lista monca: un seeding vecchio
    /// poteva scrivere una ricetta sola (e il controllo `limit 1`
    /// considerava il piano a posto). Si riscrivono le ricette mancanti
    /// e si riallineano spesa e budget al catalogo.
    private static func repairMissingPresetRecipes(uid: String) async {
        let db = FirestoreService.db
        guard let snapshot = try? await db.collection("users/\(uid)/runs")
            .whereField("preset", isEqualTo: true)
            .getDocuments()
        else { return }

        for doc in snapshot.documents {
            let craving = doc.data()["craving"] as? String
            guard let plan = PresetPlans.all.first(where: { $0.name == craving }) else { continue }

            let existing = (try? await doc.reference.collection("recipes").getDocuments())?.documents ?? []
            let have = Set(existing.map(\.documentID))
            let expected = Set(plan.recipes.map { slug($0.title) })
            let budget = (doc.data()["budgetUsd"] as? Double) ?? 0
            let items = doc.data()["groceryItems"] as? [[String: Any]] ?? []
            let needsRecipes = !expected.isSubset(of: have)
            let needsBudget = abs(budget - plan.totalCostUsd) > 0.5
            let needsList = items.isEmpty || needsRecipes
            guard needsRecipes || needsBudget || needsList else { continue }

            let batch = db.batch()
            let recipeIds = writeRecipes(plan, runRef: doc.reference, batch: batch)
            batch.setData([
                "budgetUsd": plan.totalCostUsd,
                "groceryItems": mergedGroceryItems(for: plan, recipeIds: recipeIds),
            ], forDocument: doc.reference, merge: true)
            try? await batch.commit()
            print("[Presets] ripristinato \(plan.name) (\(plan.recipes.count) ricette, $\(Int(plan.totalCostUsd)))")
        }
    }

    /// Ripara collection e liste già sporcate da un doppio seeding.
    /// Delle copie con lo stesso titolo/nome sopravvive la più vecchia,
    /// preferendo l'id deterministico `preset-…` se c'è. Tocca solo i
    /// preset, mai quelle salvate dall'utente.
    private static func prunePresetDuplicates(uid: String) async {
        await pruneDuplicateRecipes(uid: uid)
        await pruneDuplicateRuns(uid: uid)
    }

    private static func pruneDuplicateRecipes(uid: String) async {
        let db = FirestoreService.db
        guard let snapshot = try? await db.collection("users/\(uid)/savedRecipes")
            .whereField("preset", isEqualTo: true)
            .getDocuments()
        else { return }

        let duplicates = duplicateRefs(in: snapshot.documents) { document in
            (document.data()["title"] as? String)?.lowercased() ?? document.documentID
        }
        guard !duplicates.isEmpty else { return }

        let batch = db.batch()
        duplicates.forEach { batch.deleteDocument($0) }
        try? await batch.commit()
        print("[Presets] rimosse \(duplicates.count) ricette suggerite duplicate")
    }

    private static func pruneDuplicateRuns(uid: String) async {
        let db = FirestoreService.db
        guard let snapshot = try? await db.collection("users/\(uid)/runs")
            .whereField("preset", isEqualTo: true)
            .getDocuments()
        else { return }

        let duplicates = duplicateRefs(in: snapshot.documents) { document in
            (document.data()["craving"] as? String)?.lowercased()
                ?? (document.data()["title"] as? String)?.lowercased()
                ?? document.documentID
        }
        guard !duplicates.isEmpty else { return }

        let scope = DataScope.personal(uid)
        for ref in duplicates {
            try? await FirestoreService.deleteRun(scope: scope, runId: ref.documentID)
        }
        print("[Presets] rimosse \(duplicates.count) liste suggerite duplicate")
    }

    /// Per ogni titolo/nome tiene un solo documento: l'id `preset-…`
    /// se c'è, altrimenti il più vecchio.
    private static func duplicateRefs(
        in documents: [QueryDocumentSnapshot],
        key: (QueryDocumentSnapshot) -> String
    ) -> [DocumentReference] {
        var groups: [String: [QueryDocumentSnapshot]] = [:]
        for document in documents {
            groups[key(document), default: []].append(document)
        }

        var duplicates: [DocumentReference] = []
        for copies in groups.values where copies.count > 1 {
            let canonical = copies.first { $0.documentID.hasPrefix("preset-") }
            let oldest = copies.min { left, right in
                let leftDate = (left.data()["createdAt"] as? Timestamp)?.dateValue() ?? .distantPast
                let rightDate = (right.data()["createdAt"] as? Timestamp)?.dateValue() ?? .distantPast
                return leftDate < rightDate
            }
            let keepId = canonical?.documentID ?? oldest?.documentID
            for copy in copies where copy.documentID != keepId {
                duplicates.append(copy.reference)
            }
        }
        return duplicates
    }

    /// Id stabile a partire dal titolo: due seeding producono lo stesso
    /// documento, quindi il secondo sovrascrive invece di aggiungere.
    private static func slug(_ text: String) -> String {
        let cleaned = text.lowercased().map { character -> Character in
            character.isLetter || character.isNumber ? character : "-"
        }
        return String(cleaned)
            .split(separator: "-", omittingEmptySubsequences: true)
            .joined(separator: "-")
    }

    private static func ingredientDicts(_ ingredients: [Ingredient]) -> [[String: Any]] {
        ingredients.map {
            [
                "name": $0.name,
                "quantity": $0.quantity,
                "storeSection": $0.storeSection.rawValue,
                "costUsd": $0.costUsd,
            ]
        }
    }

    /// Lista della spesa del piano: ingredienti aggregati per nome,
    /// come fa il wizard vero alla fine dello swipe.
    private static func mergedGroceryItems(
        for plan: PresetPlans.PresetPlan,
        recipeIds: [String: [String]]
    ) -> [[String: Any]] {
        var merged: [String: (ingredient: Ingredient, quantities: [String])] = [:]
        var order: [String] = []

        for recipe in plan.recipes {
            for ingredient in recipe.ingredients {
                let key = ingredient.name.lowercased()
                if var existing = merged[key] {
                    existing.quantities.append(ingredient.quantity)
                    existing.ingredient.costUsd += ingredient.costUsd
                    merged[key] = existing
                } else {
                    merged[key] = (ingredient, [ingredient.quantity])
                    order.append(key)
                }
            }
        }

        return order.compactMap { key in
            guard let entry = merged[key] else { return nil }
            return [
                "id": UUID().uuidString,
                "name": entry.ingredient.name,
                "quantity": entry.quantities.joined(separator: " + "),
                "storeSection": entry.ingredient.storeSection.rawValue,
                "costUsd": (entry.ingredient.costUsd * 100).rounded() / 100,
                "checked": false,
                "recipeIds": recipeIds[key] ?? [],
            ]
        }
    }
}
