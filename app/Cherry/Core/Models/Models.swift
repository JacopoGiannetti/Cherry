import Foundation
import FirebaseFirestore

// Modelli speculari ai documenti Firestore scritti dal backend.
// L'app legge sempre e solo questi.

// MARK: - Profilo

enum DietaryIdentity: String, Codable, CaseIterable, Identifiable {
    case omnivore, vegan, vegetarian, pescatarian
    /// Profili vecchi: non si offre più, ma i documenti già salvati
    /// devono ancora decodificare.
    case reducer
    var id: String { rawValue }

    /// Le identità che si possono scegliere oggi, dalla meno restrittiva.
    static var choices: [DietaryIdentity] { [.omnivore, .vegetarian, .pescatarian, .vegan] }

    var title: String {
        switch self {
        case .omnivore: "Everything"
        case .vegan: "Vegan"
        case .vegetarian: "Vegetarian"
        case .pescatarian: "Pescatarian"
        case .reducer: "Meat reducer"
        }
    }

    var subtitle: String {
        switch self {
        case .omnivore: "No rules, all of it"
        case .vegan: "Fully plant-based"
        case .vegetarian: "No meat or fish"
        case .pescatarian: "Fish is fine, no meat"
        case .reducer: "Eating less meat, more plants"
        }
    }

    /// Chi segue una dieta vegetale: per lui "veganizza" è il gesto
    /// principale, per gli altri è una delle trasformazioni.
    var isPlantBased: Bool { self != .omnivore }
}

struct TasteProfile: Codable, Equatable {
    var dietaryIdentity: DietaryIdentity = .omnivore
    var exclusions: [String] = []
    var cuisineAffinities: [String] = []
    var spiceTolerance: String = "medium"
    var effortTolerance: String = "balanced"
    var likedDishes: [String] = []
    /// Dal quiz piatti (15 voti like / neutro / dislike). Optional:
    /// i profili creati prima di questo quiz non hanno i campi.
    var lovedDishes: [String]?
    var dislikedDishes: [String]?
    var neutralDishes: [String]?
    /// Elettrodomestici disponibili in cucina (id di `KitchenAppliance`).
    /// Si scelgono alla prima spesa e restano preselezionati dopo.
    /// nil = mai dichiarati, si parte dai più comuni.
    var appliances: [String]?
    /// Le ricette della stessa spesa condividono erbe, scatolette e tofu,
    /// così la lista è più corta. nil = il default del server (acceso).
    var ingredientSharing: Bool?
    /// Lingua delle risposte AI (ricette, swap, verdetti). La UI
    /// dell'app resta in inglese. Optional: i profili vecchi non
    /// hanno il campo. nil = English.
    var language: String?
    /// `us` o `metric`. nil = default della lingua.
    var units: String?
    /// `USD`, `EUR` o `GBP`. nil = default della lingua.
    var currency: String?

    var resolvedUnits: MeasurementSystem {
        MeasurementSystem(rawValue: units ?? "")
            ?? ResponseLanguage(rawValue: language ?? "en")?.defaultUnits
            ?? .us
    }

    var resolvedCurrency: DisplayCurrency {
        DisplayCurrency(rawValue: currency ?? "")
            ?? ResponseLanguage(rawValue: language ?? "en")?.defaultCurrency
            ?? .usd
    }

    var moneySymbol: String { resolvedCurrency.symbol }

    func money(_ amount: Double) -> String {
        "\(moneySymbol)\(Int(amount.rounded()))"
    }

    /// Lingua nuova → unità e valuta di quella lingua. Poi si possono
    /// cambiare a mano senza toccare la lingua.
    mutating func applyLanguageDefaults() {
        let lang = ResponseLanguage(rawValue: language ?? "en") ?? .en
        units = lang.defaultUnits.rawValue
        currency = lang.defaultCurrency.rawValue
    }
}

/// Lingue offerte per le risposte dei modelli.
enum ResponseLanguage: String, CaseIterable, Identifiable {
    case en, it, es, fr, de, pt
    var id: String { rawValue }

