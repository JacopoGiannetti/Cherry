import SwiftUI

/// Cosa diventa una ricetta importata. Le diete tolgono gli ingredienti
/// animali; i ritocchi lavorano dentro la dieta del profilo (un vegano
/// che la vuole più proteica la riceve vegana e più proteica).
enum SwapGoal: String, CaseIterable, Identifiable {
    case vegan, vegetarian, pescatarian, protein, light, glutenFree, cheaper
    var id: String { rawValue }

    var word: String {
        switch self {
        case .vegan: "vegan"
        case .vegetarian: "vegetarian"
        case .pescatarian: "meat-free"
        case .protein: "high-protein"
        case .light: "lighter"
        case .glutenFree: "gluten-free"
        case .cheaper: "cheaper"
        }
    }

    var verb: String { "Make it \(word)" }

    /// Un ritocco, non una dieta: lascia gli ingredienti animali dove sono.
    var isTweak: Bool { ![.vegan, .vegetarian, .pescatarian].contains(self) }

    /// Sotto la frase: cosa succede, detto come lo direbbe un cuoco.
    var promise: String {
        switch self {
        case .vegan: "Every animal ingredient gets a swap a chef would actually cook."
        case .vegetarian: "Meat and fish come out. Eggs and cheese stay."
        case .pescatarian: "The meat goes. Fish and seafood can stay."
        case .protein: "More protein on the same plate, without turning it into gym food."
        case .light: "About a third fewer calories, and it still tastes like the real thing."
        case .glutenFree: "Every hidden source of gluten, found and swapped."
        case .cheaper: "Same dish, smaller receipt."
        }
    }

    /// Nella collezione, sotto il titolo.
    var caption: String {
        switch self {
        case .vegan: "made vegan"
        case .vegetarian: "made vegetarian"
        case .pescatarian: "made meat-free"
        case .protein: "high-protein"
        case .light: "lighter"
        case .glutenFree: "gluten-free"
        case .cheaper: "cheaper"
        }
    }

    var magnet: WordMagnet {
        switch self {
        case .vegan: WordMagnet(id: rawValue, word: word, wash: Color(hex: 0xD3EEDC), ink: Color(hex: 0x2E8B57))
        case .vegetarian: WordMagnet(id: rawValue, word: word, wash: Theme.butter, ink: Color(hex: 0x977616))
        case .pescatarian: WordMagnet(id: rawValue, word: word, wash: Color(hex: 0xD5ECEE), ink: Color(hex: 0x2B7C88))
        case .protein: WordMagnet(id: rawValue, word: word, wash: Theme.peach, ink: Color(hex: 0xBF6B36))
        case .light: WordMagnet(id: rawValue, word: word, wash: Theme.sky, ink: Color(hex: 0x3B78A3))
        case .glutenFree: WordMagnet(id: rawValue, word: word, wash: Theme.lavender, ink: Color(hex: 0x6C5FA8))
        case .cheaper: WordMagnet(id: rawValue, word: word, wash: Theme.blush, ink: Color(hex: 0xB0566A))
        }
    }

    /// Prima la propria dieta, poi quelle più strette, poi i ritocchi.
    static func choices(for diet: DietaryIdentity) -> [SwapGoal] {
        let tweaks: [SwapGoal] = [.protein, .light, .glutenFree, .cheaper]
        switch diet {
        case .omnivore: return [.vegan, .vegetarian] + tweaks
        case .vegan: return [.vegan] + tweaks
        case .vegetarian: return [.vegetarian, .vegan] + tweaks
        case .pescatarian, .reducer: return [.pescatarian, .vegetarian, .vegan] + tweaks
        }
    }

    /// Quello che il server prepara da solo all'import. nil per chi
    /// mangia di tutto: la ricetta arriva com'è e si sceglie dopo.
    static func defaultGoal(for diet: DietaryIdentity) -> SwapGoal? {
        switch diet {
        case .omnivore: nil
        case .vegan: .vegan
        case .vegetarian: .vegetarian
        case .pescatarian, .reducer: .pescatarian
        }
    }

