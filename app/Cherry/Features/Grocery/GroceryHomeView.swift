import SwiftUI
import FirebaseFirestore

// La tab Grocery è STATEFUL (§4): senza run attiva domina il CTA
// "New Smart List" (firmato Cherry AI); con una run attiva, la card di
// progresso si aggancia in cima. Sotto: le due strade manuali (lista
// vuota, dalle ricette salvate) e lo storico.
// Settings dietro un piccolo avatar in alto (§2, de-enfatizzato).
struct GroceryHomeView: View {
    @EnvironmentObject private var appState: AppState

    /// Come parte il wizard: run nuova o run da fondere in una attiva.
    enum WizardMode: Identifiable {
        case fresh
        case merge(into: String)
        var id: String {
            switch self {
            case .fresh: "fresh"
            case .merge(let target): "merge-\(target)"
            }
        }
    }

    @State private var runs: [Run] = []
    @State private var runsListener: ListenerRegistration?
    @State private var wizardMode: WizardMode?
    @State private var reopeningRun: Run?
    @State private var detailRun: Run?
    @State private var stoppingRun: Run?
    @State private var planToDelete: Run?
    @State private var showNewRunOptions = false
    @State private var showFromRecipes = false
    @State private var showBlankComposer = false
    @State private var pendingNewList: NewListKind?
    @State private var fromRecipesMerge: Run?

    /// Cosa si voleva aprire quando è comparso il dialogo "già in corso".
    private enum NewListKind {
        case smart, blank, fromRecipes
    }
    @State private var showAllPlans = false
    @State private var showSpaces = false

    /// Le run attive possono essere PIÙ di una (§4 run multiple).
    private var activeRuns: [Run] {
        runs.filter { $0.status == .generating || $0.status == .swiping || $0.status == .shopping }
    }

    private var pastRuns: [Run] {
        runs.filter { $0.status == .archived }
    }

    /// Con una run attiva in home (swipe, generazione, shopping) o un
    /// rimando a una lista in un altro spazio, la striscia di stagione
    /// sparisce: altrimenti finisce sotto la tab bar.
    private var showSeasonalStrip: Bool {
        activeRuns.isEmpty && appState.spaces.awayRuns.isEmpty
    }