    var title: String {
        switch self {
        case .en: "English"
        case .it: "Italiano"
        case .es: "Español"
        case .fr: "Français"
        case .de: "Deutsch"
        case .pt: "Português"
        }
    }

    var defaultUnits: MeasurementSystem { self == .en ? .us : .metric }
    var defaultCurrency: DisplayCurrency { self == .en ? .usd : .eur }
}

enum MeasurementSystem: String, CaseIterable, Identifiable {
    case us, metric
    var id: String { rawValue }

    var title: String {
        switch self {
        case .us: "US (cups, oz)"
        case .metric: "Metric (g, ml)"
        }
    }
}

enum DisplayCurrency: String, CaseIterable, Identifiable {
    case usd = "USD"
    case eur = "EUR"
    case gbp = "GBP"
    var id: String { rawValue }

    var title: String {
        switch self {
        case .usd: "US Dollar ($)"
        case .eur: "Euro (€)"
        case .gbp: "British Pound (£)"
        }
    }

    var symbol: String {
        switch self {
        case .usd: "$"
        case .eur: "€"
        case .gbp: "£"
        }
    }
}

struct SubscriptionInfo: Codable, Equatable {
    var status: String?
    var productId: String?
    var lastEvent: String?
}

struct UserDoc: Codable {
    var tasteProfile: TasteProfile?
    var subscription: SubscriptionInfo?
    /// Nome con cui appaio all'altra persona nello spazio condiviso, e
    /// con cui l'app mi saluta. Chiesto in onboarding.
    var displayName: String?
    /// Come l'utente ha conosciuto Cherry (chiesto in onboarding).
    var referralSource: String?
    /// Cosa dice che lo blocca (chiesto in onboarding, in ordine di
    /// scelta): rawValue di `OnboardingBlocker`. Il primo è quello che
    /// pesa di più, ed è quello a cui l'app risponde per prima.
    var blockers: [String]?
    /// Ultimo spazio scelto: lo switch segue l'utente tra i dispositivi.
    /// nil = spazio personale.
    var activeSpaceId: String?
}

// MARK: - Spazi condivisi

/// Dove vivono i dati in questo momento: nel mio albero o in uno spazio
/// condiviso. Le liste della spesa seguono lo scope; profilo, ricette
/// salvate, scansioni e abbonamento restano sempre personali.
struct DataScope: Equatable {
    let uid: String
    let spaceId: String?

    var isShared: Bool { spaceId != nil }

    /// Prefisso Firestore di tutto ciò che è "di questo scope".
    var root: String {
        guard let spaceId else { return "users/\(uid)" }
        return "spaces/\(spaceId)"
    }

    static func personal(_ uid: String) -> DataScope { DataScope(uid: uid, spaceId: nil) }
}

struct SpaceMember: Codable, Identifiable, Hashable {
    var uid: String
    var name: String = ""
    var id: String { uid }

    /// Iniziali per l'avatar, senza scomodare foto profilo.
    var initials: String {
        let letters = name.split(separator: " ").compactMap(\.first).prefix(2)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }
}

struct Space: Codable, Identifiable {
    @DocumentID var id: String?
    var name: String = ""
    var memberUids: [String] = []
    var members: [SpaceMember] = []
    /// Codice di 6 caratteri da dettare all'altra persona. Sparisce
    /// quando lo spazio è pieno.
    var inviteCode: String?
    var createdBy: String?
    var createdAt: Date?

    /// L'altra persona, vista da me.
    func partner(of uid: String) -> SpaceMember? {
        members.first { $0.uid != uid }
    }

    var isFull: Bool { memberUids.count >= 2 }
}

// MARK: - Grocery Run

