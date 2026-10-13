import Foundation

// Contenuti del taste quiz. Non è una decorazione: è l'unica occasione
// in cui l'utente ci dice i suoi gusti PRIMA di aver swipato qualcosa,
// e alimenta ogni generazione (ricette, swap, menu scan).
//
// Due round di gusto, due segnali:
//  1. ingredienti divisivi da escludere  → hard exclusions
//  2. 15 piatti da votare like / neutro / dislike, uno per foto
// I voti diventano lovedDishes, dislikedDishes, neutralDishes.

struct QuizTile: Identifiable, Equatable {
    let id: String
    let emoji: String
    let label: String
    /// Cucine che questo piatto segnala (per le affinità)
    let cuisines: [String]
    /// true se il piatto è piccante (per inferire la spice tolerance)
    let spicy: Bool

    init(_ id: String, _ emoji: String, _ label: String, cuisines: [String] = [], spicy: Bool = false) {
        self.id = id
        self.emoji = emoji
        self.label = label
        self.cuisines = cuisines
        self.spicy = spicy
    }
}

/// Un piatto famoso con la sua foto. I `traits` sono le dimensioni di
/// gusto che il piatto rappresenta: due utenti che scartano "fritto"
/// e "crudo" hanno profili molto diversi anche scegliendo lo stesso
/// numero di piatti.
struct QuizDish: Identifiable, Equatable {
    enum Trait: String {
        case comfort        // avvolgente, familiare
        case fresh          // crudo, verdure, leggero
        case spicy
        case creamy
        case brothy         // zuppe e brodi
        case fried
        case hearty         // sazia come un secondo: tofu, tempeh, legumi
        case seaFlavour     // alga, nori: il "sapore di mare" senza pesce
        case fermented      // kimchi, tempeh, funky
        case herbaceous     // erbe fresche in quantità
        case plantForward
        case cheesy
        case sweetSavory    // frutta secca/dolce nel salato
        case handheld       // si mangia con le mani
        case carbHeavy
    }

    let id: String
    let imageName: String
    let title: String
    let cuisine: String
    let traits: [Trait]
    let spicy: Bool

    init(_ id: String, image: String, title: String, cuisine: String, traits: [Trait], spicy: Bool = false) {
        self.id = id
        self.imageName = image
        self.title = title
        self.cuisine = cuisine
        self.traits = traits
        self.spicy = spicy
    }
}

enum QuizContent {
    /// Round 1 — ingredienti su cui la gente si divide davvero. Chi li
    /// odia li odia e basta: qui si guadagna più fiducia che altrove.
    static let dividingIngredients: [QuizTile] = [
        QuizTile("garlic", "🧄", "Garlic"),
        QuizTile("onion", "🧅", "Onion"),
        QuizTile("cilantro", "🌿", "Cilantro"),
        QuizTile("chili", "🌶️", "Chili heat", spicy: true),
        QuizTile("artichokes", "🌾", "Artichokes"),
        QuizTile("mushrooms", "🍄", "Mushrooms"),
        QuizTile("olives", "🫒", "Olives"),
        QuizTile("eggplant", "🍆", "Eggplant"),
        QuizTile("seaweed", "🌊", "Seaweed"),
        QuizTile("blue cheese", "🧀", "Blue cheese"),
        QuizTile("tofu", "⬜", "Tofu"),
        QuizTile("coconut", "🥥", "Coconut"),
        QuizTile("beets", "🥬", "Beets"),
        QuizTile("peanuts", "🥜", "Peanuts"),
        QuizTile("pickles", "🥒", "Pickles"),
    ]

    /// Round 2 — "quali di questi ami?". Dodici piatti notissimi che
    /// coprono assi diversi: comfort italiano, arrosto casalingo,
    /// crudo, piccante, brodo, street food, fresco, mediorientale.
    ///
    /// Tutti plant-based, nella versione che Cherry cucinerebbe davvero.
    /// Chiedere a chi apre un'app per smettere di mangiare carne se
    /// ordinerebbe un pollo arrosto è, insieme, stonato e inutile: la
    /// risposta che serve è "ti piace quell'asse di gusto", e la dà
    /// benissimo il cavolfiore arrosto.
    static let lovedRound: [QuizDish] = [
        QuizDish("pasta_tomato", image: "quiz_pasta_tomato", title: "Spaghetti with tomato & basil",
                 cuisine: "Italian", traits: [.comfort, .carbHeavy, .plantForward]),
        QuizDish("roast_cauliflower", image: "quiz_roast_cauliflower", title: "Whole roast cauliflower & potatoes",
                 cuisine: "American", traits: [.comfort, .hearty, .plantForward]),
        QuizDish("margherita", image: "quiz_margherita", title: "Margherita pizza",
                 cuisine: "Italian", traits: [.comfort, .cheesy, .carbHeavy, .handheld]),
        QuizDish("tikka_masala", image: "quiz_tikka_masala", title: "Chickpea tikka masala",
                 cuisine: "Indian", traits: [.creamy, .spicy, .hearty], spicy: true),
        QuizDish("sushi", image: "quiz_sushi", title: "Avocado & cucumber sushi",
                 cuisine: "Japanese", traits: [.fresh, .seaFlavour, .carbHeavy]),
        QuizDish("tacos", image: "quiz_tacos", title: "Black bean & mushroom tacos",
                 cuisine: "Mexican", traits: [.handheld, .hearty, .spicy], spicy: true),
        QuizDish("ramen", image: "quiz_ramen", title: "Miso ramen with tofu",
                 cuisine: "Japanese", traits: [.brothy, .comfort, .hearty]),
        QuizDish("greek_salad", image: "quiz_greek_salad", title: "Greek salad with feta",
                 cuisine: "Greek", traits: [.fresh, .plantForward, .cheesy]),
        QuizDish("burger", image: "quiz_burger", title: "Smash burger with melted cheese",
                 cuisine: "American", traits: [.comfort, .hearty, .cheesy, .handheld]),
        QuizDish("falafel", image: "quiz_falafel", title: "Falafel & hummus plate",
                 cuisine: "Middle Eastern", traits: [.plantForward, .fried, .herbaceous]),
        QuizDish("pad_thai", image: "quiz_pad_thai", title: "Pad thai with crispy tofu",
                 cuisine: "Thai", traits: [.carbHeavy, .sweetSavory, .fried]),
        QuizDish("shakshuka", image: "quiz_shakshuka", title: "Chickpea shakshuka",
                 cuisine: "Middle Eastern", traits: [.comfort, .plantForward, .spicy], spicy: true),
    ]