    var body: some View {
        NavigationStack {
            ZStack {
                CherryBackground(mood: .fresh)

                ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 16) {
                        // Spazio per l'header fisso montato in MainTabView.
                        // Un po' meno del riservato: la pill sale e resta
                        // aria tra My Lists e la striscia di stagione.
                        Color.clear.frame(height: TabScreenHeader.reservedHeight - 14)
                            .id("tour.top")

                        SpaceSwitcherPill { showSpaces = true }
                            .homeTourAnchor(.space)

                        ForEach(appState.spaces.awayRuns) { away in
                            AwayRunBanner(run: away.run, space: away.space) {
                                Haptics.medium()
                                if let spaceId = away.space.id {
                                    appState.spaces.select(spaceId: spaceId)
                                }
                            }
                        }

                        newRunCTA
                            .homeTourAnchor(.smartList)

                        ForEach(activeRuns) { run in
                            ActiveRunCard(
                                run: run,
                                onTap: { reopeningRun = run },
                                onStop: { stoppingRun = run },
                                onDelete: { planToDelete = run }
                            )
                        }

                        makeYourOwnRow
                            .homeTourAnchor(.manualRow)

                        myPlansCard
                            .homeTourAnchor(.myLists)
                            .id("tour.myLists")
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                }
                .onChange(of: appState.homeTourStep) { _, step in
                    // Il pezzo illuminato deve essere a schermo: My Lists
                    // sta in fondo, gli altri in cima.
                    guard let step, step.tab == .grocery else { return }
                    withAnimation(Theme.Motion.signature) {
                        if step == .groceryLists {
                            proxy.scrollTo("tour.myLists", anchor: .bottom)
                        } else {
                            proxy.scrollTo("tour.top", anchor: .top)
                        }
                    }
                }
                // Non più overlay in un ZStack bottom: quello si alzava con
                // tastiera, safe area e l'overshoot della snappy, e andava
                // sopra My Lists. L'inset resta inchiodato in basso, e lo
                // scroll finisce prima — niente compenetrazione.
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if showSeasonalStrip {
                        seasonalStrip
                            .padding(.horizontal, 20)
                            .padding(.top, 18)
                            .padding(.bottom, 96)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background {
                                // Il vetro campiona ciò che sta sotto.
                                // Sul crema diventa una lastra bianca:
                                // qui sotto i tag deve esserci colore.
                                LinearGradient(
                                    colors: [
                                        Theme.mint.opacity(0.55),
                                        Theme.butter.opacity(0.5),
                                        Theme.peach.opacity(0.45),
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                                .blur(radius: 18)
                                .padding(.top, 8)
                                .allowsHitTesting(false)
                            }
                    } else {
                        Color.clear.frame(height: 96)
                    }
                }
                .ignoresSafeArea(.keyboard)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .onAppear(perform: listen)
        .onChange(of: appState.spaces.activeSpaceId) { _, _ in relisten() }
        .onChange(of: appState.pendingRunOpen) { _, _ in openPendingRunIfNeeded() }
        .onChange(of: runs.count) { _, _ in openPendingRunIfNeeded() }
        .sheet(isPresented: $showSpaces) {
            SpacesSheet()
        }
        .fullScreenCover(item: $wizardMode) { mode in
            Group {
                switch mode {
                case .fresh:
                    RunWizardView(appState: appState)
                case .merge(let target):
                    RunWizardView(appState: appState, mergeInto: target)
                }
            }
            // Il wizard copre tutto: la home non deve trasparire.
            .presentationBackground(Theme.cream)
        }
        .fullScreenCover(item: $reopeningRun) { run in
            RunWizardView(
                appState: appState,
                existingRunId: run.id ?? "",
                startAt: run.status == .shopping ? .list : .deck
            )
        }
        .sheet(item: $detailRun) { run in
            RunDetailView(run: run) { reopened in
                detailRun = nil
                reopeningRun = reopened
            } onDelete: {
                detailRun = nil
                deletePlan(run)
            }
        }
        .sheet(isPresented: $showFromRecipes, onDismiss: { fromRecipesMerge = nil }) {
            FromRecipesSheet(mergeInto: fromRecipesMerge)
        }
        .sheet(isPresented: $showBlankComposer) {
            AddItemSheet(scope: appState.scope, jobs: appState.jobs) { names, recipes in
                commitBlankList(names: names, recipes: recipes)
            }
        }
        .sheet(isPresented: $showAllPlans) {
            MealPlansSheet(
                runs: pastRuns,
                onOpen: { run in
                    // Un solo sheet alla volta: si chiude la lista e poi
                    // si apre il dettaglio.
                    showAllPlans = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                        detailRun = run
                    }
                },
                onDelete: deletePlan,
                onRename: renamePlan
            )
        }
        .onChange(of: showAllPlans) { _, open in
            if open { stoppingRun = nil; planToDelete = nil }
        }
        .onChange(of: detailRun?.id) { _, _ in
            stoppingRun = nil
        }
        // Una sola lista attiva: o si sostituisce, o si aggiunge a quella.
        .confirmationDialog(
            "You already have a grocery list going",
            isPresented: $showNewRunOptions,
            titleVisibility: .visible
        ) {
            Button("Replace it (archive current)", role: .destructive) {
                for run in activeRuns { archive(run) }
                if let kind = pendingNewList { beginNewList(kind, merge: false) }
                pendingNewList = nil
            }
            if pendingNewList == .smart, let targetId = activeRuns.first?.id {
                Button("Merge into current list") {
                    wizardMode = .merge(into: targetId)
                    pendingNewList = nil
                }
            } else if pendingNewList != nil {
                Button("Add to current list") {
                    if let kind = pendingNewList { beginNewList(kind, merge: true) }
                    pendingNewList = nil
                }
            }
            Button("Cancel", role: .cancel) { pendingNewList = nil }
        } message: {
            Text(pendingNewList == .smart
                 ? "Only one list at a time. Replace this one, or merge the new recipes into it."
                 : "Only one list at a time. Replace this one, or add to it.")
        }
        .alert(
            "End this list?",
            isPresented: Binding(
                get: { stoppingRun != nil },
                set: { if !$0 { stoppingRun = nil } }
            )
        ) {
            Button("End list", role: .destructive) {
                if let run = stoppingRun { archive(run) }
                stoppingRun = nil
            }
            Button("Cancel", role: .cancel) { stoppingRun = nil }
        } message: {
            Text("It moves to your past lists — you can still review it or restart it later.")
        }
        .alert(
            "Delete this list?",
            isPresented: Binding(
                get: { planToDelete != nil },
                set: { if !$0 { planToDelete = nil } }
            )
        ) {
            Button("Delete", role: .destructive) {
                if let run = planToDelete { deletePlan(run) }
                planToDelete = nil
            }
            Button("Cancel", role: .cancel) { planToDelete = nil }
        } message: {
            Text("The list and its recipes will be removed permanently.")
        }
    }

    private func deletePlan(_ run: Run) {
        guard let id = run.id else { return }
        Haptics.medium()
        Task {
            try? await FirestoreService.deleteRun(scope: appState.scope, runId: id)
        }
    }

    private func renamePlan(_ run: Run, _ name: String) {
        guard let id = run.id else { return }
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        Haptics.light()
        FirestoreService.setRunFields(scope: appState.scope, runId: id, ["title": clean])
    }

    private func archive(_ run: Run) {
        guard let id = run.id else { return }
        Haptics.medium()
        FirestoreService.setRunFields(scope: appState.scope, runId: id, ["status": RunStatus.archived.rawValue])
    }

    /// Cambiando spazio cambia l'intero elenco: il listener va rifatto.
    private func relisten() {
        runsListener?.remove()
        runsListener = nil
        runs = []
        listen()
    }

    private func listen() {
        guard runsListener == nil else { return }
        runsListener = FirestoreService.listenCollection(
            FirestoreService.runsQuery(scope: appState.scope),
            as: Run.self
        ) { newRuns in
            runs = newRuns
            let active = newRuns.filter {
                $0.status == .generating || $0.status == .swiping || $0.status == .shopping
            }
            appState.groceryHasActiveList = !active.isEmpty
            appState.activeShoppingRunId = active.first?.id
            openPendingRunIfNeeded()
        }
    }

    /// Live Activity → apri la lista, non solo la home Grocery.
    private func openPendingRunIfNeeded() {
        guard let pending = appState.pendingRunOpen else { return }
        if let spaceId = pending.spaceId, appState.spaces.activeSpaceId != spaceId { return }

        if let run = runs.first(where: { $0.id == pending.runId }) {
            appState.pendingRunOpen = nil
            reopeningRun = run
            return
        }

        // Il listener può arrivare un attimo dopo il deep link: apriamo
        // comunque, RunStore legge lo stato da Firestore.
        appState.pendingRunOpen = nil
        var stub = Run()
        stub.id = pending.runId
        stub.status = .shopping
        reopeningRun = stub
    }

    private func requestNewList(_ kind: NewListKind) {
        if activeRuns.isEmpty {
            beginNewList(kind, merge: false)
        } else {
            pendingNewList = kind
            showNewRunOptions = true
        }
    }

    private func beginNewList(_ kind: NewListKind, merge: Bool) {
        switch kind {
        case .smart:
            if merge, let targetId = activeRuns.first?.id {
                wizardMode = .merge(into: targetId)
            } else {
                wizardMode = .fresh
            }
        case .blank:
            if merge, let current = activeRuns.first {
                reopeningRun = current
            } else {
                showBlankComposer = true
            }
        case .fromRecipes:
            fromRecipesMerge = merge ? activeRuns.first : nil
            showFromRecipes = true
        }
    }

    private var newRunCTA: some View {
        Button {
            Haptics.medium()
            requestNewList(.smart)
        } label: {
            // La foresta è Cherry: piante, verde, aria. Entra da destra,
            // il testo resta sul pastello a sinistra.
            CherryIllustratedCard(
                wash: Theme.mint,
                image: "IllustrationForest",
                height: 158,
                imageAlignment: .bottom,
                fadeEnd: 0.72
            ) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        CherryAIBadge()
                        Spacer(minLength: 0)
                    }

                    Spacer(minLength: 10)

                    Text("New Smart List")
                        .font(Theme.display(26))
                        .foregroundStyle(Theme.ink)
                    Text("Swipe recipes for your budget.\nThe list writes itself.")
                        .font(Theme.body(13, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                        .padding(.top, 5)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 22)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .overlay(alignment: .bottomTrailing) {
                    CherryGlassOrb(symbol: "arrow.right", size: 46)
                        .padding(.trailing, 20)
                        .padding(.bottom, 20)
                }
            }
            .contentShape(CherryPebbleShape())
        }
        .buttonStyle(CherryCardButtonStyle())
    }

