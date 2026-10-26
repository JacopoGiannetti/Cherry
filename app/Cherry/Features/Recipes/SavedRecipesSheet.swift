import SwiftUI

// La collezione non sta più aperta sulla home: si apre da qui, con la
// ricerca in cima. Passate le dieci ricette, scorrere una griglia è
// più lento che scrivere "ramen".
struct SavedRecipesSheet: View {
    let recipes: [SavedRecipe]
    let onDelete: (SavedRecipe) -> Void
    let onVeganize: (String) -> Void

    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var selectionMode = false
    @State private var selection: Set<String> = []
    @State private var recipeToDelete: SavedRecipe?
    @State private var confirmingBulkDelete = false
    @State private var path = NavigationPath()
    @State private var pendingBuild: [SavedRecipe] = []
    @State private var showActiveConflict = false
    @State private var recipeToEdit: SavedRecipe?
    @FocusState private var searchFocused: Bool

    @State private var filter: Filter = .all

    private enum Filter: String, CaseIterable {
        case all = "All"
        case videos = "From videos"
        case adapted = "Adapted"
        case yours = "Yours"

        func matches(_ recipe: SavedRecipe) -> Bool {
            switch self {
            case .all: true
            case .videos: DynamicRecipeView.supports(sourceUrl: recipe.sourceUrl)
            case .adapted: recipe.origin == "swap"
            case .yours: recipe.origin == "manual"
            }
        }
    }

    /// Solo i filtri che troverebbero qualcosa.
    private var availableFilters: [Filter] {
        Filter.allCases.filter { $0 == .all || recipes.contains(where: $0.matches) }
    }

    /// Inutili se ogni filtro mostrerebbe comunque tutta la collezione.
    private var showsFilters: Bool {
        availableFilters.dropFirst().contains { option in recipes.contains { !option.matches($0) } }
    }