    /// Il gesto principale sulle ricette salvate così com'erano.
    static func entryVerb(for diet: DietaryIdentity) -> String {
        defaultGoal(for: diet)?.verb ?? "Make it yours"
    }
}

// La schermata dello Swap engine (§6): estrazione → scelta di cosa farne
// → ledger a due colonne (originale → sostituto, tap per ciclare le
// alternative) → riscrittura → ricetta finale.
struct SwapView: View {
    @ObservedObject var store: SwapStore
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appState: AppState

    /// La scelta riaperta dal ledger, per cambiare obiettivo.
    @State private var pickingGoal = false
    @State private var goalChoice: String?
    /// L'utente ha lasciato la ricetta com'è per vedere le sostituzioni.
    @State private var showsSwaps = false

    private var diet: DietaryIdentity { appState.tasteProfile.dietaryIdentity }

    /// Vista dinamica a richiesta, solo per le ricette lette da un video.
    private var generateDynamic: (() async throws -> Void)? {
        guard DynamicRecipeView.supports(sourceUrl: store.swap?.source?.url) else { return nil }
        let store = store
        return { _ = try await store.jobs.start("/swap/dynamic", body: ["swapId": store.swapId]) }
    }

    private var currentGoal: SwapGoal? {
        store.swap?.goal.flatMap(SwapGoal.init(rawValue:)) ?? SwapGoal.defaultGoal(for: diet)
    }

    private var chosenGoal: SwapGoal? { goalChoice.flatMap(SwapGoal.init(rawValue:)) }

    private var showsGoalChooser: Bool {
        store.pendingGoal == nil && (store.swap?.status == "extracted" || (store.swap?.status == "ledger_ready" && pickingGoal))
    }

    /// La ricetta appena letta, intera e salvabile com'è. Le sostituzioni
    /// si preparano dietro e non la tengono in ostaggio: chi la vuole
    /// solo ritrovare non deve aspettare il ledger.
    private var showsOriginal: Bool {
        guard !showsSwaps, !store.opensOnSwaps, store.pendingGoal == nil, !store.finalizing,
              store.swap?.original != nil else { return false }
        switch store.swap?.status {
        case "extracted", "building_ledger", "ledger_ready": return true
        default: return false
        }
    }

    /// Durante loading ed errori niente header Close: l'errore ha il
    /// suo pulsante grande; il loading non si interrompe.
    private var showsFlowChrome: Bool {
        if showsOriginal { return true }
        if store.errorMessage != nil { return false }
        if store.pendingGoal != nil { return false }
        switch store.swap?.status {
        case nil, "extracting", "building_ledger", "generating_photo": return false
        case "ledger_ready": return !store.finalizing
        case "error": return false
        default: return true
        }
    }