    // MARK: - Le due strade manuali

    /// Sotto la Smart List, le liste che si fanno da sé: vuota da
    /// riempire a mano, o dalle ricette salvate. Un'etichetta sola
    /// sopra i due riquadri, così il "perché" della card verde è
    /// chiaro: quella la scrive l'AI, queste le scrivi tu.
    private var makeYourOwnRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("OR MAKE YOUR OWN")
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(Theme.subtle)
                    .tracking(1.2)
                Rectangle()
                    .fill(Theme.ink.opacity(0.08))
                    .frame(height: 1)
            }
            .padding(.leading, 4)

            HStack(spacing: 10) {
                manualTile(
                    symbol: "list.bullet.rectangle.portrait.fill",
                    tint: Theme.butter,
                    ink: Theme.amber,
                    title: "Blank list",
                    subtitle: "Type items as you go"
                ) {
                    Haptics.medium()
                    requestNewList(.blank)
                }

                manualTile(
                    symbol: "book.closed.fill",
                    tint: Theme.lavender,
                    ink: Color(hex: 0x6C5FA8),
                    title: "From my recipes",
                    subtitle: "Pick saved dishes"
                ) {
                    Haptics.light()
                    requestNewList(.fromRecipes)
                }
            }
        }
        .padding(.top, 2)
    }

    private func manualTile(
        symbol: String,
        tint: Color,
        ink: Color,
        title: String,
        subtitle: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(ink)
                    .frame(width: 34, height: 34)
                    .background(tint.opacity(0.8), in: .circle)

                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(Theme.body(14, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Text(subtitle)
                        .font(Theme.body(11.5))
                        .foregroundStyle(Theme.subtle)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect(cornerRadius: 20))
            .vegoCard(cornerRadius: 20)
        }
        .buttonStyle(.plain)
    }

    /// La lista nasce solo qui, già con qualcosa dentro. Cancel o
    /// chiusura dello sheet non scrive nulla.
    private func commitBlankList(names: [String], recipes: [SavedRecipe]) {
        guard let runId = LocalListBuilder.startManualRun(
            scope: appState.scope,
            itemNames: names,
            recipes: recipes
        ) else { return }

        let unique = Set(names.map { $0.lowercased() } + recipes.flatMap { $0.ingredients.map { $0.name.lowercased() } })
        appState.announceSharedList(
            runId: runId,
            title: "Shopping list",
            budgetUsd: ceil(recipes.reduce(0) { $0 + $1.costUsd }),
            itemCount: unique.count
        )

        showBlankComposer = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
            var stub = Run()
            stub.id = runId
            stub.status = .shopping
            stub.craving = recipes.isEmpty ? "manual" : "from_recipes"
            stub.title = "Shopping list"
            reopeningRun = stub
        }
    }

    // La libreria dei piani non occupa più mezza home: una card sola,
    // azzurro pastello. I piani sono un VENTAGLIO di mini-card, come il
    // deck di ricette che si swipa: il gesto simbolo dell'app.
    private var myPlansCard: some View {
        Button {
            Haptics.light()
            showAllPlans = true
        } label: {
            // Il campo base sul lago: dove tornano le tue liste.
            CherryIllustratedCard(
                wash: Theme.sky,
                image: "IllustrationLake",
                height: 144,
                imageAlignment: .center,
                fadeEnd: 0.7
            ) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("My Lists")
                        .font(Theme.display(24))
                        .foregroundStyle(Theme.ink)
                    Text(pastRuns.isEmpty
                         ? "Your lists will land here"
                         : (pastRuns.count == 1 ? "1 list saved" : "\(pastRuns.count) lists saved"))
                        .font(Theme.body(13, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                    Spacer(minLength: 0)
                    HStack(spacing: 5) {
                        Text("Browse")
                        Image(systemName: "arrow.right")
                    }
                    .font(Theme.body(13, weight: .bold))
                    .foregroundStyle(Color(hex: 0x4A7D9E))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .glassEffect(.regular.tint(.white.opacity(0.35)), in: .capsule)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 22)
            }
            .contentShape(CherryPebbleShape())
        }
        .buttonStyle(CherryCardButtonStyle())
    }

    // Striscia di stagione: ancora la parte bassa della home con qualcosa
    // di utile (i prodotti del mese costano meno) che cambia da solo.
    private var seasonalStrip: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "leaf.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Theme.brand)
                Text("In season")
                    .font(Theme.body(12, weight: .bold))
                    .foregroundStyle(Theme.subtle)
            }
            .padding(.leading, 4)

            SeasonalMarqueeRow(items: Self.seasonalProduce())
        }
    }

    private static func seasonalProduce(month: Int = Calendar.current.component(.month, from: Date())) -> [(emoji: String, name: String)] {
        switch month {
        case 12, 1, 2:
            [("🍊", "Oranges"), ("🥬", "Kale"), ("🥔", "Potatoes"), ("🍋", "Lemons"), ("🥦", "Broccoli"),
             ("🌰", "Chestnuts"), ("🥕", "Carrots"), ("🧅", "Leeks"), ("🍎", "Apples"), ("🥬", "Cabbage"),
             ("🍠", "Sweet potatoes"), ("🥝", "Kiwi")]
        case 3, 4, 5:
            [("🍓", "Strawberries"), ("🥬", "Spinach"), ("🫛", "Peas"), ("🥕", "Carrots"), ("🍒", "Cherries"),
             ("🥗", "Artichokes"), ("🌱", "Asparagus"), ("🥬", "Lettuce"), ("🧅", "Spring onions"), ("🍋", "Lemons"),
             ("🌿", "Mint"), ("🥒", "Radishes")]
        case 6, 7, 8:
            [("🍅", "Tomatoes"), ("🍑", "Peaches"), ("🌽", "Corn"), ("🍉", "Watermelon"), ("🥒", "Zucchini"),
             ("🌿", "Basil"), ("🍆", "Eggplant"), ("🫑", "Bell peppers"), ("🍈", "Melon"), ("🥒", "Cucumbers"),
             ("🫐", "Blueberries"), ("🍇", "Figs")]
        default:
            [("🎃", "Pumpkin"), ("🍄", "Mushrooms"), ("🍐", "Pears"), ("🍇", "Grapes"), ("🥜", "Walnuts"),
             ("🥬", "Chard"), ("🍎", "Apples"), ("🍠", "Sweet potatoes"), ("🥦", "Cauliflower"), ("🌰", "Chestnuts"),
             ("🍊", "Persimmons"), ("🥬", "Brussels sprouts")]
        }
    }

}

