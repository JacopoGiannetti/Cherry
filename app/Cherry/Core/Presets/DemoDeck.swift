import Foundation

// Il deck della prova guidata nell'onboarding: le stesse 12 ricette dei
// piani curati, servite come catalogo locale. Nessun account, nessuna
// chiamata al backend — l'utente prova il flusso vero prima di pagare.
enum DemoDeck {
    /// Le cucine per cui esistono davvero ricette di prova. Le altre
    /// restano visibili col lucchetto: la demo non promette quello che
    /// non può servire.
    static let unlockedCuisines: Set<String> = ["Italian", "Greek", "Japanese", "American"]

    // Il catalogo vale $114. Con il fondo scala a $60 il budget si
    // riempie qualunque cosa scelga l'utente, quindi la celebrazione
    // arriva sempre e la prova non finisce in un vicolo cieco.
    static let budgetRange: ClosedRange<Double> = 20...60
    static let defaultBudget: Double = 40
    static let quickPicks: [Double] = [25, 40, 55]

    /// Il deck con le cucine scelte in cima. Nell'app vera i craving
    /// sono una preferenza che orienta il menu, non un filtro secco:
    /// qui vale lo stesso, ed è ciò che tiene il budget raggiungibile
    /// anche con una sola cucina selezionata.
    ///
    /// Gli `exclusions` del quiz pesano più della cucina: "never on
    /// your plate" è una promessa più dura di "questa settimana mi va
    /// il giapponese". Le ricette che li contengono scendono in fondo,
    /// così con un budget da prova quasi nessuno le incontra. Non si
    /// possono eliminare del tutto (senza aglio e cipolla resterebbero
    /// 2 ricette su 12): dove arrivano comunque, la lista lo dichiara.
    static func deck(preferring cravings: [String], avoiding exclusions: [String] = []) -> [Recipe] {
        let preferred = cravings.filter { unlockedCuisines.contains($0) }
        let catalog = PresetPlans.all.flatMap(\.recipes)

        func hasExcluded(_ preset: PresetPlans.PresetRecipe) -> Bool {
            preset.ingredients.contains { matchesExclusion($0.name, exclusions: exclusions) }
        }

        let ordered = catalog.enumerated().sorted { left, right in
            let leftExcluded = hasExcluded(left.element)
            let rightExcluded = hasExcluded(right.element)
            if leftExcluded != rightExcluded { return !leftExcluded }
            let leftRank = rank(left.element.cuisine, in: preferred)
            let rightRank = rank(right.element.cuisine, in: preferred)
            if leftRank != rightRank { return leftRank < rightRank }
            return left.offset < right.offset
        }

        return ordered.enumerated().map { position, entry in
            recipe(from: entry.element, order: position)
        }
    }

    /// Confronto tollerante: "onions" del quiz deve prendere anche
    /// "red onion" e "yellow onion" nelle ricette.
    static func matchesExclusion(_ ingredientName: String, exclusions: [String]) -> Bool {
        let name = ingredientName.lowercased()
        return exclusions.contains { exclusion in
            let key = exclusion.lowercased().trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { return false }
            let singular = key.hasSuffix("s") ? String(key.dropLast()) : key
            return name.contains(singular)
        }
    }

    /// Gli ingredienti esclusi dal profilo che sono finiti comunque in
    /// lista: servono all'avviso "sono ricette di esempio".
    static func excludedHits(in items: [GroceryItem], exclusions: [String]) -> [String] {
        var seen = Set<String>()
        var hits: [String] = []
        for item in items where matchesExclusion(item.name, exclusions: exclusions) {
            let key = item.name.lowercased()
            if seen.insert(key).inserted { hits.append(item.name) }
        }
        return hits
    }

    private static func rank(_ cuisine: String, in preferred: [String]) -> Int {
        preferred.firstIndex(of: cuisine) ?? preferred.count
    }

    private static func recipe(from preset: PresetPlans.PresetRecipe, order: Int) -> Recipe {
        var recipe = Recipe(title: preset.title)
        recipe.id = "demo-\(slug(preset.title))"
        recipe.oneLiner = preset.oneLiner
        recipe.cuisine = preset.cuisine
        recipe.costUsd = preset.costUsd
        recipe.cookMinutes = preset.cookMinutes
        recipe.servings = 2
        recipe.ingredients = preset.ingredients
        recipe.steps = preset.steps
        recipe.imageUrl = preset.imageUrl
        recipe.imageStatus = "ready"
        recipe.decision = .pending
        recipe.order = order
        return recipe
    }

    private static func slug(_ text: String) -> String {
        let cleaned = text.lowercased().map { character -> Character in
            character.isLetter || character.isNumber ? character : "-"
        }
        return String(cleaned)
            .split(separator: "-", omittingEmptySubsequences: true)
            .joined(separator: "-")
    }
}
