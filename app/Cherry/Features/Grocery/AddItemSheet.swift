import SwiftUI
import FirebaseFirestore

// Aggiunta a una lista già aperta, oppure bozza di una lista nuova.
// In bozza nulla va su Firestore finché non si preme Create list.
struct AddItemSheet: View {
    @ObservedObject private var store: RunStore
    private let composing: Bool
    private let onCreateList: (([String], [SavedRecipe]) -> Void)?

    @Environment(\.dismiss) private var dismiss

    init(store: RunStore) {
        _store = ObservedObject(wrappedValue: store)
        composing = false
        onCreateList = nil
    }

    init(scope: DataScope, jobs: JobClient, onCreateList: @escaping ([String], [SavedRecipe]) -> Void) {
        // Store solo per scope/uid e i listener dello storico: non si
        // chiama listen() e non si scrive la run.
        _store = ObservedObject(wrappedValue: RunStore(scope: scope, jobs: jobs))
        composing = true
        self.onCreateList = onCreateList
    }

    private enum Mode: String, CaseIterable {
        case items = "Items"
        case recipes = "Recipes"
    }

    private struct AddedEntry: Identifiable, Equatable {
        enum Kind: Equatable { case item, recipe }
        let id: UUID
        let kind: Kind
        let title: String
        let detail: String?
    }

    @State private var mode: Mode = .items
    @State private var draft = ""
    @State private var pastRuns: [Run] = []
    @State private var saved: [SavedRecipe] = []
    @State private var historyListener: ListenerRegistration?
    @State private var savedListener: ListenerRegistration?
    @State private var addedNow: [AddedEntry] = []
    @State private var draftNames: [String] = []
    @State private var draftRecipes: [SavedRecipe] = []
    @State private var detent: PresentationDetent = .medium
    @FocusState private var fieldFocused: Bool

    private var inList: Set<String> {
        if composing {
            return Set(draftNames.map { $0.lowercased() })
        }
        return Set((store.run?.groceryItems ?? []).map { $0.name.lowercased() })
    }

    private var alreadyOnList: Set<String> {
        if composing {
            return Set(draftRecipes.compactMap(\.id))
        }
        return Set(store.recipes.compactMap(\.savedRecipeId))
    }

    private var canCreate: Bool {
        !draftNames.isEmpty || !draftRecipes.isEmpty
    }

    private var availableRecipes: [SavedRecipe] {
        saved.filter { recipe in
            guard let id = recipe.id else { return false }
            return !alreadyOnList.contains(id)
        }
    }

