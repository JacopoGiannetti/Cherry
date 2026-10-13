import SwiftUI

// Beat 3+4 del wizard (§4.1): generation theater e deck swipabile.
// Lo swipe parte appena 2 card sono pronte; il Budget Meter è il cuore
// dello schermo e trasforma lo swipe in un mini-gioco con condizione
// di vittoria.
struct DeckView: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject var store: RunStore
    let onFinished: () -> Void

    @State private var dragOffset: CGSize = .zero
    @State private var overshootCandidate: Recipe?
    @State private var flippedRecipeId: String?
    @State private var celebrating = false
    @State private var meterBounce = false
    @State private var nudging = false
    @State private var savedFlash = false

    /// Il coach dello swipe si vede finché l'utente non ha capito il
    /// gesto: dopo il primo swipe non torna più.
    @AppStorage("deckSwipeCoachDone") private var swipeCoachDone = false
    /// Stesso schema per il tap: una volta girata una carta, il hint
    /// sugli ingredienti non serve più.
    @AppStorage("deckTapCoachDone") private var tapCoachDone = false

    private var theaterLines: [String] {
        let craving = store.run?.craving ?? "your taste"
        return [
            "Building your menu around \(craving == "surprise" ? "your profile" : craving.lowercased())…",
            "Designing recipes that share ingredients…",
            "Pricing everything for your budget…",
            "Plating the first courses…",
        ]
    }

    private var preloadLines: [String] {
        [
            "Downloading your photos…",
            "Getting your first card ready…",
            "Almost time to swipe…",
        ]
    }

    /// Il meter compare solo quando il deck è davvero pronto da giocare.
    private var showsMeter: Bool { store.deckImagesReady && !store.recipes.isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            if showsMeter {
                BudgetMeterBar(
                    spent: store.spentUsd,
                    budget: store.budgetUsd,
                    keptCount: store.keptRecipes.count,
                    bounce: meterBounce
                )
                .padding(.horizontal, 20)
                .padding(.top, 6)
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            if celebrating || (store.budgetFull && !store.deck.isEmpty) || (store.budgetFull && store.deck.isEmpty) {
                celebration
            } else if store.deck.isEmpty {
                if store.recipes.isEmpty {
                    GenerationTheaterView(
                        lines: theaterLines,
                        phase: store.generationPhase,
                        error: store.startError,
                        startedAt: store.loadingStartedAt
                    )
                } else if store.isDemo {
                    demoExhaustedView
                } else {
                    exhaustedView
                }
            } else if !store.deckImagesReady {
                GenerationTheaterView(
                    lines: preloadLines,
                    phase: .idle,
                    error: store.startError,
                    showsProgressCard: false,
                    startedAt: store.loadingStartedAt
                )
            } else {
                deckArea
                actionBar
            }
        }
        .animation(Theme.Motion.slow, value: showsMeter)
        .onChange(of: store.budgetFull) { _, full in
            if full {
                Haptics.success()
                withAnimation(Theme.Motion.slow) { celebrating = true }
            }
        }
        .confirmationDialog(
            "This would push you past your budget",
            isPresented: Binding(
                get: { overshootCandidate != nil },
                set: { if !$0 { overshootCandidate = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Keep anyway") {
                if let recipe = overshootCandidate { commit(recipe, kept: true) }
                overshootCandidate = nil
            }
            Button("Pass", role: .cancel) {
                if let recipe = overshootCandidate { commit(recipe, kept: false) }
                overshootCandidate = nil
            }
        }
    }

    // MARK: - Deck

    private var deckArea: some View {
        GeometryReader { geo in
            ZStack {
                // Le prossime 2 carte, dietro
                ForEach(Array(store.deck.prefix(3).enumerated().reversed()), id: \.element.id) { index, recipe in
                    if index == 0 {
                        card(recipe, size: geo.size)
                            .overlay(alignment: .top) {
                                if !swipeCoachDone && flippedRecipeId != recipe.id {
                                    SwipeCoachBanner()
                                        .padding(.top, 74)
                                        .opacity(dragOffset == .zero ? 1 : 0)
                                        .allowsHitTesting(false)
                                        .transition(.opacity)
                                }
                            }
                            .offset(dragOffset)
                            .rotationEffect(.degrees(Double(dragOffset.width) / 18))
                            .offset(x: nudging ? 26 : 0)
                            .rotationEffect(.degrees(nudging ? 1.6 : 0))
                            .zIndex(3)
                            .gesture(dragGesture(for: recipe))
                            .onTapGesture {
                                Haptics.light()
                                tapCoachDone = true
                                withAnimation(.spring(duration: 0.45, bounce: 0.2)) {
                                    flippedRecipeId = flippedRecipeId == recipe.id ? nil : recipe.id
                                }
                            }
                    } else {
                        // Le carte dietro sono un'anteprima, non un
                        // contenuto: sfocate, non rubano la scena e non
                        // fanno credere di poterle già leggere.
                        card(recipe, size: geo.size)
                            .scaleEffect(1 - CGFloat(index) * 0.045)
                            .offset(y: CGFloat(index) * 12)
                            .blur(radius: CGFloat(index) * 6)
                            .opacity(index == 1 ? 0.9 : 0.7)
                            .zIndex(Double(3 - index))
                            .allowsHitTesting(false)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .onAppear(perform: nudgeFirstCard)
    }

    /// Una spinta sola, appena il deck compare: la carta si muove da
    /// sé e comunica che è afferrabile senza spiegare niente.
    private func nudgeFirstCard() {
        guard !swipeCoachDone else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            withAnimation(.spring(duration: 0.45, bounce: 0.5)) { nudging = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                withAnimation(.spring(duration: 0.55, bounce: 0.45)) { nudging = false }
            }
        }
    }

    // MARK: - Barra delle azioni (anche per chi non vuole swipare)

    private var actionBar: some View {
        HStack(spacing: 22) {
            actionButton(
                systemName: "xmark",
                tint: Theme.soft_red,
                label: "Pass",
                size: 58
            ) {
                if let recipe = store.deck.first { swipeAway(recipe, kept: false) }
            }

            actionButton(
                systemName: saveIcon,
                tint: Theme.amber,
                label: "Save",
                size: 50
            ) {
                guard let recipe = store.deck.first, !store.isSaved(recipe) else { return }
                Haptics.success()
                // Nella prova la collezione non esiste ancora: la stella
                // resta viva, ma dice la verità su cosa la sblocca.
                store.saveToCollection(recipe)
                withAnimation(.spring(duration: 0.4, bounce: 0.5)) { savedFlash = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
                    withAnimation(.easeOut(duration: 0.3)) { savedFlash = false }
                }
            }

            actionButton(
                systemName: "cart.fill.badge.plus",
                tint: Theme.fit,
                label: "Keep",
                size: 58
            ) {
                if let recipe = store.deck.first { swipeAway(recipe, kept: true) }
            }
        }
        .padding(.top, 14)
        .padding(.bottom, 10)
        .overlay(alignment: .top) {
            if savedFlash {
                Text(store.isDemo ? "Keeping recipes comes with the full app" : "Saved to your recipes")
                    .font(Theme.body(12, weight: .bold))
                    .foregroundStyle(Theme.amber)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .glassEffect(.regular, in: .capsule)
                    .offset(y: -14)
                    .transition(.scale.combined(with: .opacity))
            }
        }
    }

    private var saveIcon: String {
        guard let recipe = store.deck.first else { return "star" }
        return store.isSaved(recipe) ? "star.fill" : "star"
    }

    private func actionButton(
        systemName: String,
        tint: Color,
        label: String,
        size: CGFloat,
        action: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 5) {
            Button(action: action) {
                Image(systemName: systemName)
                    .font(.system(size: size * 0.36, weight: .bold))
                    .foregroundStyle(tint)
                    .frame(width: size, height: size)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)

            Text(label)
                .font(Theme.body(11, weight: .semibold))
                .foregroundStyle(Theme.subtle)
        }
    }

    /// Carta a due facce con flip 3D vero: le due facce sono opache e
    /// si scambiano di spigolo (a 90° la carta è di taglio), così la
    /// foto non traspare mai sotto il retro.
    private func card(_ recipe: Recipe, size: CGSize) -> some View {
        let isFlipped = flippedRecipeId == recipe.id
        return ZStack {
            RecipeCardFace(
                recipe: recipe,
                sharedBadge: badgeText(for: recipe),
                dragOffset: isFlipped ? .zero : dragOffset,
                showsTapHint: !tapCoachDone && !isFlipped
            )
            .opacity(isFlipped ? 0 : 1)
            .rotation3DEffect(.degrees(isFlipped ? 180 : 0), axis: (x: 0, y: 1, z: 0), perspective: 0.35)

            RecipeCardBack(recipe: recipe)
                .opacity(isFlipped ? 1 : 0)
                .rotation3DEffect(.degrees(isFlipped ? 0 : -180), axis: (x: 0, y: 1, z: 0), perspective: 0.35)
        }
        .frame(width: size.width - 32, height: size.height - 32)
    }

    private func badgeText(for recipe: Recipe) -> String? {
        let shared = store.sharedIngredients(of: recipe)
        guard let first = shared.first else { return nil }
        return "uses the \(first.lowercased()) you already picked"
    }

    private func dragGesture(for recipe: Recipe) -> some Gesture {
        DragGesture()
            .onChanged { value in
                dragOffset = value.translation
            }
            .onEnded { value in
                let threshold: CGFloat = 110
                if value.translation.width > threshold {
                    swipeAway(recipe, kept: true)
                } else if value.translation.width < -threshold {
                    swipeAway(recipe, kept: false)
                } else {
                    withAnimation(Theme.Motion.signature) { dragOffset = .zero }
                }
            }
    }

    private func swipeAway(_ recipe: Recipe, kept: Bool) {
        if kept && store.wouldOvershoot(recipe) {
            // Il meter è un coach, non un buttafuori (§4.1).
            Haptics.warning()
            withAnimation(.spring(duration: 0.35, bounce: 0.6)) {
                dragOffset = .zero
                meterBounce.toggle()
            }
            overshootCandidate = recipe
            return
        }
        withAnimation(.easeOut(duration: 0.3)) {
            dragOffset = CGSize(width: kept ? 600 : -600, height: -40)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            commit(recipe, kept: kept)
            dragOffset = .zero
        }
    }

    private func commit(_ recipe: Recipe, kept: Bool) {
        flippedRecipeId = nil
        swipeCoachDone = true
        if kept {
            Haptics.medium()
            store.keep(recipe)
        } else {
            Haptics.light()
            store.pass(recipe)
        }
    }

    // MARK: - Deck esaurito con budget residuo = stato di vittoria (§4.1)

    /// Nella prova guidata il deck è finito: non c'è un backend che
    /// possa generarne altro, e fingere il contrario sarebbe la prima
    /// bugia dell'app. Si dice com'è e si va avanti.
    private var demoExhaustedView: some View {
        VStack(spacing: 18) {
            Spacer()
            Text("🃏").font(.system(size: 48))
            Text("That's the\ntaster deck")
                .font(Theme.display(26))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
            Text("The real app keeps cooking new recipes until your budget is full.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 44)

            if store.keptRecipes.isEmpty {
                Button("Swipe them again") {
                    Haptics.medium()
                    withAnimation { store.resetDemoDeck() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 40)
            } else {
                Button("Build my grocery list") { finish() }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.horizontal, 40)
            }
            Spacer()
        }
    }

    private var exhaustedView: some View {
        VStack(spacing: 18) {
            Spacer()
            Text("🃏").font(.system(size: 48))
            Text("Deck's done —\nbudget's not!")
                .font(Theme.display(26))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
            Text("\(appState.money(store.remainingUsd)) left to play with")
                .font(Theme.body(15, weight: .semibold))
                .foregroundStyle(Theme.amber)

            if let error = store.startError {
                Text(error)
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.soft_red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }

            if store.isGeneratingMore || store.generationPhase != .idle {
                generatingMoreStatus
            } else {
                Button("Generate more") {
                    Haptics.medium()
                    Task { await store.generateMore() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 40)

                // Le chip di correzione: un tap orienta il prossimo batch
                // più di quindici swipe.
                HStack(spacing: 8) {
                    correctionChip("Too fancy", id: "too_fancy")
                    correctionChip("Weird ingredients", id: "weird_ingredients")
                    correctionChip("Not my taste", id: "not_my_taste")
                }
            }

            if !store.keptRecipes.isEmpty {
                Button("Finish with \(store.keptRecipes.count) recipes") {
                    finish()
                }
                .buttonStyle(SecondaryButtonStyle())
                .padding(.horizontal, 40)
                .padding(.top, 4)
            }
            Spacer()
        }
    }

    /// Stato del "Generate more": stesse fasi della prima generazione,
    /// lette dalla run su Firestore.
    private var generatingMoreStatus: some View {
        VStack(spacing: 12) {
            CherryLottieView(animation: .cooking, size: 120, softEdges: true)
            if case .images(let done, let total) = store.generationPhase {
                Text("Plating photos \(done) of \(total)…")
                    .font(Theme.body(14, weight: .semibold))
                    .foregroundStyle(Theme.brand)
                    .contentTransition(.numericText())
                    .animation(.snappy, value: done)
            } else {
                Text("Cooking new ideas…")
                    .font(Theme.body(14, weight: .semibold))
                    .foregroundStyle(Theme.brand)
            }
            LoadingPercent(
                startedAt: store.loadingStartedAt,
                floor: GenerationTheaterView.realProgress(store.generationPhase),
                width: 180
            )
        }
        .padding(.top, 6)
    }

    private func correctionChip(_ label: String, id: String) -> some View {
        Button {
            Haptics.medium()
            Task { await store.generateMore(correctionChips: [id]) }
        } label: {
            Text(label)
                .font(Theme.body(13, weight: .semibold))
                .foregroundStyle(Theme.brand)
                .padding(.horizontal, 13)
                .padding(.vertical, 9)
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    // MARK: - Celebrazione (auto-completamento §11)

    private var celebration: some View {
        VStack(spacing: 18) {
            Spacer()
            Text("🏆")
                .font(.system(size: 56))
                .frame(width: 130, height: 130)
                .glassEffect(.regular.tint(Theme.butter.opacity(0.6)), in: .circle)
            Text("Budget beaten!")
                .font(Theme.display(32))
                .foregroundStyle(Theme.brandGradient)
            Text("\(store.keptRecipes.count) recipes · \(appState.money(store.spentUsd)) of \(appState.money(store.budgetUsd))")
                .font(Theme.body(17, weight: .semibold))
                .foregroundStyle(Theme.brand)

            Button("Build my grocery list") { finish() }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 40)
                .padding(.top, 8)

            if !store.isDemo, !store.deck.isEmpty {
                Button("Add one more recipe") {
                    Haptics.light()
                    withAnimation { celebrating = false }
                }
                .font(Theme.body(15, weight: .medium))
                .foregroundStyle(Theme.subtle)
            }
            Spacer()
        }
    }

    private func finish() {
        Haptics.success()
        store.finishRun()
        onFinished()
    }
}

// MARK: - Budget Meter (il cuore dello schermo, §4.1)

// Una riga sola, leggera: quanto hai messo nel carrello, quanto ti
// resta, e un filo di colore che avanza. Niente scatolone.
struct BudgetMeterBar: View {
    @EnvironmentObject private var appState: AppState
    let spent: Double
    let budget: Double
    let keptCount: Int
    var bounce = false

    private var fraction: Double { budget > 0 ? min(1, spent / budget) : 0 }
    private var nearlyFull: Bool { fraction > 0.8 }
    private var remaining: Int { max(0, Int((budget - spent).rounded())) }

    private var trackColors: [Color] {
        nearlyFull
            ? [Theme.amber, Color(hex: 0xF2C078)]
            : [Theme.brand, Theme.orange]
    }

    var body: some View {
        HStack(spacing: 12) {
            cartBadge

            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(appState.money(spent))
                        .font(Theme.body(18, weight: .heavy))
                        .foregroundStyle(nearlyFull ? Theme.amber : Theme.brand)
                        .contentTransition(.numericText())
                        .animation(Theme.Motion.slow, value: Int(spent))
                    Text("of \(appState.money(budget))")
                        .font(Theme.body(13, weight: .medium))
                        .foregroundStyle(Theme.subtle)

                    Spacer(minLength: 6)

                    Text("\(appState.tasteProfile.moneySymbol)\(remaining) left")
                        .font(Theme.body(12, weight: .bold))
                        .foregroundStyle(Theme.subtle)
                        .contentTransition(.numericText())
                }

                track
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .scaleEffect(bounce ? 1.03 : 1)
        .animation(.spring(duration: 0.3, bounce: 0.6), value: bounce)
    }

    private var cartBadge: some View {
        ZStack {
            Circle()
                .fill(Theme.brand.opacity(keptCount > 0 ? 0.16 : 0.08))
                .frame(width: 38, height: 38)
            if keptCount > 0 {
                Text("\(keptCount)")
                    .font(Theme.body(16, weight: .heavy))
                    .foregroundStyle(Theme.brand)
                    .contentTransition(.numericText())
            } else {
                Image(systemName: "cart")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.brand.opacity(0.55))
            }
        }
        .animation(.spring(duration: 0.4, bounce: 0.4), value: keptCount)
    }

    private var track: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.ink.opacity(0.06))
                Capsule()
                    .fill(
                        LinearGradient(colors: trackColors, startPoint: .leading, endPoint: .trailing)
                    )
                    .frame(width: max(6, geo.size.width * fraction))
                    .animation(.spring(duration: 0.6, bounce: 0.3), value: fraction)
            }
        }
        .frame(height: 6)
    }
}

// MARK: - Coach dello swipe (§4.1: il gesto si insegna una volta sola)

/// Due frecce che pulsano ai lati di una didascalia: si vede prima
/// ancora di toccare la carta, che è esattamente il punto.
private struct SwipeCoachBanner: View {
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 10) {
            arrow("chevron.left", tint: Theme.soft_red, shift: -1)
            Text("swipe to choose")
                .font(Theme.body(12, weight: .bold))
                .foregroundStyle(.white)
                .tracking(0.4)
            arrow("chevron.right", tint: Theme.fit, shift: 1)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(.ultraThinMaterial, in: Capsule())
        .background(Theme.ink.opacity(0.35), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(0.25), lineWidth: 1))
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }

    private func arrow(_ systemName: String, tint: Color, shift: CGFloat) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 13, weight: .heavy))
            .foregroundStyle(tint)
            .offset(x: pulse ? shift * 3 : 0)
    }
}