    /// Round 3 — "quali non sceglieresti mai?". Altri dodici piatti,
    /// scelti per coprire gli assi che il round precedente NON tocca:
    /// piccante spinto, fermentato, alla griglia, fritto, dolce-salato,
    /// zuppe umili, bowl vegetali. Plant-based anche questi.
    static let dislikedRound: [QuizDish] = [
        QuizDish("green_curry", image: "quiz_green_curry", title: "Thai green curry with tofu",
                 cuisine: "Thai", traits: [.spicy, .creamy], spicy: true),
        QuizDish("bibimbap", image: "quiz_bibimbap", title: "Kimchi & tofu bibimbap",
                 cuisine: "Korean", traits: [.fermented, .spicy, .plantForward], spicy: true),
        QuizDish("grilled_tempeh", image: "quiz_grilled_tempeh", title: "Grilled marinated tempeh",
                 cuisine: "American", traits: [.hearty, .fermented]),
        QuizDish("mac_cheese", image: "quiz_mac_cheese", title: "Baked mac & cheese",
                 cuisine: "American", traits: [.cheesy, .comfort, .carbHeavy]),
        QuizDish("lentil_stew", image: "quiz_lentil_stew", title: "Lentil stew",
                 cuisine: "Mediterranean", traits: [.plantForward, .brothy, .comfort]),
        QuizDish("pho", image: "quiz_pho", title: "Mushroom pho",
                 cuisine: "Vietnamese", traits: [.brothy, .herbaceous, .hearty]),
        QuizDish("paella", image: "quiz_paella", title: "Vegetable paella",
                 cuisine: "Spanish", traits: [.plantForward, .carbHeavy]),
        QuizDish("tofu_chips", image: "quiz_tofu_chips", title: "Battered tofu & chips",
                 cuisine: "British", traits: [.fried, .seaFlavour, .comfort]),
        QuizDish("tagine", image: "quiz_tagine", title: "Veggie couscous tagine",
                 cuisine: "Moroccan", traits: [.sweetSavory, .plantForward, .carbHeavy]),
        QuizDish("kung_pao", image: "quiz_kung_pao", title: "Kung pao tofu",
                 cuisine: "Chinese", traits: [.spicy, .fried], spicy: true),
        QuizDish("veg_bowl", image: "quiz_veg_bowl", title: "Roasted veggie grain bowl",
                 cuisine: "Californian", traits: [.plantForward, .fresh]),
        QuizDish("poke", image: "quiz_poke", title: "Tofu poke bowl",
                 cuisine: "Hawaiian", traits: [.fresh, .seaFlavour]),
    ]

    static var allDishes: [QuizDish] { lovedRound + dislikedRound }

    /// I 15 piatti del rating: un mazzo misto dai due round, così
    /// comfort, piccante, brodo, fresco e fermentato stanno tutti
    /// nello stesso mazzo. Uno per schermata, voto obbligatorio.
    static let ratingRound: [QuizDish] = {
        let order = [
            "pasta_tomato", "tacos", "ramen", "greek_salad", "green_curry",
            "burger", "sushi", "bibimbap", "falafel", "pho",
            "margherita", "tikka_masala", "veg_bowl", "pad_thai", "roast_cauliflower",
        ]
        let byId = Dictionary(uniqueKeysWithValues: allDishes.map { ($0.id, $0) })
        return order.compactMap { byId[$0] }
    }()

    /// Chip predefinite per le allergie (più campo libero).
    static let exclusionSuggestions: [String] = [
        "Gluten", "Soy", "Nuts", "Peanuts", "Sesame", "Dairy", "Shellfish", "Corn",
    ]
}