// MARK: - Spesa in corso nello spazio condiviso

/// Mentre guardo le mie liste, l'altra persona ne ha una aperta: si
/// segnala una volta sola, in modo esplicito, e ci si entra con un tap.
private struct AwayRunBanner: View {
    let run: Run
    let space: Space
    let onOpen: () -> Void

    private var progress: String {
        let items = run.groceryItems ?? []
        guard !items.isEmpty else { return "just started" }
        return "\(items.filter(\.checked).count)/\(items.count) done"
    }

    var body: some View {
        Button(action: onOpen) {
            CherryPebbleCard(wash: Theme.peach, accent: Theme.amber, blobs: .meadow) {
                HStack(spacing: 12) {
                    Image(systemName: "cart.fill.badge.plus")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Theme.brand)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Shopping in \(space.name)")
                            .font(Theme.body(15, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        Text(progress)
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.subtle)
                    }

                    Spacer()

                    Text("Open")
                        .font(Theme.body(13, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .glassEffect(.regular.tint(Theme.brand.opacity(0.92)), in: .capsule)
                }
                .padding(16)
            }
            .contentShape(CherryPebbleShape())
        }
        .buttonStyle(CherryCardButtonStyle())
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

// MARK: - Sheet con tutti i piani

private struct MealPlansSheet: View {
    @EnvironmentObject private var appState: AppState
    let runs: [Run]
    let onOpen: (Run) -> Void
    let onDelete: (Run) -> Void
    let onRename: (Run, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var planToDelete: Run?
    @State private var planToRename: Run?
    @State private var draftName = ""

    var body: some View {
        ZStack {
            CherryBackground(mood: .calm)

            VStack(spacing: 0) {
                CherrySheetHeader(
                    title: "My Lists",
                    subtitle: "Reopen, rename, or start again",
                    chip: runs.count == 1 ? "1 list" : "\(runs.count) lists"
                )
                .padding(.horizontal, 24)
                .padding(.top, 28)
                .padding(.bottom, 18)

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 12) {
                        if runs.isEmpty {
                            CherrySheetEmpty(
                                wash: Theme.sky.opacity(0.55),
                                symbol: "list.bullet.rectangle",
                                tint: Color(hex: 0x4A7D9E),
                                title: "Nothing here yet",
                                subtitle: "Lists you finish land here."
                            )
                        } else {
                            ForEach(Array(runs.enumerated()), id: \.element.id) { index, run in
                                row(run, wash: CherryRowWash.at(index))
                            }
                        }
                        Spacer(minLength: 24)
                    }
                    .padding(.horizontal, 20)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(32)
        .alert(
            "Delete this list?",
            isPresented: Binding(
                get: { planToDelete != nil },
                set: { if !$0 { planToDelete = nil } }
            )
        ) {
            Button("Delete", role: .destructive) {
                if let run = planToDelete { onDelete(run) }
                planToDelete = nil
            }
            Button("Cancel", role: .cancel) { planToDelete = nil }
        } message: {
            Text("The list and its recipes will be removed permanently.")
        }
        .alert(
            "Rename list",
            isPresented: Binding(
                get: { planToRename != nil },
                set: { if !$0 { planToRename = nil } }
            )
        ) {
            TextField("List name", text: $draftName)
            Button("Save") {
                if let run = planToRename { onRename(run, draftName) }
                planToRename = nil
            }
            Button("Cancel", role: .cancel) { planToRename = nil }
        }
    }

    private func row(_ run: Run, wash: Color) -> some View {
        Button {
            Haptics.light()
            onOpen(run)
        } label: {
            CherryMediaRow(
                wash: wash,
                thumb: {
                    Text(cravingEmoji(run.craving))
                        .font(.system(size: 28))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.cream)
                },
                title: planTitle(run),
                subtitle: run.preset == true
                    ? "Cherry pick"
                    : (run.createdAt?.formatted(date: .abbreviated, time: .omitted) ?? ""),
                trailing: {
                    Text(appState.money(run.budgetUsd))
                        .font(Theme.body(14, weight: .bold))
                        .foregroundStyle(Theme.subtle)
                }
            )
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                draftName = planTitle(run)
                planToRename = run
            } label: {
                Label("Rename", systemImage: "pencil")
            }
            Button(role: .destructive) {
                planToDelete = run
            } label: {
                Label("Delete list", systemImage: "trash")
            }
        }
    }
}

// MARK: - Naming/emoji condivisi tra home e sheet

private func cravingEmoji(_ craving: String) -> String {
    // Scelta multipla: si mostra l'emoji della prima cucina.
    switch craving.components(separatedBy: ", ").first ?? craving {
    case "Italian": "🍝"
    case "Mexican": "🌮"
    case "Japanese": "🍜"
    case "Thai": "🥥"
    case "Indian": "🍛"
    case "American": "🍔"
    case "Chinese": "🥡"
    case "Middle Eastern": "🧆"
    case "Korean": "🍚"
    case "Fresh & light": "🥗"
    case "from_recipes": "📖"
    case "manual": "🛒"
    case "Tokyo Nights": "🍜"
    case "Greek Escape": "🫒"
    case "Nonna's Week": "🍝"
    case "Weekend Feast": "🎉"
    default: "🎲"
    }
}

func planTitle(_ run: Run) -> String {
    if let custom = run.title, !custom.trimmingCharacters(in: .whitespaces).isEmpty {
        return custom
    }
    // I piani curati hanno già un nome proprio.
    if run.preset == true { return run.craving }
    let parts = run.craving.components(separatedBy: ", ")
    if parts.count > 1 { return "\(parts[0]) + \(parts.count - 1) more" }
    switch run.craving {
    case "surprise": return "Surprise mix"
    case "from_recipes": return "From my recipes"
    case "manual": return "Shopping list"
    default: return "\(run.craving) week"
    }
}

// MARK: - Badge discreto per i contenuti curati da Cherry

enum CherryPickBadgeStyle {
    case inline   // su card chiare
    case overlay  // su foto ricetta scura
}

struct CherryPickBadge: View {
    var style: CherryPickBadgeStyle = .inline

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: "leaf.fill")
                .font(.system(size: 6, weight: .semibold))
            Text("Cherry pick")
                .font(.system(size: 8, weight: .semibold, design: .rounded))
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(background, in: .capsule)
    }

    private var foreground: Color {
        switch style {
        case .inline: Theme.brand.opacity(0.75)
        case .overlay: .white.opacity(0.9)
        }
    }

    private var background: Color {
        switch style {
        case .inline: Theme.brand.opacity(0.1)
        case .overlay: .white.opacity(0.18)
        }
    }
}

/// Le ricette/liste seminata all'avvio sono scelte nostre: dirlo
/// evita che l'utente le prenda per un menu già tarato sul suo profilo.
struct CherryPickNotice: View {
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "leaf.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.brand)
                .padding(.top, 1)
            Text("Cherry picks are our starter recipes — they don't follow your taste profile yet. Menus you generate will.")
                .font(Theme.body(13, weight: .medium))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.brand.opacity(0.1), in: .rect(cornerRadius: 18))
    }
}

