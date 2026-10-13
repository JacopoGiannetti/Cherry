import SwiftUI
import FirebaseFirestore

// La Grocery List (§4.2): raggruppata per reparto, checkbox oversized,
// dot colorati per ricetta (l'ingrediente condiviso indossa più dot),
// paracadute in corsia, spuntati che collassano in fondo,
// auto-archiviazione a lista completata.
struct GroceryListView: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject var store: RunStore
    let onClose: () -> Void

    @State private var parachuteItem: GroceryItem?
    /// Ingrediente in attesa di conferma: aprire il paracadute costa una
    /// chiamata all'AI, quindi un tap per sbaglio non deve farla partire.
    @State private var swapCandidate: GroceryItem?
    @State private var showRecipes = false
    @State private var showAddItem = false
    @State private var showResetIngredients = false
    @State private var celebrated = false
    @State private var showBudgetEditor = false
    @State private var budgetDraft = ""
    @State private var priceItem: GroceryItem?
    @State private var priceDraft = ""

    /// Un colore per ricetta, nell'ordine dei kept.
    private var dotColors: [String: Color] {
        let palette: [Color] = [
            Theme.brand, Theme.amber, Color(hex: 0x4A6B8A),
            Color(hex: 0xA83E5A), Color(hex: 0x7A5AC9), Color(hex: 0xC97C2A),
        ]
        var mapping: [String: Color] = [:]
        for (index, recipe) in store.keptRecipes.enumerated() {
            if let id = recipe.id { mapping[id] = palette[index % palette.count] }
        }
        return mapping
    }

    private var swapConfirmBinding: Binding<Bool> {
        Binding(get: { swapCandidate != nil }, set: { if !$0 { swapCandidate = nil } })
    }

    private var items: [GroceryItem] { store.run?.groceryItems ?? [] }
    private var checkedItems: [GroceryItem] { items.filter(\.checked) }
    private var spentUsd: Double { checkedItems.reduce(0) { $0 + $1.costUsd } }

    /// Gli spuntati restano dove sono, nel loro reparto: al carrello si
    /// spunta camminando fra gli scaffali, non si riordina la lista
    /// sotto le mani di chi la sta leggendo.
    private var sections: [(StoreSection, [GroceryItem])] {
        StoreSection.allCases.compactMap { section in
            let sectionItems = items.filter { $0.storeSection == section }
            return sectionItems.isEmpty ? nil : (section, sectionItems)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            listHeader

            ScrollView(showsIndicators: false) {
                GlassEffectContainer(spacing: 12) {
                    VStack(alignment: .leading, spacing: 18) {
                        if store.scope.isShared { sharedBanner }

                        if !demoExcludedHits.isEmpty { demoExclusionNotice }

                        if store.run != nil && items.isEmpty { emptyList }

                        legend

                        if !store.keptRecipes.isEmpty {
                            resetRecipeButton
                        }

                        ForEach(sections, id: \.0) { section, sectionItems in
                            sectionView(section, sectionItems)
                        }

                        if items.contains(where: { !$0.isAddedByHand }) {
                            AIGeneratedNote(text: "Quantities and prices are AI estimates from your recipes — real shelf prices will differ.")
                        }

                        Spacer(minLength: 90)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 10)
            }
        }
        .sheet(item: $parachuteItem) { item in
            ParachuteSheet(store: store, item: item)
        }
        .alert(
            "Can't find \(swapCandidate?.name ?? "it")?",
            isPresented: swapConfirmBinding,
            presenting: swapCandidate
        ) { item in
            Button("Find substitutes") { parachuteItem = item }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("Cherry asks the AI for alternatives and rewrites the affected steps around the one you pick.")
        }
        .sheet(isPresented: $showRecipes) {
            RunRecipesSheet(store: store, dotColors: dotColors)
        }
        .sheet(isPresented: $showAddItem, onDismiss: {
            // Chiuso senza aver messo nulla: la lista vuota non deve
            // restare appesa in home come "Shopping now 0/0".
            guard items.isEmpty else { return }
            if store.discardIfEmpty() { onClose() }
        }) {
            AddItemSheet(store: store)
        }
        .alert(
            "Reset recipe ingredients?",
            isPresented: $showResetIngredients
        ) {
            Button("Reset") {
                Haptics.medium()
                withAnimation(Theme.Motion.signature) {
                    store.resetRecipeIngredients()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Brings back anything the recipes on this list need — like garlic you removed. Things you added yourself stay as they are.")
        }
        .alert(
            store.budgetUsd > 0 ? "Edit budget" : "Set a budget",
            isPresented: $showBudgetEditor
        ) {
            TextField("40", text: $budgetDraft)
                .keyboardType(.decimalPad)
            Button("Save") {
                if let value = Self.parseMoney(budgetDraft) {
                    store.setBudget(value)
                }
            }
            if store.budgetUsd > 0 {
                Button("Clear", role: .destructive) { store.setBudget(0) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("A target for this shop. Item prices add up against it as you check things off.")
        }
        .alert(
            priceItem.map { "Price for \($0.name)" } ?? "Item price",
            isPresented: Binding(
                get: { priceItem != nil },
                set: { if !$0 { priceItem = nil } }
            )
        ) {
            TextField("2.50", text: $priceDraft)
                .keyboardType(.decimalPad)
            Button("Save") {
                if let item = priceItem, let value = Self.parseMoney(priceDraft) {
                    store.setItemPrice(id: item.id, costUsd: value)
                }
                priceItem = nil
            }
            if priceItem?.costUsd ?? 0 > 0 {
                Button("Remove price", role: .destructive) {
                    if let item = priceItem {
                        store.setItemPrice(id: item.id, costUsd: 0)
                    }
                    priceItem = nil
                }
            }
            Button("Cancel", role: .cancel) { priceItem = nil }
        } message: {
            Text("What it costs on the shelf. Leave empty if you don’t know yet.")
        }
        .onChange(of: store.keptRecipes.count) { _, count in
            // Solo se la lista non è mai stata costruita (`nil`).
            // Un array vuoto è una scelta: hai tolto tutto, e il reset
            // esiste apposta per far tornare gli ingredienti delle ricette.
            if store.run?.groceryItems == nil && count > 0 { store.finishRun() }
        }
        .onChange(of: items.isEmpty, initial: true) { _, isEmpty in
            // La lista è appena comparsa: l'app ha mantenuto la
            // promessa per cui è stata scaricata. Tre secondi per
            // guardarla, poi si può chiedere cosa ne pensa.
            guard !isEmpty, !store.isDemo else { return }
            ReviewPrompt.request(.listReady, after: 3)
        }
        .onChange(of: items.map(\.checked)) { _, checks in
            if !checks.isEmpty, checks.allSatisfy({ $0 }), !celebrated {
                celebrated = true
                Haptics.success()
                // Tutto spuntato → la run si archivia da sola (§4.2).
                // La Live Activity segue lo stato della run: si chiude
                // da sé quando finisce in archivio.
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                    store.archive()
                    onClose()
                }
            }
        }
        .onAppear {
            // Run appena chiusa dallo swipe: la lista non è ancora
            // stata costruita (`groceryItems == nil`). Se è `[]` l'hai
            // svuotata tu — non si ricostruisce da sola.
            if store.run?.groceryItems == nil && !store.keptRecipes.isEmpty {
                store.finishRun()
            }
        }
    }

    private var listHeader: some View {
        VStack(spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your list")
                        .font(Theme.display(30))
                        .foregroundStyle(Theme.ink)
                    Text(items.isEmpty
                         ? "Add what you need"
                         : "\(checkedItems.count)/\(items.count) · \(appState.money(spentUsd)) spent")
                        .font(Theme.body(14, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                        .contentTransition(.numericText())
                }
                Spacer(minLength: 8)
                if !items.isEmpty {
                    Button {
                        showAddItem = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.brand)
                            .frame(width: 36, height: 36)
                            .contentShape(.circle)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Add items or recipes")
                }

                if !store.keptRecipes.isEmpty {
                    Button {
                        showRecipes = true
                    } label: {
                        Label("\(store.keptRecipes.count)", systemImage: "book.fill")
                            .font(Theme.body(14, weight: .bold))
                            .foregroundStyle(Theme.brand)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 9)
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .capsule)
                }
            }

            HStack {
                Button {
                    Haptics.light()
                    budgetDraft = store.budgetUsd > 0 ? String(Int(store.budgetUsd.rounded())) : ""
                    showBudgetEditor = true
                } label: {
                    Text(store.budgetUsd > 0 ? "\(appState.money(store.budgetUsd)) budget" : "Set budget")
                        .font(Theme.body(13, weight: .bold))
                        .foregroundStyle(Theme.amber)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Theme.butter, in: .capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(store.budgetUsd > 0 ? "Edit budget" : "Set budget")
                Spacer()
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
    }

    /// Lista condivisa: chi c'è dentro e cosa ha appena preso. Serve a
    /// due cose insieme — sapere che l'altro vede quello che spunto, e
    /// non comprare due volte la stessa cosa.
    private var sharedBanner: some View {
        HStack(spacing: 10) {
            if let partner = appState.spaces.partner {
                AvatarBubble(initials: partner.initials, size: 24)
            } else {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.brand)
            }

            Text(sharedMessage)
                .font(Theme.body(13, weight: .medium))
                .foregroundStyle(Theme.ink)
                .lineLimit(2)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.brand.opacity(0.1), in: .rect(cornerRadius: 18))
        .animation(Theme.Motion.quick, value: sharedMessage)
    }

    private var sharedMessage: String {
        if let actor = store.run?.lastActorName,
           store.run?.lastActorUid != store.scope.uid,
           let item = store.run?.lastItemName {
            return "\(actor) just grabbed \(item)"
        }
        if let partner = appState.spaces.partner {
            return "Shared with \(partner.name) — they see every tick, live"
        }
        return "Shared list"
    }

    /// Solo nel taster dell'onboarding: le ricette sono prefabbricate,
    /// quindi un ingrediente sulla never-list può comunque finire in
    /// lista (senza aglio e cipolla resterebbero 2 ricette). Dirlo qui,
    /// nel punto esatto in cui l'utente lo noterebbe, trasforma il
    /// difetto in un argomento per l'app piena.
    private var demoExcludedHits: [String] {
        guard store.isDemo else { return [] }
        return DemoDeck.excludedHits(in: items, exclusions: appState.tasteProfile.exclusions)
    }

    private var demoExclusionNotice: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.amber)
                .padding(.top, 1)

            Text("You'll spot \(demoExcludedHits.joined(separator: ", ").lowercased()) here — these are sample recipes for the taster. In the full app every menu is generated fresh around your profile, so your no-list never makes it onto your list.")
                .font(Theme.body(13, weight: .medium))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.amber.opacity(0.12), in: .rect(cornerRadius: 18))
    }

    /// Legenda: un colore per ricetta (§4.2), più il badge "Added".
    private var legend: some View {
        let showAdded = items.contains(where: \.isAddedByHand)
        return Group {
            if !store.keptRecipes.isEmpty || showAdded {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(store.keptRecipes) { recipe in
                            if let id = recipe.id {
                                HStack(spacing: 5) {
                                    Circle()
                                        .fill(dotColors[id] ?? Theme.subtle)
                                        .frame(width: 8, height: 8)
                                    Text(recipe.title)
                                        .font(Theme.body(12, weight: .medium))
                                        .foregroundStyle(Theme.subtle)
                                        .lineLimit(1)
                                }
                                .padding(.horizontal, 11)
                                .padding(.vertical, 7)
                                .glassEffect(.regular, in: .capsule)
                            }
                        }
                        if showAdded {
                            HStack(spacing: 5) {
                                Image(systemName: "hand.draw")
                                    .font(.system(size: 10, weight: .bold))
                                Text("Added")
                                    .font(Theme.body(12, weight: .medium))
                            }
                            .foregroundStyle(Theme.amber)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 7)
                            .glassEffect(.regular, in: .capsule)
                        }
                    }
                }
            }
        }
    }

    private var resetRecipeButton: some View {
        Button {
            showResetIngredients = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "arrow.counterclockwise")
                    .font(.system(size: 12, weight: .bold))
                Text("Reset recipe ingredients")
                    .font(Theme.body(13, weight: .semibold))
            }
            .foregroundStyle(Theme.brand)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .accessibilityHint("Restores ingredients required by the recipes. Items you added stay as they are.")
    }

    private var emptyList: some View {
        VStack(spacing: 16) {
            CherrySheetEmpty(
                wash: Theme.mint.opacity(0.45),
                symbol: "basket",
                tint: Theme.brand,
                title: "Nothing here yet",
                subtitle: "Add items by hand, or drop in a saved recipe."
            )
            Button {
                showAddItem = true
            } label: {
                Text("Add to this list")
            }
            .buttonStyle(PrimaryButtonStyle())
        }
    }

    private func sectionView(_ section: StoreSection, _ sectionItems: [GroceryItem]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(section.title, systemImage: section.symbol)
                    .font(Theme.body(14, weight: .bold))
                    .foregroundStyle(Theme.ink)
                Spacer()
                Text("\(sectionItems.count)")
                    .font(Theme.body(12, weight: .bold))
                    .foregroundStyle(Theme.subtle)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Theme.mint.opacity(0.55), in: .capsule)
            }
            .padding(.horizontal, 4)

            ForEach(Array(sectionItems.enumerated()), id: \.element.id) { index, item in
                SwipeToRemoveRow(onRemove: { remove(item) }) {
                    itemRow(item, wash: CherryRowWash.at(index))
                }
                .id(item.id)
                .vegoEntrance(index)
            }
        }
    }

    private func itemRow(_ item: GroceryItem, wash: Color) -> some View {
        HStack(spacing: 14) {
            // Checkbox oversized: type da una mano sola sul carrello.
            Button {
                toggle(item)
            } label: {
                Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 30))
                    .foregroundStyle(item.checked ? Theme.brand : Theme.subtle.opacity(0.4))
                    // Spuntare è la micro-vittoria della spesa: il simbolo
                    // si sostituisce con un rimbalzo invece di cambiare
                    // e basta.
                    .contentTransition(.symbolEffect(.replace.downUp))
                    .scaleEffect(item.checked ? 1.08 : 1)
                    .animation(Theme.Motion.signature, value: item.checked)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(item.name)
                        .font(Theme.body(17, weight: .semibold))
                        .foregroundStyle(item.checked ? Theme.subtle : Theme.ink)
                        .strikethrough(item.checked, color: Theme.subtle)
                    if item.isAddedByHand {
                        Image(systemName: "hand.draw")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.amber)
                    } else {
                        HStack(spacing: 3) {
                            ForEach(item.recipeIds, id: \.self) { recipeId in
                                Circle()
                                    .fill(dotColors[recipeId] ?? Theme.subtle)
                                    .frame(width: 8, height: 8)
                            }
                        }
                    }
                }
                HStack(spacing: 6) {
                    if !item.quantity.isEmpty {
                        Text(item.quantity)
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.subtle)
                    }
                    if let from = item.substitutedFrom {
                        Text("was \(from)")
                            .font(Theme.body(11, weight: .semibold))
                            .foregroundStyle(Theme.amber)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Theme.amber.opacity(0.12)))
                    }
                }
            }

            Spacer()

            Button {
                Haptics.light()
                priceItem = item
                priceDraft = item.costUsd > 0 ? Self.moneyString(item.costUsd) : ""
            } label: {
                if item.costUsd > 0 {
                    Text("\(appState.tasteProfile.moneySymbol)\(Self.moneyString(item.costUsd))")
                        .font(Theme.body(14, weight: .bold))
                        .foregroundStyle(Theme.ink)
                } else {
                    Text("Price")
                        .font(Theme.body(12, weight: .bold))
                        .foregroundStyle(Theme.amber)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Theme.amber.opacity(0.14), in: .capsule)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.costUsd > 0 ? "Edit price" : "Add price")
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .glassEffect(.regular.tint(wash.opacity(0.45)), in: CherryPebbleShape(hero: false))
        .shadow(color: Theme.ink.opacity(0.05), radius: 10, y: 5)
        .opacity(item.checked ? 0.45 : 1)
        .contentShape(Rectangle())
        .onTapGesture {
            // Tap sull'item (non sulla checkbox) = "non lo trovo" → paracadute.
            // Si passa da una conferma: il paracadute interroga l'AI, e
            // una lista si sfiora di continuo con il carrello in mano.
            // Nella prova dell'onboarding non c'è backend da interrogare.
            // Sulla carta igienica l'AI non c'entra: solo spunta.
            guard !item.checked, !store.isDemo, !item.isAddedByHand else { return }
            Haptics.light()
            swapCandidate = item
        }
    }

    private static func parseMoney(_ raw: String) -> Double? {
        let cleaned = raw
            .replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: ".")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { return 0 }
        return Double(cleaned).map { max(0, $0) }
    }

    private static func moneyString(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value)
    }

    private func toggle(_ item: GroceryItem) {
        Haptics.medium()
        var updated = items
        var takenName: String?
        if let index = updated.firstIndex(where: { $0.id == item.id }) {
            updated[index].checked.toggle()
            if updated[index].checked { takenName = updated[index].name }
        }
        withAnimation(Theme.Motion.signature) {
            store.setItems(updated, justChecked: takenName)
        }
    }

    private func remove(_ item: GroceryItem) {
        Haptics.medium()
        withAnimation(Theme.Motion.exit) {
            store.removeItem(item)
        }
    }
}