enum StoreSection: String, Codable, CaseIterable, Identifiable {
    case produce
    case grainsPasta = "grains_pasta"
    case proteins
    case dairyAlternatives = "dairy_alternatives"
    case cannedJarred = "canned_jarred"
    case spicesCondiments = "spices_condiments"
    case nutsSeeds = "nuts_seeds"
    case bakery
    case frozen
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .produce: "Produce"
        case .grainsPasta: "Grains & Pasta"
        case .proteins: "Proteins"
        case .dairyAlternatives: "Dairy Alternatives"
        case .cannedJarred: "Canned & Jarred"
        case .spicesCondiments: "Spices & Condiments"
        case .nutsSeeds: "Nuts & Seeds"
        case .bakery: "Bakery"
        case .frozen: "Frozen"
        case .other: "Other"
        }
    }

    var symbol: String {
        switch self {
        case .produce: "carrot"
        case .grainsPasta: "takeoutbag.and.cup.and.straw"
        case .proteins: "leaf"
        case .dairyAlternatives: "drop"
        case .cannedJarred: "cylinder"
        case .spicesCondiments: "sparkles"
        case .nutsSeeds: "circle.hexagongrid"
        case .bakery: "birthday.cake"
        case .frozen: "snowflake"
        case .other: "bag"
        }
    }
}

struct Ingredient: Codable, Equatable, Hashable {
    var name: String
    var quantity: String
    var storeSection: StoreSection = .other
    var costUsd: Double = 0

    enum CodingKeys: String, CodingKey { case name, quantity, storeSection, costUsd }

    init(name: String, quantity: String, storeSection: StoreSection = .other, costUsd: Double = 0) {
        self.name = name
        self.quantity = quantity
        self.storeSection = storeSection
        self.costUsd = costUsd
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        quantity = (try? c.decode(String.self, forKey: .quantity)) ?? ""
        storeSection = (try? c.decode(StoreSection.self, forKey: .storeSection)) ?? .other
        costUsd = (try? c.decode(Double.self, forKey: .costUsd)) ?? 0
    }
}

enum RecipeDecision: String, Codable {
    case pending, kept, passed
}

struct Recipe: Codable, Identifiable, Equatable {
    @DocumentID var id: String?
    var title: String
    var oneLiner: String = ""
    var cuisine: String = ""
    var costUsd: Double = 0
    var cookMinutes: Int = 0
    var servings: Int = 2
    var ingredients: [Ingredient] = []
    var steps: [String] = []
    var imageUrl: String?
    var imageStatus: String? // pending / ready / failed
    var decision: RecipeDecision? = RecipeDecision.pending
    var order: Int? = 0
    var savedRecipeId: String?

    static func == (lhs: Recipe, rhs: Recipe) -> Bool { lhs.id == rhs.id && lhs.imageUrl == rhs.imageUrl && lhs.decision == rhs.decision && lhs.steps == rhs.steps }
}

enum RunStatus: String, Codable {
    case draft, generating, swiping, shopping, archived
}

struct GroceryItem: Codable, Identifiable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var quantity: String = ""
    var storeSection: StoreSection = .other
    var costUsd: Double = 0
    var checked: Bool = false
    var recipeIds: [String] = []      // per i dot colorati
    var substitutedFrom: String?
    /// Scritto solo se true: le app vecchie ignorano la chiave, e un
    /// documento senza `manual` resta "dalle ricette".
    var manual: Bool = false

    /// Niente pallini ricetta: aggiunto a mano, o senza origini.
    var isAddedByHand: Bool { manual || recipeIds.isEmpty }

    enum CodingKeys: String, CodingKey {
        case id, name, quantity, storeSection, costUsd, checked, recipeIds, substitutedFrom, manual
    }

    init(
        id: String = UUID().uuidString,
        name: String,
        quantity: String = "",
        storeSection: StoreSection = .other,
        costUsd: Double = 0,
        checked: Bool = false,
        recipeIds: [String] = [],
        substitutedFrom: String? = nil,
        manual: Bool = false
    ) {
        self.id = id
        self.name = name
        self.quantity = quantity
        self.storeSection = storeSection
        self.costUsd = costUsd
        self.checked = checked
        self.recipeIds = recipeIds
        self.substitutedFrom = substitutedFrom
        self.manual = manual
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        name = try c.decode(String.self, forKey: .name)
        quantity = (try? c.decode(String.self, forKey: .quantity)) ?? ""
        storeSection = (try? c.decode(StoreSection.self, forKey: .storeSection)) ?? .other
        costUsd = (try? c.decode(Double.self, forKey: .costUsd)) ?? 0
        checked = (try? c.decode(Bool.self, forKey: .checked)) ?? false
        recipeIds = (try? c.decode([String].self, forKey: .recipeIds)) ?? []
        substitutedFrom = try? c.decode(String.self, forKey: .substitutedFrom)
        manual = (try? c.decode(Bool.self, forKey: .manual)) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(quantity, forKey: .quantity)
        try c.encode(storeSection, forKey: .storeSection)
        try c.encode(costUsd, forKey: .costUsd)
        try c.encode(checked, forKey: .checked)
        try c.encode(recipeIds, forKey: .recipeIds)
        try c.encodeIfPresent(substitutedFrom, forKey: .substitutedFrom)
        if manual { try c.encode(true, forKey: .manual) }
    }
}