// MARK: - Card della run attiva (§4: "12 of 24 items · $38 of $50")

/// La lista in corso, nello stesso linguaggio delle altre card della
/// home: stato in una chip di vetro, il NOME della lista grande, una
/// riga che dice dove sei, la barra, e un'azione in fondo a sinistra.
/// Il menu (chiudi / elimina) sta nell'angolo, fuori dal bottone.
private struct ActiveRunCard: View {
    @EnvironmentObject private var appState: AppState
    let run: Run
    let onTap: () -> Void
    let onStop: () -> Void
    let onDelete: () -> Void

    /// Inchiostro dell'accento sul burro: l'ambra pura è troppo chiara
    /// su un pastello chiaro.
    private static let amberInk = Color(hex: 0xB07A1F)

    private var items: [GroceryItem] { run.groceryItems ?? [] }
    private var checked: Int { items.filter(\.checked).count }
    private var spent: Double { items.filter(\.checked).reduce(0) { $0 + $1.costUsd } }
    private var fraction: Double { items.isEmpty ? 0 : Double(checked) / Double(items.count) }

    private var status: (symbol: String, label: String) {
        if run.merging == true { return ("arrow.triangle.merge", "Merging lists…") }
        switch run.status {
        case .shopping: return ("cart.fill", "Shopping now")
        case .generating: return ("sparkles", "Cooking your menu…")
        default: return ("hand.draw.fill", "Swipe in progress")
        }
    }

