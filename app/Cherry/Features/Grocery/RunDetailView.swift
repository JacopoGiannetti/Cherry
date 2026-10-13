import SwiftUI
import FirebaseFirestore

// Dettaglio di una run (attiva o passata): cosa conteneva, le ricette
// tenute e la lista della spesa. Da qui una run archiviata può essere
// ripresa: torna attiva e si riapre nel wizard.
struct RunDetailView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    let run: Run
    /// Chiamata quando l'utente riprende la run (già riattivata).
    let onResume: (Run) -> Void
    let onDelete: () -> Void

    @State private var recipes: [Recipe] = []
    @State private var recipesListener: ListenerRegistration?
    @State private var showDeleteConfirm = false
    @State private var showRename = false
    @State private var draftName = ""
    /// Nome scelto qui dentro: la run arriva per valore, senza questo
    /// il titolo resterebbe quello vecchio fino alla riapertura.
    @State private var localTitle: String?

    /// Solo le ricette accettate: quelle scartate nel deck hanno finito
    /// il loro compito quando l'utente le ha passate.
    private var keptRecipes: [Recipe] { recipes.filter { $0.decision == .kept } }

    /// Cosa mostrare: le accettate se esistono, altrimenti tutte quelle
    /// non scartate — così le liste vecchie (o importate) non appaiono
    /// mai senza le loro ricette.
    private var displayRecipes: [Recipe] {
        let fromStore = keptRecipes.isEmpty ? recipes.filter { $0.decision != .passed } : keptRecipes
        guard fromStore.count < (presetPlan?.recipes.count ?? 0),
              let plan = presetPlan
        else { return fromStore }
        return plan.recipes.enumerated().map { index, preset in
            preset.asKeptRecipe(id: "preset-\(index)-\(preset.title)", order: index)
        }
    }

    private var presetPlan: PresetPlans.PresetPlan? {
        guard run.preset == true else { return nil }
        return PresetPlans.all.first { $0.name == run.craving || $0.name == run.title }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                CherryBackground(mood: .fresh)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        if run.preset == true {
                            VStack(alignment: .leading, spacing: 10) {
                                CherryPickBadge()
                                CherryPickNotice()
                            }
                        }

                        summary

                        if !displayRecipes.isEmpty {
                            recipeSection("RECIPES IN THIS LIST", recipes: displayRecipes)
                        }

                        if let items = run.groceryItems, !items.isEmpty {
                            grocerySection(items)
                        }

                        Spacer(minLength: 30)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
                }
            }
            .navigationTitle(titleText)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 14, weight: .semibold))
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        draftName = titleText
                        showRename = true
                    } label: {
                        Image(systemName: "pencil")
                            .font(.system(size: 14, weight: .semibold))
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                }
            }
            .alert("Rename list", isPresented: $showRename) {
                TextField("List name", text: $draftName)
                Button("Save") { rename() }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Delete this list?", isPresented: $showDeleteConfirm) {
                Button("Delete", role: .destructive) {
                    onDelete()
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The list and its recipes will be removed permanently.")
            }
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 12) {
                    if run.status == .archived, run.groceryItems?.isEmpty == false {
                        // Restart: stessa lista, tutti gli spunti azzerati.
                        Button("Restart") {
                            Haptics.medium()
                            restart()
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .frame(width: 124)
                    }

                    Button(resumeLabel) {
                        Haptics.medium()
                        resume()
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 10)
            }
        }
        .onAppear(perform: listen)
        .onDisappear { recipesListener?.remove() }
    }

    private var titleText: String {
        if let localTitle { return localTitle }
        return planTitle(run)
    }

    private func rename() {
        let clean = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, let runId = run.id else { return }
        Haptics.light()
        localTitle = clean
        FirestoreService.setRunFields(scope: appState.scope, runId: runId, ["title": clean])
    }

    private func listen() {
        guard recipesListener == nil, let runId = run.id else { return }
        recipesListener = FirestoreService.listenCollection(
            FirestoreService.recipesQuery(scope: appState.scope, runId: runId),
            as: Recipe.self
        ) { recipes = $0 }
    }

    private var resumeLabel: String {
        guard run.status == .archived else { return "Open this list" }
        return run.preset == true ? "Shop this list" : "Resume"
    }

    private func resume() {
        guard let runId = run.id else { return }
        var reactivated = run
        if run.status == .archived {
            // Una sola lista viva: questa torna, le altre in corso no.
            FirestoreService.archiveActiveRuns(scope: appState.scope, except: runId)
            // Torna dov'era: in lista se l'aveva costruita, altrimenti al deck.
            let newStatus: RunStatus = (run.groceryItems?.isEmpty == false) ? .shopping : .swiping
            FirestoreService.setRunFields(scope: appState.scope, runId: runId, ["status": newStatus.rawValue])
            reactivated.status = newStatus
        }
        if reactivated.status == .shopping {
            announceIfShared(reactivated)
        }
        onResume(reactivated)
    }

    /// Ricomincia la spesa da capo: stessa lista, tutti gli item
    /// riportati a non comprati, e la run torna in shopping.
    private func restart() {
        guard let runId = run.id, var items = run.groceryItems else { return }
        for index in items.indices { items[index].checked = false }

        var reactivated = run
        reactivated.status = .shopping
        reactivated.groceryItems = items

        guard let data = try? JSONEncoder().encode(items),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return }
        FirestoreService.archiveActiveRuns(scope: appState.scope, except: runId)
        FirestoreService.setRunFields(scope: appState.scope, runId: runId, [
            "status": RunStatus.shopping.rawValue,
            "groceryItems": array,
        ])
        announceIfShared(reactivated)
        onResume(reactivated)
    }

    /// La Live Activity dell'altra persona nasce solo se glielo
    /// diciamo: riprendere una lista condivisa deve fare lo stesso
    /// broadcast della creazione.
    private func announceIfShared(_ run: Run) {
        guard appState.scope.isShared, let runId = run.id else { return }
        appState.announceSharedList(
            runId: runId,
            title: planTitle(run),
            budgetUsd: run.budgetUsd,
            itemCount: run.groceryItems?.count ?? 0
        )
    }

    // MARK: - Sezioni

    private var summary: some View {
        HStack(spacing: 14) {
            stat(appState.money(presetPlan?.totalCostUsd ?? run.budgetUsd), label: "budget")
            stat("\(displayRecipes.count)", label: "recipes kept")
            if let date = run.createdAt {
                stat(date.formatted(.dateTime.day().month(.abbreviated)), label: "started")
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func stat(_ value: String, label: String) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(Theme.title(20))
                .foregroundStyle(Theme.ink)
            Text(label)
                .font(Theme.body(11, weight: .semibold))
                .foregroundStyle(Theme.subtle)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
    }

    private func recipeSection(_ title: String, recipes: [Recipe]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(Theme.body(11, weight: .bold))
                .foregroundStyle(Theme.subtle)
                .tracking(1.2)

            ForEach(recipes) { recipe in
                NavigationLink {
                    RecipeDetailView(
                        title: recipe.title,
                        imageUrl: recipe.imageUrl,
                        costUsd: recipe.costUsd,
                        cookMinutes: recipe.cookMinutes,
                        servings: recipe.servings,
                        ingredients: recipe.ingredients,
                        steps: recipe.steps,
                        isCherryPick: run.preset == true
                    )
                } label: {
                    recipeRow(recipe)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func recipeRow(_ recipe: Recipe) -> some View {
        HStack(spacing: 12) {
            CachedImage(url: recipe.imageUrl.flatMap(URL.init)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ZStack {
                    Theme.mint.opacity(0.4)
                    Image(systemName: "fork.knife")
                        .foregroundStyle(Theme.brand.opacity(0.5))
                }
            }
            .frame(width: 58, height: 58)
            .clipShape(RoundedRectangle(cornerRadius: 14))

            VStack(alignment: .leading, spacing: 2) {
                Text(recipe.title)
                    .font(Theme.body(15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text("\(appState.money(recipe.costUsd)) · \(recipe.cookMinutes) min · \(recipe.servings) servings")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.subtle)
            }
            Spacer()
            if recipe.decision == .kept {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Theme.brand)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.subtle.opacity(0.6))
        }
        .padding(10)
        .contentShape(.rect(cornerRadius: 18))
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
    }

    private func grocerySection(_ items: [GroceryItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("GROCERY LIST · \(items.filter(\.checked).count)/\(items.count)")
                .font(Theme.body(11, weight: .bold))
                .foregroundStyle(Theme.subtle)
                .tracking(1.2)

            VStack(spacing: 0) {
                ForEach(items) { item in
                    HStack(spacing: 10) {
                        Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 15))
                            .foregroundStyle(item.checked ? Theme.brand : Theme.subtle.opacity(0.4))
                        Text(item.name)
                            .font(Theme.body(14, weight: .medium))
                            .foregroundStyle(Theme.ink)
                            .strikethrough(item.checked, color: Theme.subtle)
                        Spacer()
                        Text(item.quantity)
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.subtle)
                    }
                    .padding(.vertical, 8)
                    .padding(.horizontal, 14)
                }
            }
            .padding(.vertical, 6)
            .glassEffect(.regular, in: .rect(cornerRadius: 18))
        }
    }
}