    var body: some View {
        ZStack {
            CherryBackground(mood: .warm)

            VStack(spacing: 0) {
                if showsOriginal {
                    recipeHeader(action: saveAsIs)
                } else if showsFinalRecipe {
                    recipeHeader(action: saveFinal)
                } else if showsFlowChrome {
                    FeatureFlowHeader {
                        EmptyView()
                    } trailing: {
                        FeatureFlowCloseButton { dismiss() }
                    }
                } else {
                    // Solo il marchio durante il loading.
                    CherryWordmark(height: CherryWordmarkSize.header)
                        .padding(.top, 8)
                        .padding(.bottom, 6)
                }

                if showsOriginal {
                    originalRecipe
                } else if let errorMessage = store.errorMessage {
                    errorState(errorMessage)
                } else if let pending = store.pendingGoal {
                    buildingLedger(for: pending)
                } else if showsGoalChooser {
                    goalChooser
                } else {
                    switch store.swap?.status {
                    case nil, "extracting":
                        CherryLoadingScreen(
                            animation: .loading,
                            title: "Reading the recipe…",
                            subtitle: store.swap?.source?.type == "link"
                                ? "Watching the video for you"
                                : "Extracting every ingredient",
                            progressStartedAt: store.loadingStartedAt
                        )
                    case "building_ledger":
                        buildingLedger(for: currentGoal)
                    case "ledger_ready":
                        if store.finalizing {
                            CherryLoadingScreen(
                                animation: .science,
                                title: "Making it yours…",
                                subtitle: "Rewriting every step around your swaps",
                                progressStartedAt: store.loadingStartedAt
                            )
                        } else {
                            ledgerView
                        }
                    case "generating_photo":
                        CherryLoadingScreen(
                            animation: .science,
                            title: "Plating your photo…",
                            subtitle: "Almost ready — crafting the dish image",
                            progressStartedAt: store.loadingStartedAt,
                            progressFloor: 0.6
                        )
                    case "finalized":
                        finalPhase
                    default:
                        errorState(store.swap?.status == "error" ? "Something went wrong." : "Unexpected state.")
                    }
                }
            }
        }
        .onChange(of: store.swap?.status) { old, new in
            // Solo se la riscrittura finisce sotto gli occhi: riaprire
            // uno swap già pronto passa da nil a "finalized" e non conta.
            guard new == "finalized", let old, old != "finalized", store.swap?.finalRecipe != nil else { return }
            ReviewPrompt.request(.swapReady, after: 2.5)
        }
    }

    private func buildingLedger(for goal: SwapGoal?) -> some View {
        CherryLoadingScreen(
            animation: .loading,
            title: "Building your swaps…",
            subtitle: goal.flatMap { $0.isTweak ? "Finding what to change to make it \($0.word)" : nil }
                ?? "Ranked for your taste profile",
            progressStartedAt: store.loadingStartedAt,
            progressFloor: store.swap?.original == nil ? 0.5 : 0.15
        )
    }

    // MARK: - Cosa farne