    /// Nomi già visti, i più usati prima, esclusi quelli già in lista.
    private var suggestions: [String] {
        var counts: [String: (display: String, n: Int)] = [:]
        let needle = draft.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for run in pastRuns {
            for item in run.groceryItems ?? [] {
                let key = item.name.lowercased().trimmingCharacters(in: .whitespaces)
                guard !key.isEmpty, !inList.contains(key) else { continue }
                if !needle.isEmpty, !key.contains(needle) { continue }
                var entry = counts[key] ?? (item.name, 0)
                entry.n += 1
                counts[key] = entry
            }
        }
        return counts.values
            .sorted {
                if $0.n != $1.n { return $0.n > $1.n }
                return $0.display.localizedCaseInsensitiveCompare($1.display) == .orderedAscending
            }
            .prefix(24)
            .map(\.display)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                CherryBackground(mood: .fresh)

                VStack(alignment: .leading, spacing: 16) {
                    CherrySheetHeader(
                        title: composing ? "Blank list" : "Add to list",
                        subtitle: composing
                            ? "Type items, or drop in a recipe"
                            : "Whatever isn’t in a recipe yet"
                    )
                    .padding(.top, 4)

                    modePicker
                    if !addedNow.isEmpty { addedBlock }

                    ScrollView(showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 18) {
                            switch mode {
                            case .items:
                                field
                                if !suggestions.isEmpty {
                                    suggestionBlock
                                } else if draft.isEmpty, addedNow.isEmpty {
                                    Text(composing
                                         ? "The list is created only when you tap Create list."
                                         : "Toilet paper, oat milk, whatever you need.")
                                        .font(Theme.body(14))
                                        .foregroundStyle(Theme.subtle)
                                        .padding(.horizontal, 4)
                                }
                            case .recipes:
                                recipesBlock
                            }
                        }
                        .padding(.bottom, 40)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(composing ? "Cancel" : "Done") { dismiss() }
                }
                if composing {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Create list") { createList() }
                            .font(Theme.body(16, weight: .bold))
                            .disabled(!canCreate)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .onAppear {
            // Niente tastiera automatica: si apre quando tocchi il campo.
            listenHistory()
            listenSaved()
        }
        .onDisappear {
            historyListener?.remove()
            savedListener?.remove()
        }
        .onChange(of: mode) { _, newMode in
            if newMode == .recipes {
                fieldFocused = false
                detent = .large
            }
        }
    }

    private var modePicker: some View {
        HStack(spacing: 8) {
            ForEach(Mode.allCases, id: \.self) { tab in
                Button {
                    Haptics.selection()
                    withAnimation(Theme.Motion.quick) { mode = tab }
                } label: {
                    Text(tab.rawValue)
                        .font(Theme.body(14, weight: .semibold))
                        .foregroundStyle(mode == tab ? .white : Theme.ink)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .glassEffect(
                    mode == tab
                        ? .regular.tint(Theme.brand.opacity(0.92)).interactive()
                        : .regular.interactive(),
                    in: .capsule
                )
            }
        }
        .animation(Theme.Motion.quick, value: mode)
    }

    private var addedBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Added now")
                .font(Theme.body(13, weight: .bold))
                .foregroundStyle(Theme.brand)
                .textCase(.uppercase)

            ChipWrap(spacing: 8) {
                ForEach(addedNow) { entry in
                    HStack(spacing: 6) {
                        Image(systemName: entry.kind == .recipe ? "book.fill" : "checkmark.circle.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.brand)
                        Text(entry.title)
                            .font(Theme.body(14, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                        if let detail = entry.detail {
                            Text(detail)
                                .font(Theme.body(12, weight: .medium))
                                .foregroundStyle(Theme.subtle)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .glassEffect(.regular.tint(Theme.brand.opacity(0.16)), in: .capsule)
                    .transition(.asymmetric(
                        insertion: .scale(scale: 0.86).combined(with: .opacity),
                        removal: .scale(scale: 0.9).combined(with: .opacity)
                    ))
                }
            }
            .animation(Theme.Motion.signature, value: addedNow)
        }
    }

    private var field: some View {
        CherrySearchPill(icon: "plus", placeholder: "Milk, toilet paper…", text: $draft, submit: submitDraft) {
            Button(action: submitDraft) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(canSubmit ? Theme.brand : Theme.subtle.opacity(0.35))
            }
            .buttonStyle(.plain)
            .disabled(!canSubmit)
            .accessibilityLabel("Add")
        }
        .textInputAutocapitalization(.words)
        .focused($fieldFocused)
    }

    private var suggestionBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("From your lists")
                .font(Theme.body(13, weight: .bold))
                .foregroundStyle(Theme.subtle)

            ChipWrap(spacing: 8) {
                ForEach(suggestions, id: \.self) { name in
                    Button {
                        addItem(name)
                    } label: {
                        Text(name)
                            .font(Theme.body(14, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 8)
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .capsule)
                    .transition(.asymmetric(
                        insertion: .scale(scale: 0.92).combined(with: .opacity),
                        removal: .scale(scale: 0.86).combined(with: .opacity)
                    ))
                }
            }
            .animation(Theme.Motion.signature, value: suggestions)
        }
    }

    private var recipesBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            if availableRecipes.isEmpty {
                Text(saved.isEmpty
                     ? "Save a recipe first — then you can drop it in here with every ingredient."
                     : composing
                        ? "Every saved recipe is already in this draft."
                        : "Every saved recipe is already on this list.")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.subtle)
            } else {
                Text("Tap a recipe to add all its ingredients.")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.subtle)

                VStack(spacing: 12) {
                    ForEach(Array(availableRecipes.enumerated()), id: \.element.id) { index, recipe in
                        recipeTile(recipe, wash: CherryRowWash.at(index))
                    }
                }
            }
        }
    }

    private func recipeTile(_ recipe: SavedRecipe, wash: Color) -> some View {
        Button {
            addRecipe(recipe)
        } label: {
            CherryMediaRow(
                wash: wash,
                thumb: {
                    RecipePhoto(imageUrl: recipe.imageUrl, imageStatus: "ready")
                },
                title: recipe.title,
                subtitle: "\(recipe.ingredients.count) ingredients",
                trailing: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(Theme.brand)
                }
            )
        }
        .buttonStyle(.plain)
    }

    private var canSubmit: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submitDraft() {
        addItem(draft)
    }

    private func addItem(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Haptics.light()
        withAnimation(Theme.Motion.signature) {
            if composing {
                guard !inList.contains(trimmed.lowercased()) else { return }
                draftNames.append(trimmed)
            } else {
                guard store.addManualItem(name: trimmed) else { return }
            }
            addedNow.insert(
                AddedEntry(id: UUID(), kind: .item, title: trimmed, detail: nil),
                at: 0
            )
            if draft.lowercased() == trimmed.lowercased() { draft = "" }
        }
        fieldFocused = true
    }

    private func addRecipe(_ recipe: SavedRecipe) {
        Haptics.medium()
        if composing {
            guard let id = recipe.id, !alreadyOnList.contains(id) else { return }
            draftRecipes.append(recipe)
        } else {
            let added = store.addSavedRecipes([recipe])
            guard !added.isEmpty else { return }
        }
        withAnimation(Theme.Motion.signature) {
            addedNow.insert(
                AddedEntry(
                    id: UUID(),
                    kind: .recipe,
                    title: recipe.title,
                    detail: "\(recipe.ingredients.count) ing."
                ),
                at: 0
            )
        }
    }

    private func createList() {
        guard composing, canCreate else { return }
        Haptics.medium()
        onCreateList?(draftNames, draftRecipes)
        dismiss()
    }

    private func listenHistory() {
        guard historyListener == nil else { return }
        historyListener = FirestoreService.listenCollection(
            FirestoreService.runsQuery(scope: store.scope),
            as: Run.self
        ) { pastRuns = $0 }
    }

    private func listenSaved() {
        guard savedListener == nil else { return }
        savedListener = FirestoreService.listenCollection(
            FirestoreService.savedRecipesQuery(uid: store.uid),
            as: SavedRecipe.self
        ) { saved = $0 }
    }
}

/// Le chip vanno a capo da sole: una lista verticale è lenta al carrello.
private struct ChipWrap: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(in: proposal.width ?? 0, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(in: bounds.width, subviews: subviews)
        for (index, origin) in rows.origins.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y),
                proposal: .unspecified
            )
        }
    }

    private func arrange(in maxWidth: CGFloat, subviews: Subviews) -> (origins: [CGPoint], size: CGSize) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var width: CGFloat = 0
        let limit = maxWidth > 0 ? maxWidth : .infinity
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x > 0, x + size.width > limit {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            width = max(width, min(x - spacing, limit))
        }
        return (origins, CGSize(width: width, height: y + rowHeight))
    }
}