    private var isBusy: Bool { run.merging == true || run.status == .generating }

    private var detail: String {
        switch run.status {
        case .shopping:
            if items.isEmpty { return "Your list is ready to go" }
            if checked == items.count { return "All done — tap to wrap it up" }
            let left = items.count - checked
            return left == 1 ? "1 item left to grab" : "\(left) items left to grab"
        case .generating:
            if let done = run.imagesDone, let total = run.imagesTotal, total > 0 {
                return "Plating the photos · \(done)/\(total)"
            }
            return "Writing recipes for your budget"
        default:
            return "Pick up where you left off · \(appState.money(run.budgetUsd)) budget"
        }
    }

    private var action: String {
        switch run.status {
        case .shopping: "Continue shopping"
        case .generating: "Take a look"
        default: "Keep swiping"
        }
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Button {
                Haptics.light()
                onTap()
            } label: {
                CherryPebbleCard(wash: Theme.butter, accent: Theme.amber, blobs: .sunrise) {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .center) {
                            statusChip
                            Spacer(minLength: 8)
                            // Posto per il menu, montato sopra nel ZStack.
                            Color.clear.frame(width: 34, height: 34)
                        }

                        VStack(alignment: .leading, spacing: 3) {
                            Text(planTitle(run))
                                .font(Theme.display(24))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                            Text(detail)
                                .font(Theme.body(13, weight: .medium))
                                .foregroundStyle(Theme.subtle)
                                .lineLimit(1)
                        }

                        if run.status == .shopping, !items.isEmpty {
                            progress
                        }

                        HStack(spacing: 5) {
                            Text(action)
                            Image(systemName: "arrow.right")
                        }
                        .font(Theme.body(13, weight: .bold))
                        .foregroundStyle(Self.amberInk)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .glassEffect(.regular.tint(.white.opacity(0.35)), in: .capsule)
                    }
                    .padding(.horizontal, 26)
                    .padding(.vertical, 22)
                }
                .contentShape(CherryPebbleShape())
            }
            .buttonStyle(CherryCardButtonStyle())

            Menu {
                Button(role: .destructive, action: onStop) {
                    Label("End list", systemImage: "stop.circle")
                }
                Button(role: .destructive, action: onDelete) {
                    Label("Delete list", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 34, height: 34)
                    .contentShape(.circle)
                    .glassEffect(.regular.tint(.white.opacity(0.35)), in: .circle)
            }
            .accessibilityLabel("List options")
            .padding(.top, 22)
            .padding(.trailing, 22)
        }
    }

    private var statusChip: some View {
        HStack(spacing: 6) {
            if isBusy {
                ProgressView()
                    .controlSize(.mini)
                    .tint(Self.amberInk)
            } else {
                Image(systemName: status.symbol)
                    .font(.system(size: 10, weight: .bold))
            }
            Text(status.label)
                .font(.system(size: 11, weight: .heavy, design: .rounded))
        }
        .foregroundStyle(Self.amberInk)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .glassEffect(.regular.tint(.white.opacity(0.35)), in: .capsule)
    }

    /// Barra + riga dei numeri: pezzi presi e speso sul budget.
    private var progress: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.ink.opacity(0.08))
                    Capsule()
                        .fill(Theme.brand)
                        .frame(width: max(fraction > 0 ? 10 : 0, geo.size.width * fraction))
                }
            }
            .frame(height: 10)
            .animation(Theme.Motion.signature, value: fraction)

            HStack {
                Text("\(checked) of \(items.count) items")
                Spacer()
                Text("\(appState.money(spent)) of \(appState.money(run.budgetUsd))")
            }
            .font(Theme.body(12, weight: .semibold))
            .foregroundStyle(Theme.subtle)
        }
    }
}