// MARK: - Swipe per togliere una riga

/// La lista è uno `ScrollView` di card, non una `List`: `swipeActions`
/// non c'è. Soglia a 24pt perché checkbox e tap "non lo trovo" non
/// devono partire per uno sfioramento.
private struct SwipeToRemoveRow<Content: View>: View {
    var onRemove: () -> Void
    @ViewBuilder var content: () -> Content

    @State private var offset: CGFloat = 0
    @State private var axis: Axis?

    private let reveal: CGFloat = 72
    private let commit: CGFloat = 112

    var body: some View {
        ZStack(alignment: .trailing) {
            Button(action: onRemove) {
                Image(systemName: "trash.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: reveal)
                    .frame(maxHeight: .infinity)
            }
            .buttonStyle(.plain)
            .background(Theme.soft_red, in: .rect(cornerRadius: Theme.cornerRadius))
            .opacity(offset < -6 ? min(1, -offset / 24) : 0)
            .accessibilityLabel("Remove from list")

            content()
                .offset(x: offset)
                .overlay {
                    if offset < -6 {
                        Color.clear
                            .contentShape(Rectangle())
                            .onTapGesture {
                                withAnimation(Theme.Motion.signature) { offset = 0 }
                            }
                    }
                }
        }
        .contentShape(Rectangle())
        .simultaneousGesture(drag)
        .accessibilityAction(named: "Remove from list") { onRemove() }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 24, coordinateSpace: .local)
            .onChanged { value in
                let translation = value.translation
                if axis == nil {
                    axis = abs(translation.width) > abs(translation.height) * 1.2
                        ? .horizontal : .vertical
                }
                guard axis == .horizontal else { return }
                offset = min(0, max(translation.width, -reveal * 1.55))
            }
            .onEnded { value in
                let wasHorizontal = axis == .horizontal
                axis = nil
                guard wasHorizontal else {
                    withAnimation(Theme.Motion.quick) { offset = 0 }
                    return
                }
                let predicted = value.predictedEndTranslation.width
                if predicted < -commit || value.translation.width < -commit {
                    onRemove()
                } else if offset < -reveal * 0.45 {
                    withAnimation(Theme.Motion.signature) { offset = -reveal }
                } else {
                    withAnimation(Theme.Motion.signature) { offset = 0 }
                }
            }
    }
}

// MARK: - Ricette della run, un tap di distanza (§4.2)

private struct RunRecipesSheet: View {
    @ObservedObject var store: RunStore
    let dotColors: [String: Color]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(store.keptRecipes) { recipe in
                        NavigationLink {
                            RecipeDetailView(
                                title: recipe.title,
                                imageUrl: recipe.imageUrl,
                                costUsd: recipe.costUsd,
                                cookMinutes: recipe.cookMinutes,
                                servings: recipe.servings,
                                ingredients: recipe.ingredients,
                                steps: recipe.steps,
                                onSave: { store.saveToCollection(recipe) }
                            )
                        } label: {
                            HStack(spacing: 12) {
                                if let id = recipe.id {
                                    Circle()
                                        .fill(dotColors[id] ?? Theme.subtle)
                                        .frame(width: 10, height: 10)
                                }
                                Text(recipe.title)
                                    .font(Theme.body(16, weight: .semibold))
                                    .foregroundStyle(Theme.ink)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Theme.subtle)
                            }
                            .padding(14)
                            .vegoCard()
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(20)
            }
            .background(CherryBackground(mood: .fresh))
            .navigationTitle("Recipes in this list")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