struct Run: Codable, Identifiable {
    @DocumentID var id: String?
    var status: RunStatus = .draft
    /// Etichetta leggibile della scelta al Beat 1 (anche multipla).
    var craving: String = "surprise"
    /// Nome scelto dall'utente: quando c'è vince sul titolo dedotto.
    var title: String?
    var cravings: [String]?
    var budgetUsd: Double = 50
    var servings: Int = 2
    var groceryItems: [GroceryItem]?
    var createdAt: Date?

    // Progresso della generazione, scritto dal backend man mano.
    var progressStage: String?   // recipes / images / done
    var imagesDone: Int?
    var imagesTotal: Int?

    // Fusione di run multiple: true mentre il backend sta unendo,
    // mergedInto sulla run sorgente archiviata.
    var merging: Bool?
    var mergedInto: String?

    /// Piano curato da Cherry, seminato al primo avvio (badge "Cherry pick").
    var preset: Bool?

    // Ultima spunta, per raccontarla all'altra persona nello spazio
    // condiviso ("Sara ha preso il latte") in app e in Live Activity.
    var lastActorUid: String?
    var lastActorName: String?
    var lastItemName: String?
}

// MARK: - Jobs (stato dei lavori fire-and-forget)

enum JobStatus: String, Codable {
    case running, done, error
}

struct Job: Codable, Identifiable {
    @DocumentID var id: String?
    var type: String = ""
    var status: JobStatus = .running
    var errorCode: String?
    var errorMessage: String?
    var runId: String?
    var scanId: String?
    var swapId: String?
}

// MARK: - Scan

struct MenuBox: Codable, Equatable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

struct MenuDish: Codable, Equatable, Identifiable {
    var id: String { dishName }
    var dishName: String
    var description: String?
    var waiterPhrase: String?
    var priceText: String?
    var photoIndex: Int = 0
    var box: MenuBox?
    /// Stime per porzione: assenti sugli scan vecchi.
    var kcal: Double?
    var proteinG: Double?
    var carbsG: Double?
    /// yes / ask / no, con `veganPhrase` quando basta chiedere.
    var vegan: String?
    var veganPhrase: String?
}

struct ProductInfo: Codable, Equatable {
    var barcode: String?
    var name: String = ""
    var brand: String?
    var imageUrl: String?
    var ingredientsText: String?
    var quantity: String?
    /// "100 g" o "100 ml": a cosa si riferiscono i valori.
    var per: String?
    var nutrition: ProductNutrition?
    var nutriScore: String?
    var nova: Int?
}

/// Valori per 100 g da Open Food Facts. Tutti opzionali tranne le kcal.
struct ProductNutrition: Codable, Equatable {
    var kcal: Double
    var protein: Double?
    var carbs: Double?
    var sugars: Double?
    var fat: Double?
    var saturatedFat: Double?
    var fiber: Double?
    var salt: Double?
}

/// Le etichette in cima allo scan: nil = non si sa.
struct ProductBadges: Codable, Equatable {
    var vegan: Bool?
    var vegetarian: Bool?
    var highProtein: Bool?
}

struct OffendingIngredient: Codable, Equatable, Identifiable {
    var id: String { name }
    var name: String
    var category: String
}