/// Chip Cherry AI: fermo. Solo le scintille battono, il corpo non si muove.
private struct CherryAIBadge: View {
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "sparkles")
                .font(.system(size: 10, weight: .bold))
                .symbolEffect(.pulse, options: .repeating.speed(0.55))
            Text("Cherry AI")
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .tracking(0.4)
        }
        .foregroundStyle(Theme.brand)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .glassEffect(.regular.tint(.white.opacity(0.35)), in: .capsule)
        .accessibilityLabel("Powered by Cherry AI")
    }
}

// Marquee continuo: tre copie identiche che scorrono di una copia esatta,
// così quando l'animazione riparte l'occhio non vede il salto.
private struct SeasonalMarqueeRow: View {
    let items: [(emoji: String, name: String)]

    @State private var segmentWidth: CGFloat = 0
    @State private var animating = false

    private let spacing: CGFloat = 8
    private let speed: CGFloat = 34

    // La riga sta in un overlay su un contenitore vuoto: così la sua
    // larghezza (molto maggiore dello schermo) non entra nel layout
    // della pagina, e non serve ritagliarla — l'eccedenza cade fuori
    // dallo schermo da sola.
    var body: some View {
        Color.clear
            .frame(height: 44)
            .overlay(alignment: .leading) {
                HStack(spacing: 0) {
                    ForEach(0..<3, id: \.self) { _ in
                        segment
                    }
                }
                .fixedSize()
                .offset(x: animating ? -segmentWidth : 0)
                .animation(marqueeAnimation, value: animating)
            }
            .onAppear(perform: restart)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("In season now: \(items.map(\.name).joined(separator: ", "))")
    }

