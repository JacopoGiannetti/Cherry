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

    /// Titolo, cucina e ingredienti: si cerca anche per "chickpea",
    /// non solo per il nome del piatto.
    private var results: [SavedRecipe] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return recipes }
        return recipes.filter { recipe in
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
                        subtitle: "Search, open, or turn dishes into a list",
                        chip: recipes.isEmpty ? nil : "\(recipes.count)"
                    )

                    searchField

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
                            VStack(spacing: 12) {
                                ForEach(Array(results.enumerated()), id: \.element.id) { index, recipe in
                                    tile(recipe, wash: CherryRowWash.at(index))
                                }
                            }
                            .padding(.bottom, selectionMode && !selection.isEmpty ? 96 : 16)
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
                    videoUrl: live.videoUrl,
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

    @ViewBuilder
    private func tile(_ recipe: SavedRecipe, wash: Color) -> some View {
        let isOn = selection.contains(recipe.id ?? "")
        if selectionMode {
            Button {
                Haptics.selection()
                guard let id = recipe.id else { return }
                if isOn { selection.remove(id) } else { selection.insert(id) }
            } label: {
                tileContent(recipe, selected: isOn, wash: wash)
            }
            .buttonStyle(.plain)
        } else {
            Button {
                Haptics.light()
                searchFocused = false
                path.append(recipe)
            } label: {
                tileContent(recipe, selected: false, wash: wash)
            }
            .buttonStyle(.plain)
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

    private func tileContent(_ recipe: SavedRecipe, selected: Bool, wash: Color) -> some View {
        CherryMediaRow(
            wash: wash,
            thumb: {
                RecipePhoto(imageUrl: recipe.imageUrl, imageStatus: "ready")
            },
            title: recipe.title,
            subtitle: recipe.origin == "vego"
                ? "Cherry pick"
                : (recipe.origin.map { caption(for: $0, goal: recipe.swapGoal) } ?? "\(recipe.ingredients.count) ingredients"),
            trailing: {
                if selectionMode {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(selected ? Theme.brand : Theme.ink.opacity(0.18))
                } else {
                    Text("\(recipe.ingredients.count)")
                        .font(Theme.body(13, weight: .bold))
                        .foregroundStyle(Theme.subtle)
                }
            }
        )
    }

    private func caption(for origin: String, goal: String?) -> String {
        switch origin {
        case "swap": goal.flatMap(SwapGoal.init(rawValue:))?.caption ?? "adapted"
        case "manual": "yours"
        default: "saved"
        }
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