    /// La ricetta è letta: tenerla così, oppure attaccare una parola
    /// alla frase "Make it …" e vedere cosa cambierebbe.
    private var goalChooser: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 24) {
                    originalHeader

                    Text(pickingGoal
                         ? "Pick another word and we'll rebuild the swaps."
                         : "It's yours as it is. Or pin a word below and see what would change.")
                        .font(Theme.body(14, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                        .fixedSize(horizontal: false, vertical: true)

                    MagnetSentence(
                        lead: "Make it",
                        magnets: SwapGoal.choices(for: diet).map(\.magnet),
                        selection: $goalChoice
                    )

                    if let goal = chosenGoal {
                        Text(goal.promise)
                            .font(Theme.body(15, weight: .semibold))
                            .foregroundStyle(goal.magnet.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .id(goal.id)
                            .transition(.opacity.combined(with: .offset(y: 6)))
                    }

                    Spacer(minLength: 150)
                }
                .padding(.horizontal, 20)
                .animation(Theme.Motion.signature, value: goalChoice)
            }

            VStack(spacing: 10) {
                if let goal = chosenGoal {
                    Button(goal.verb) {
                        Haptics.medium()
                        pickingGoal = false
                        Task { await store.requestLedger(goal) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .transition(.offset(y: 20).combined(with: .opacity))

                    Button("Save as is", action: saveAsIs)
                        .buttonStyle(SecondaryButtonStyle())
                } else {
                    Button("Save as is", action: saveAsIs)
                        .buttonStyle(PrimaryButtonStyle())
                }
            }
            .animation(Theme.Motion.signature, value: goalChoice)
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
    }

    private func saveAsIs() {
        Haptics.light()
        store.saveOriginalRecipe()
        dismiss()
    }

    private func saveFinal() {
        Haptics.success()
        store.saveFinalRecipe()
        dismiss()
    }

    /// Stessa catena di `body`: la ricetta finale è ciò che si vede.
    private var showsFinalRecipe: Bool {
        !showsOriginal && store.errorMessage == nil && store.pendingGoal == nil && !showsGoalChooser
            && store.swap?.status == "finalized" && store.swap?.finalRecipe != nil
    }

    /// Sulla ricetta una riga sola: niente spazio vuoto sopra la foto, e
    /// il salvataggio in alto invece che sopra al contenuto.
    private func recipeHeader(action: @escaping () -> Void) -> some View {
        ZStack {
            CherryWordmark(height: CherryWordmarkSize.compact)
            HStack {
                FeatureFlowCloseButton { dismiss() }
                Spacer()
                Button(action: action) {
                    Text(store.didSave ? "Done" : "Save")
                        .font(Theme.body(15, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18)
                        .frame(height: 36)
                        .background(Theme.brandGradient, in: .capsule)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    // MARK: - La ricetta com'è

    @ViewBuilder
    private var originalRecipe: some View {
        if let original = store.swap?.original {
            RecipeDetailView(
                title: original.title,
                imageUrl: store.swap?.source?.thumbnail,
                costUsd: original.costUsd ?? 0,
                cookMinutes: original.cookMinutes,
                servings: original.servings,
                ingredients: original.ingredients,
                steps: original.steps,
                onSave: { store.saveOriginalRecipe() },
                isSaved: store.didSave,
                sourceUrl: store.swap?.source?.url,
                onVeganize: {
                    // Un ledger fallito ha già riportato la ricetta alla
                    // scelta: l'errore vecchio non deve coprirla.
                    store.errorMessage = nil
                    withAnimation(Theme.Motion.signature) { showsSwaps = true }
                },
                isImported: true,
                hasAIPhoto: false,
                videoUrl: store.swap?.source?.videoUrl,
                segments: original.segments,
                dynamicStatus: store.swap?.dynamicStatus,
                dynamicError: store.swap?.dynamicError,
                onGenerateDynamic: generateDynamic
            )
        }
    }

    @ViewBuilder
    private var originalHeader: some View {
        if let original = store.swap?.original {
            HStack(spacing: 12) {
                if let thumbnail = store.swap?.source?.thumbnail, let url = URL(string: thumbnail) {
                    CachedImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Theme.brand.opacity(0.1)
                    }
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(original.title)
                        .font(Theme.title(20))
                        .foregroundStyle(Theme.ink)
                    Text("\(original.ingredients.count) ingredients · \(original.cookMinutes) min")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.subtle)
                }
            }
            .padding(.top, 8)
        }
    }

    // MARK: - Errori

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 14) {
            Text("🤔").font(.system(size: 52))
            Text("Couldn't get that one")
                .font(Theme.display(24))
                .foregroundStyle(Theme.ink)
            Text(message)
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Button("Close") { dismiss() }
                .buttonStyle(SecondaryButtonStyle())
                .padding(.horizontal, 80)
        }
    }

    // MARK: - Ledger a due colonne

    private var ledgerView: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 14) {
                    originalHeader

                    if let goal = currentGoal {
                        HStack(spacing: 10) {
                            Text("Making it")
                                .font(Theme.body(14, weight: .semibold))
                                .foregroundStyle(Theme.subtle)
                            MagnetTile(magnet: goal.magnet)
                            Spacer(minLength: 8)
                            Button {
                                Haptics.light()
                                goalChoice = goal.rawValue
                                withAnimation(Theme.Motion.signature) { pickingGoal = true }
                            } label: {
                                Text("Change")
                                    .font(Theme.body(13, weight: .bold))
                                    .foregroundStyle(Theme.brand)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .glassEffect(.regular.interactive(), in: .capsule)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.vertical, 2)
                    }

                    HStack {
                        Text("ORIGINAL")
                        Spacer()
                        Text("YOURS")
                    }
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(Theme.subtle)
                    .tracking(1.2)

                    ForEach(store.swap?.ledger ?? []) { line in
                        ledgerRow(line)
                    }

                    Text("Tap any swap to see alternatives")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.subtle)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 4)

                    AIGeneratedNote(text: "Ingredients read from the original and swaps proposed by AI. Check them against the source recipe.")
                        .padding(.top, 6)

                    Spacer(minLength: 120)
                }
                .padding(.horizontal, 20)
            }

            VStack(spacing: 10) {
                Button(store.finalizing ? "Rewriting the recipe…" : (currentGoal?.verb ?? "Make it mine")) {
                    Haptics.medium()
                    Task { await store.finalize() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(store.finalizing)

                Button("Save as is", action: saveAsIs)
                    .buttonStyle(SecondaryButtonStyle())
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
    }

    private func ledgerRow(_ line: LedgerLine) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(line.originalName)
                    .font(Theme.body(14, weight: .semibold))
                    .foregroundStyle(line.isCompatible ? Theme.ink : Theme.soft_red)
                    .strikethrough(!line.isCompatible, color: Theme.soft_red.opacity(0.6))
                if !line.quantity.isEmpty {
                    Text(line.quantity)
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.subtle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Image(systemName: line.isCompatible ? "checkmark" : "arrow.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(line.isCompatible ? Theme.fit : Theme.amber)

            Group {
                if line.isCompatible {
                    Text("keeps as is")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.subtle)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                } else if let substitute = store.chosenSubstitute(for: line) {
                    Button {
                        Haptics.selection()
                        withAnimation(.snappy(duration: 0.2)) { store.cycle(line) }
                    } label: {
                        VStack(alignment: .trailing, spacing: 2) {
                            HStack(spacing: 4) {
                                Text(substitute.name)
                                    .font(Theme.body(14, weight: .bold))
                                    .foregroundStyle(Theme.brand)
                                    .multilineTextAlignment(.trailing)
                                if line.substitutes.count > 1 {
                                    Image(systemName: "arrow.triangle.2.circlepath")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(Theme.brand.opacity(0.6))
                                }
                            }
                            Text(substitute.rationale)
                                .font(Theme.body(11, weight: .semibold))
                                .foregroundStyle(Theme.amber)
                        }
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .id("\(line.originalName)-\(store.chosenIndexes[line.originalName] ?? 0)")
                }
            }
        }
        .padding(13)
        .glassEffect(
            line.isCompatible ? .regular : .regular.tint(Theme.butter.opacity(0.55)),
            in: .rect(cornerRadius: 18)
        )
    }

    // MARK: - Ricetta finale

    @ViewBuilder
    private var finalPhase: some View {
        if let recipe = store.swap?.finalRecipe {
            if let imageUrl = recipe.imageUrl, !imageUrl.isEmpty {
                finalizedRecipe(recipe, imageUrl: imageUrl)
            } else if store.swap?.status == "finalized" {
                // Foto non generata: ricetta sì, senza ripiegare sul
                // frame del video originale.
                finalizedRecipe(recipe, imageUrl: nil)
            } else {
                CherryLoadingScreen(
                    animation: .science,
                    title: "Plating your photo…",
                    subtitle: "Almost ready — crafting the dish image",
                    progressStartedAt: store.loadingStartedAt,
                    progressFloor: 0.6
                )
            }
        }
    }

    private func finalizedRecipe(_ recipe: SwapRecipe, imageUrl: String?) -> some View {
        RecipeDetailView(
            title: recipe.title,
            imageUrl: imageUrl,
            costUsd: recipe.costUsd ?? 0,
            cookMinutes: recipe.cookMinutes,
            servings: recipe.servings,
            ingredients: recipe.ingredients,
            steps: recipe.steps,
            onSave: { store.saveFinalRecipe() },
            isSaved: store.didSave,
            videoUrl: store.swap?.source?.videoUrl,
            segments: recipe.segments,
            dynamicStatus: store.swap?.dynamicStatus,
            dynamicError: store.swap?.dynamicError,
            onGenerateDynamic: generateDynamic
        )
    }
}

struct GentlePulse: ViewModifier {
    @State private var pulsing = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(pulsing ? 1.08 : 0.95)
            .animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: pulsing)
            .onAppear { pulsing = true }
    }
}