    private var marqueeAnimation: Animation? {
        guard segmentWidth > 0 else { return nil }
        return .linear(duration: Double(segmentWidth / speed)).repeatForever(autoreverses: false)
    }

    private var segment: some View {
        HStack(spacing: spacing) {
            ForEach(items, id: \.name) { item in
                HStack(spacing: 6) {
                    Text(item.emoji)
                        .font(.system(size: 16))
                    Text(item.name)
                        .font(Theme.body(13, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                }
                .fixedSize()
                .padding(.horizontal, 13)
                .padding(.vertical, 9)
                .glassEffect(.regular, in: .capsule)
            }
        }
        .padding(.trailing, spacing)
        .background(
            GeometryReader { geo in
                Color.clear
                    .onAppear { updateWidth(geo.size.width) }
                    .onChange(of: geo.size.width) { _, width in updateWidth(width) }
            }
        )
    }

    private func updateWidth(_ width: CGFloat) {
        guard width > 0, abs(width - segmentWidth) > 0.5 else { return }
        segmentWidth = width
        restart()
    }

    private func restart() {
        guard segmentWidth > 0 else { return }
        var reset = Transaction()
        reset.disablesAnimations = true
        withTransaction(reset) { animating = false }
        DispatchQueue.main.async { animating = true }
    }
}
