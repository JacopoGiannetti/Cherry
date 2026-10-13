import SwiftUI
import FirebaseFirestore

// Il flusso inverso (§4 e §6): multi-selezione delle ricette salvate
// → lista della spesa istantanea, saltando craving e swipe.
// È ciò che rende l'app più veloce quanto più la usi.
struct FromRecipesSheet: View {
    /// Se c'è, le ricette vanno in questa lista invece di aprirne un'altra.
    var mergeInto: Run? = nil

    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var saved: [SavedRecipe] = []
    @State private var listener: ListenerRegistration?
    @State private var selection: Set<String> = []
    @State private var building = false
    @State private var errorMessage: String?
    @State private var query = ""
    @FocusState private var searchFocused: Bool

    /// Stessa ricerca della Collection: titolo, cucina, ingredienti.
    private var results: [SavedRecipe] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return saved }
        return saved.filter { recipe in
            if recipe.title.lowercased().contains(needle) { return true }
            if (recipe.cuisine ?? "").lowercased().contains(needle) { return true }
            if (recipe.oneLiner ?? "").lowercased().contains(needle) { return true }
            return recipe.ingredients.contains { $0.name.lowercased().contains(needle) }
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                CherryBackground(mood: .fresh)

                VStack(alignment: .leading, spacing: 16) {
                    CherrySheetHeader(
                        title: "From my recipes",
                        subtitle: "Pick dishes — the list writes itself",
                        chip: saved.isEmpty ? nil : "\(saved.count)"
                    )
                    .padding(.horizontal, 24)
                    .padding(.top, 8)

                    if !saved.isEmpty {
                        searchField
                            .padding(.horizontal, 20)
                    }

                    if results.isEmpty {
                        CherrySheetEmpty(
                            wash: Theme.lavender.opacity(0.5),
                            symbol: saved.isEmpty ? "book.closed" : "magnifyingglass",
                            tint: Color(hex: 0x6C5FA8),
                            title: saved.isEmpty ? "No saved recipes yet" : "No match",
                            subtitle: saved.isEmpty
                                ? "Star a dish from a list, or save one from TikTok."
                                : "Try a dish name, or one of its ingredients."
                        )
                        .padding(.horizontal, 20)
                        Spacer(minLength: 0)
                    } else {
                        ScrollView(showsIndicators: false) {
                            VStack(spacing: 12) {
                                ForEach(Array(results.enumerated()), id: \.element.id) { index, recipe in
                                    tile(recipe, wash: CherryRowWash.at(index))
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.bottom, 110)
                        }
                    }
                }

                if !saved.isEmpty {
                    VStack {
                        Spacer()
                        if let errorMessage {
                            Text(errorMessage)
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.soft_red)
                                .padding(.bottom, 8)
                        }
                        Button(building ? "Building your list…" : "Build list (\(selection.count))") {
                            buildRun()
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(selection.isEmpty || building)
                        .opacity(selection.isEmpty ? 0.5 : 1)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 16)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .onAppear(perform: listen)
        .onDisappear { listener?.remove() }
    }

    private func listen() {
        guard listener == nil else { return }
        listener = FirestoreService.listenCollection(
            FirestoreService.savedRecipesQuery(uid: appState.uid),
            as: SavedRecipe.self
        ) { saved = $0 }
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

    private func tile(_ recipe: SavedRecipe, wash: Color) -> some View {
        let isOn = selection.contains(recipe.id ?? "")
        return Button {
            Haptics.selection()
            searchFocused = false
            guard let id = recipe.id else { return }
            if isOn { selection.remove(id) } else { selection.insert(id) }
        } label: {
            CherryMediaRow(
                wash: wash,
                thumb: {
                    RecipePhoto(imageUrl: recipe.imageUrl, imageStatus: "ready")
                },
                title: recipe.title,
                subtitle: "\(recipe.ingredients.count) ingredients",
                trailing: {
                    Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(isOn ? Theme.brand : Theme.ink.opacity(0.18))
                }
            )
        }
        .buttonStyle(.plain)
    }

    private func buildRun() {
        Haptics.medium()
        building = true

        // Fusione deterministica sul telefono: nessuna chiamata al
        // backend, quindi la lista nasce anche senza rete.
        let picked = saved.filter { selection.contains($0.id ?? "") }
        let runId: String?
        if let current = mergeInto {
            runId = LocalListBuilder.appendRecipes(picked, toExisting: current, scope: appState.scope)
        } else {
            runId = LocalListBuilder.buildRun(scope: appState.scope, from: picked)
        }
        guard let runId else {
            errorMessage = "Couldn't build that list."
            building = false
            return
        }
        announce(runId: runId, recipes: picked)
        appState.pendingRunOpen = AppState.PendingRunOpen(runId: runId, spaceId: appState.scope.spaceId)

        building = false
        appState.selectedTab = .grocery
        dismiss()
    }

    /// In uno spazio condiviso la lista appare anche all'altra persona:
    /// glielo diciamo subito, senza aspettare che apra l'app.
    private func announce(runId: String, recipes: [SavedRecipe]) {
        let uniqueIngredients = Set(
            recipes.flatMap { $0.ingredients.map { $0.name.lowercased() } }
        )
        appState.announceSharedList(
            runId: runId,
            title: "From my recipes",
            budgetUsd: ceil(recipes.reduce(0) { $0 + $1.costUsd }),
            itemCount: uniqueIngredients.count
        )
    }
}