    private var needle: String { query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

    /// La più recente in grande, solo sulla collezione intera: una
    /// ricerca o un filtro sono una lista di risultati, tutti alla pari.
    private var hero: SavedRecipe? {
        needle.isEmpty && filter == .all ? results.first : nil
    }

    private var gridRecipes: [SavedRecipe] {
        hero == nil ? results : Array(results.dropFirst())
    }

    /// Titolo, cucina e ingredienti: si cerca anche per "chickpea",
    /// non solo per il nome del piatto.
    private var results: [SavedRecipe] {
        let filtered = recipes.filter(filter.matches)
        guard !needle.isEmpty else { return filtered }
        return filtered.filter { recipe in
            if recipe.title.lowercased().contains(needle) { return true }
            if (recipe.cuisine ?? "").lowercased().contains(needle) { return true }
            if (recipe.oneLiner ?? "").lowercased().contains(needle) { return true }
            return recipe.ingredients.contains { $0.name.lowercased().contains(needle) }
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                CherryBackground(mood: .warm)

                VStack(alignment: .leading, spacing: 16) {
                    CherrySheetHeader(
                        title: "Collection",
                        chip: recipes.isEmpty ? nil : "\(recipes.count)"
                    )

                    searchField

                    if showsFilters {
                        filterBar
                    }

                    if results.isEmpty {
                        CherrySheetEmpty(
                            wash: Theme.lavender.opacity(0.5),
                            symbol: recipes.isEmpty ? "book.closed" : "magnifyingglass",
                            tint: Color(hex: 0x6C5FA8),
                            title: recipes.isEmpty ? "Nothing saved yet" : "No match",
                            subtitle: recipes.isEmpty
                                ? "Write one, paste a link, or star a dish from a list."
                                : "Try a dish name, or one of its ingredients."
                        )
                        Spacer(minLength: 0)
                    } else {
                        ScrollView(showsIndicators: false) {
                            VStack(spacing: 18) {
                                if let hero {
                                    tile(hero) { selected in heroCard(hero, selected: selected) }
                                }
                                LazyVGrid(
                                    columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                                    alignment: .leading,
                                    spacing: 18
                                ) {
                                    ForEach(gridRecipes, id: \.id) { recipe in
                                        tile(recipe) { selected in gridCard(recipe, selected: selected) }
                                    }
                                }
                            }
                            .padding(.top, 2)
                            .padding(.bottom, selectionMode && !selection.isEmpty ? 96 : 16)
                            .animation(Theme.Motion.signature, value: filter)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)

                if selectionMode, !selection.isEmpty {
                    VStack {
                        Spacer()
                        HStack(spacing: 10) {
                            // Selezionate più ricette: si buttano via
                            // insieme, senza un long-press per ciascuna.
                            Button {
                                Haptics.light()
                                confirmingBulkDelete = true
                            } label: {
                                Image(systemName: "trash")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 54, height: 54)
                                    .contentShape(.circle)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(.regular.tint(Theme.soft_red.opacity(0.9)).interactive(), in: .circle)
                            .accessibilityLabel("Delete selected recipes")

                            Button("Build a grocery list (\(selection.count))") {
                                buildRun()
                            }
                            .buttonStyle(PrimaryButtonStyle())
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 16)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if !recipes.isEmpty {
                        Button(selectionMode ? "Done" : "Select") {
                            Haptics.light()
                            withAnimation(Theme.Motion.quick) {
                                selectionMode.toggle()
                                if !selectionMode { selection.removeAll() }
                            }
                        }
                        .font(Theme.body(15, weight: .semibold))
                    }
                }
            }
            .navigationDestination(for: SavedRecipe.self) { recipe in
                // Salvata as-is: il veganize rimandato resta a un tap,
                // ma va fatto fuori da qui (lo swap è a schermo pieno).
                let live = recipes.first { $0.id == recipe.id } ?? recipe
                let veganizeUrl = live.origin == "imported" ? live.sourceUrl : nil
                RecipeDetailView(
                    title: live.title,
                    imageUrl: live.imageUrl,
                    costUsd: live.costUsd,
                    cookMinutes: live.cookMinutes,
                    servings: live.servings,
                    ingredients: live.ingredients,
                    steps: live.steps,
                    onSave: nil,
                    showsNavigationChrome: true,
                    sourceUrl: live.sourceUrl,
                    onVeganize: veganizeUrl.map { url in
                        { onVeganize(url) }
                    },
                    isCherryPick: live.origin == "vego" || live.preset == true,
                    isUserAuthored: live.origin == "manual",
                    onEdit: { recipeToEdit = live },
                    onDelete: {
                        // Prima si torna alla lista, poi sparisce la
                        // riga: il dettaglio non deve restare aperto su
                        // una ricetta che non c'è più.
                        if !path.isEmpty { path.removeLast() }
                        onDelete(live)
                    },
                    isImported: live.origin == "imported",
                    hasAIPhoto: live.hasAIPhoto,
                    coverStatus: live.coverStatus,
                    coverError: live.coverError,
                    // Il fotogramma del video è quasi sempre brutto: chi
                    // ha salvato dai social può farsi fare la copertina.
                    onGenerateCover: live.origin == "imported" ? live.id.map { id in
                        { try await appState.jobs.start("/swap/cover", body: ["recipeId": id]) }
                    } : nil,
                    segments: live.segments,
                    dynamicStatus: live.dynamicStatus,
                    dynamicError: live.dynamicError,
                    onGenerateDynamic: DynamicRecipeView.supports(sourceUrl: live.sourceUrl) ? live.id.map { id in
                        { _ = try await appState.jobs.start("/swap/dynamic", body: ["recipeId": id]) }
                    } : nil
                )
            }
            .sheet(item: $recipeToEdit) { recipe in
                ManualRecipeSheet(existing: recipe)
            }
            .alert(
                "Delete this recipe?",
                isPresented: Binding(
                    get: { recipeToDelete != nil },
                    set: { if !$0 { recipeToDelete = nil } }
                )
            ) {
                Button("Delete", role: .destructive) {
                    if let recipe = recipeToDelete { onDelete(recipe) }
                    recipeToDelete = nil
                }
                Button("Cancel", role: .cancel) { recipeToDelete = nil }
            }
            .alert(
                selection.count == 1 ? "Delete this recipe?" : "Delete \(selection.count) recipes?",
                isPresented: $confirmingBulkDelete
            ) {
                Button("Delete", role: .destructive, action: deleteSelected)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("They leave your collection for good. Lists you already built keep their items.")
            }
            .confirmationDialog(
                "You already have a grocery list going",
                isPresented: $showActiveConflict,
                titleVisibility: .visible
            ) {
                Button("Replace it (archive current)", role: .destructive) {
                    commitBuild(pendingBuild, merge: false)
                }
                Button("Add to current list") {
                    commitBuild(pendingBuild, merge: true)
                }
                Button("Cancel", role: .cancel) { pendingBuild = [] }
            } message: {
                Text("Only one list at a time. Replace this one, or add these recipes to it.")
            }
        }
    }

    private var searchField: some View {
        CherrySearchPill(placeholder: "Name or ingredient", text: $query) {
            if !query.isEmpty {
                Button {
                    withAnimation(Theme.Motion.quick) { query = "" }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.subtle.opacity(0.45))
                }
                .buttonStyle(.plain)
            }
        }
        .focused($searchFocused)
    }

    /// Stessa card in selezione e no: cambia solo cosa fa il tap.
    @ViewBuilder
    private func tile<Card: View>(_ recipe: SavedRecipe, @ViewBuilder card: (Bool) -> Card) -> some View {
        let isOn = selection.contains(recipe.id ?? "")
        if selectionMode {
            Button {
                Haptics.selection()
                guard let id = recipe.id else { return }
                if isOn { selection.remove(id) } else { selection.insert(id) }
            } label: {
                card(isOn)
            }
            .buttonStyle(CherryCardButtonStyle())
        } else {
            Button {
                Haptics.light()
                searchFocused = false
                path.append(recipe)
            } label: {
                card(false)
            }
            .buttonStyle(CherryCardButtonStyle())
            .contextMenu {
                Button {
                    recipeToEdit = recipe
                } label: {
                    Label("Edit recipe", systemImage: "pencil")
                }
                Button(role: .destructive) {
                    recipeToDelete = recipe
                } label: {
                    Label("Delete recipe", systemImage: "trash")
                }
            }
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(availableFilters, id: \.self) { option in
                    let on = filter == option
                    Button {
                        guard !on else { return }
                        Haptics.selection()
                        withAnimation(Theme.Motion.quick) { filter = option }
                    } label: {
                        let label = Text(option.rawValue)
                            .font(Theme.body(14, weight: .bold))
                            .foregroundStyle(on ? .white : Theme.ink)
                            .padding(.horizontal, 16)
                            .frame(height: 36)
                            .contentShape(.capsule)
                        if on {
                            label.background(Theme.ink, in: .capsule)
                        } else {
                            label.glassChip(interactive: true)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
    }

    private func heroCard(_ recipe: SavedRecipe, selected: Bool) -> some View {
        Color.clear
            .frame(height: 250)
            .overlay { RecipePhoto(imageUrl: recipe.imageUrl, imageStatus: "ready") }
            .overlay {
                LinearGradient(
                    colors: [.clear, .black.opacity(0.15), .black.opacity(0.7)],
                    startPoint: .center,
                    endPoint: .bottom
                )
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("LATEST")
                        .font(Theme.body(11, weight: .bold))
                        .tracking(1.4)
                        .foregroundStyle(.white.opacity(0.75))
                    Text(recipe.title)
                        .font(Theme.display(26))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    meta(recipe)
                        .foregroundStyle(.white.opacity(0.85))
                }
                .padding(18)
            }
            .overlay(alignment: .topLeading) { badges(recipe).padding(14) }
            .overlay(alignment: .topTrailing) { selectionMark(selected).padding(12) }
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
            .overlay(selectedBorder(selected, cornerRadius: Theme.cornerRadius))
            .shadow(color: Theme.ink.opacity(0.12), radius: 16, y: 8)
    }

    private func gridCard(_ recipe: SavedRecipe, selected: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Color.clear
                .aspectRatio(4 / 5, contentMode: .fit)
                .overlay { RecipePhoto(imageUrl: recipe.imageUrl, imageStatus: "ready") }
                .overlay(alignment: .topLeading) { badges(recipe).padding(10) }
                .overlay(alignment: .topTrailing) { selectionMark(selected).padding(8) }
                .clipShape(RoundedRectangle(cornerRadius: 22))
                .overlay(selectedBorder(selected, cornerRadius: 22))
                .shadow(color: Theme.ink.opacity(0.10), radius: 10, y: 5)

            Text(recipe.title)
                .font(Theme.body(15, weight: .bold))
                .foregroundStyle(Theme.ink)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 2)

            meta(recipe)
                .foregroundStyle(Theme.subtle)
                .padding(.horizontal, 2)
        }
        .contentShape(.rect)
    }

    /// Tempo e provenienza: "15 min · Instagram".
    private func meta(_ recipe: SavedRecipe) -> some View {
        let parts = [recipe.cookMinutes > 0 ? "\(recipe.cookMinutes) min" : nil, origin(of: recipe)].compactMap { $0 }
        return Text(parts.isEmpty ? "\(recipe.ingredients.count) ingredients" : parts.joined(separator: " · "))
            .font(Theme.body(12, weight: .semibold))
            .lineLimit(1)
    }

    private func origin(of recipe: SavedRecipe) -> String? {
        if recipe.origin == "vego" || recipe.preset == true { return "Cherry pick" }
        if recipe.origin == "manual" { return "Yours" }
        let host = recipe.sourceUrl.flatMap(URL.init)?.host?.lowercased() ?? ""
        if host.contains("tiktok") { return "TikTok" }
        if host.contains("instagram") || host.contains("instagr.am") { return "Instagram" }
        if host.contains("youtu") { return "YouTube" }
        return nil
    }

    /// Sulla foto: la trasformazione, col colore della sua parola, e la
    /// vista dinamica se è pronta.
    private func badges(_ recipe: SavedRecipe) -> some View {
        HStack(spacing: 6) {
            if recipe.origin == "swap" {
                // Le trasformate senza goal sono le vecchie, tutte vegane.
                let magnet = (recipe.swapGoal.flatMap(SwapGoal.init(rawValue:)) ?? .vegan).magnet
                Text(magnet.word)
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(magnet.ink)
                    .padding(.horizontal, 9)
                    .frame(height: 24)
                    .background(magnet.wash, in: .capsule)
            }
            if hasDynamic(recipe) {
                Image(systemName: "play.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 24, height: 24)
                    .background(.black.opacity(0.4), in: .circle)
                    .accessibilityLabel("Dynamic view")
            }
        }
    }

    private func hasDynamic(_ recipe: SavedRecipe) -> Bool {
        DynamicRecipeView.supports(sourceUrl: recipe.sourceUrl)
            && DynamicRecipeView.pages(recipe.segments, steps: recipe.steps, ingredients: recipe.ingredients).count >= 2
    }

    @ViewBuilder
    private func selectionMark(_ selected: Bool) -> some View {
        if selectionMode {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.white, selected ? Theme.brand : .white)
                .shadow(color: .black.opacity(0.25), radius: 4)
                .contentTransition(.symbolEffect(.replace))
        }
    }

    private func selectedBorder(_ selected: Bool, cornerRadius: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .strokeBorder(Theme.brand, lineWidth: 3)
            .opacity(selected ? 1 : 0)
    }

    private func deleteSelected() {
        Haptics.medium()
        let picked = recipes.filter { selection.contains($0.id ?? "") }
        picked.forEach(onDelete)
        withAnimation(Theme.Motion.quick) {
            selection.removeAll()
            selectionMode = false
        }
    }

    private func buildRun() {
        Haptics.medium()
        let picked = recipes.filter { selection.contains($0.id ?? "") }
        guard !picked.isEmpty else { return }
        if appState.groceryHasActiveList {
            pendingBuild = picked
            showActiveConflict = true
            return
        }
        commitBuild(picked, merge: false)
    }

    private func commitBuild(_ picked: [SavedRecipe], merge: Bool) {
        pendingBuild = []
        if merge, let runId = appState.activeShoppingRunId {
            LocalListBuilder.appendRecipes(picked, toRunId: runId, scope: appState.scope) { ok in
                DispatchQueue.main.async {
                    guard ok else { return }
                    finishBuild(runId: runId, recipes: picked)
                }
            }
            return
        }
        if let runId = LocalListBuilder.buildRun(scope: appState.scope, from: picked) {
            finishBuild(runId: runId, recipes: picked)
        }
    }

    private func finishBuild(runId: String, recipes picked: [SavedRecipe]) {
        let ingredients = Set(picked.flatMap { $0.ingredients.map { $0.name.lowercased() } })
        appState.announceSharedList(
            runId: runId,
            title: "From my recipes",
            budgetUsd: ceil(picked.reduce(0) { $0 + $1.costUsd }),
            itemCount: ingredients.count
        )
        selectionMode = false
        selection.removeAll()
        appState.selectedTab = .grocery
        appState.pendingRunOpen = AppState.PendingRunOpen(runId: runId, spaceId: appState.scope.spaceId)
        dismiss()
    }
}