struct Verdict: Codable, Equatable {
    var fits: Bool?
    var label: String = ""
    var offendingIngredients: [OffendingIngredient] = []
}

struct Scan: Codable, Identifiable {
    @DocumentID var id: String?
    var type: String = "" // menu / product
    var status: String = "running" // running / done / not_found
    var storagePaths: [String]?
    var restaurantName: String?
    var bestBets: [MenuDish]?
    var askForThese: [MenuDish]?
    var barcode: String?
    var product: ProductInfo?
    var verdict: Verdict?
    var badges: ProductBadges?
    var createdAt: Date?
}

// MARK: - Swap

struct SubstituteOption: Codable, Equatable, Identifiable {
    var id: String { name }
    var name: String
    var quantity: String = ""
    var rationale: String = ""
    var storeSection: StoreSection = .other
    var costUsd: Double = 0
}

struct LedgerLine: Codable, Equatable, Identifiable {
    var id: String { originalName }
    var originalName: String
    var quantity: String = ""
    var isCompatible: Bool
    var substitutes: [SubstituteOption] = []
}

struct SwapSource: Codable, Equatable {
    var type: String = "link" // link / screenshot / text
    var url: String?
    var platform: String?
    var thumbnail: String?
}

struct SwapRecipe: Codable, Equatable {
    var title: String = ""
    var oneLiner: String?
    var cuisine: String?
    var costUsd: Double?
    var cookMinutes: Int = 0
    var servings: Int = 2
    var ingredients: [Ingredient] = []
    var steps: [String] = []
    var imageUrl: String?
    var imagePrompt: String?
}

struct Swap: Codable, Identifiable {
    @DocumentID var id: String?
    var status: String = "extracting" // extracting / extracted / building_ledger / ledger_ready / finalized
    /// L'obiettivo del ledger (`SwapGoal`). nil = ricetta letta, nessuna scelta ancora.
    var goal: String?
    var source: SwapSource?
    var original: SwapRecipe?
    var ledger: [LedgerLine]?
    var finalRecipe: SwapRecipe?
    var createdAt: Date?
}

// MARK: - Saved recipes (§6: da run o da swap, indistinti)

struct SavedRecipe: Codable, Identifiable {
    @DocumentID var id: String?
    var title: String
    var oneLiner: String?
    var cuisine: String?
    var costUsd: Double = 0
    var cookMinutes: Int = 0
    var servings: Int = 2
    var ingredients: [Ingredient] = []
    var steps: [String] = []
    var imageUrl: String?
    var origin: String? // "run" / "swap" / "imported" / "vego" (suggerita da noi)
    /// Link al post social/pagina da cui la ricetta è stata importata:
    /// permette di rivedere l'originale, e di trasformarla più tardi
    /// se era stata salvata as-is.
    var sourceUrl: String?
    /// Per le ricette trasformate (`origin == "swap"`): il `SwapGoal`.
    /// nil sulle vecchie, che erano tutte veganizzate.
    var swapGoal: String?
    var createdAt: Date?

    /// Ricetta suggerita da Cherry, seminata al primo avvio.
    var preset: Bool?

    /// "ai" quando la foto l'ha fatta Cherry al posto del fotogramma del
    /// video. nil = foto del post, scattata da chi l'ha pubblicato.
    var imageSource: String?
    /// Copertina richiesta (`/swap/cover`): "generating" o "failed".
    var coverStatus: String?
    var coverError: String?

    /// La foto della ricetta l'ha generata l'AI: per le importate solo se
    /// è stata rifatta, per tutte le altre sempre.
    var hasAIPhoto: Bool {
        guard origin == "imported" else { return origin != "manual" }
        return imageSource == "ai"
    }
}

extension SavedRecipe: Hashable {
    static func == (lhs: SavedRecipe, rhs: SavedRecipe) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - Parachute (sostituzione in corsia)

struct Parachute: Codable, Identifiable {
    @DocumentID var id: String?
    var ingredientName: String = ""
    var substitutes: [SubstituteOption] = []
    var affectedRecipeIds: [String] = []
}