// MARK: - Generation theater (§10.2: la latenza è teatro, non attesa)

// Il progresso è REALE, letto dalla run su Firestore: prima la fase
// "menu" (Gemini), poi la fase "foto" con il contatore x/y che avanza
// mentre fal.ai scatta in parallelo.
struct GenerationTheaterView: View {
    let lines: [String]
    var phase: RunStore.GenerationPhase = .recipes
    var error: String?
    var showsProgressCard = true
    let startedAt: Date

    @State private var lineIndex = 0

    /// Quanto è avanti davvero il lavoro: la percentuale a tempo non
    /// scende mai sotto. Foto pronte = oltre metà; deck pubblicato e foto
    /// in download = quasi finito.
    static func realProgress(_ phase: RunStore.GenerationPhase) -> Double {
        switch phase {
        case .recipes: 0
        case .images(let done, let total): 0.55 + 0.35 * Double(done) / Double(max(1, total))
        case .idle: 0.9
        }
    }

    var body: some View {
        VStack(spacing: 26) {
            Spacer()

            CherryLottieView(animation: .cooking, size: 230, softEdges: true)

            if let error {
                Text(error)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.soft_red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            } else {
                LoadingPercent(startedAt: startedAt, floor: Self.realProgress(phase))

                if showsProgressCard {
                    progressCard
                }

                Text(lines[lineIndex % lines.count])
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.subtle)
                    .multilineTextAlignment(.center)
                    .id(lineIndex)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                    .padding(.horizontal, 40)
            }

            Spacer()
        }
        .onAppear {
            Timer.scheduledTimer(withTimeInterval: 2.2, repeats: true) { timer in
                if lineIndex >= 40 { timer.invalidate() }
                withAnimation(Theme.Motion.slow) { lineIndex += 1 }
            }
        }
    }

    // Le due fasi vere della cucina: menu, poi servizio fotografico.
    private var progressCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            stageRow(
                title: "Crafting your menu",
                state: phase == .recipes ? .running : .done
            )

            switch phase {
            case .images(let done, let total):
                stageRow(title: "Shooting the photos", state: .running, detail: "\(done)/\(total)")
            default:
                stageRow(title: "Shooting the photos", state: .waiting)
            }
        }
        .padding(18)
        .frame(width: 250)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .animation(Theme.Motion.signature, value: phase)
    }

    private enum StageState { case waiting, running, done }

    private func stageRow(title: String, state: StageState, detail: String? = nil) -> some View {
        HStack(spacing: 10) {
            switch state {
            case .waiting:
                Image(systemName: "circle.dotted")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.subtle.opacity(0.6))
            case .running:
                ProgressView().tint(Theme.brand).controlSize(.small)
            case .done:
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.brand)
                    .transition(.scale.combined(with: .opacity))
            }

            Text(title)
                .font(Theme.body(14, weight: .semibold))
                .foregroundStyle(state == .waiting ? Theme.subtle : Theme.ink)

            Spacer(minLength: 0)

            if let detail {
                Text(detail)
                    .font(Theme.body(13, weight: .bold))
                    .foregroundStyle(Theme.brand)
                    .monospacedDigit()
                    .contentTransition(.numericText())
            }
        }
    }
}

/// Barra di avanzamento delle foto, col gradiente del brand.
struct PhotoProgressBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.ink.opacity(0.07))
                Capsule()
                    .fill(Theme.brandGradient)
                    .frame(width: max(8, geo.size.width * min(1, fraction)))
                    .animation(.spring(duration: 0.5, bounce: 0.2), value: fraction)
            }
        }
        .frame(height: 8)
    }
}
