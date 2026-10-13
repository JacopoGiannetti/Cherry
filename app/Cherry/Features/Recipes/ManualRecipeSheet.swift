import SwiftUI
import PhotosUI
import UIKit
import FirebaseFirestore

// Ricetta scritta a mano: nome, foto, ingredienti, passaggi. Esce da
// qui come una SavedRecipe qualunque, quindi finisce in collezione e
// nelle liste della spesa senza nessun trattamento speciale.
//
// La tastiera guida il flusso: return sul nome → primo ingrediente,
// return sulla quantità → ingrediente nuovo, return su un passaggio →
// passaggio nuovo. Non si deve mai toccare "Add" per andare avanti, e
// "Done" sopra la tastiera (o uno scroll) la chiude.
struct ManualRecipeSheet: View {
    /// Nil: nuova ricetta. Altrimenti si sta modificando dalla Collection.
    var existing: SavedRecipe? = nil

    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    private struct DraftIngredient: Identifiable, Equatable {
        let id = UUID()
        var name = ""
        var quantity = ""

        var isBlank: Bool { name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private struct DraftStep: Identifiable, Equatable {
        let id = UUID()
        var text = ""

        var isBlank: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private enum Field: Hashable {
        case title
        case ingredientName(UUID)
        case ingredientQuantity(UUID)
        case step(UUID)
    }

    @State private var title: String
    @State private var photo: UIImage?
    @State private var existingImageUrl: String?
    @State private var photoDirty = false
    @State private var libraryItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var showLibrary = false
    @State private var showPhotoOptions = false
    @State private var ingredients: [DraftIngredient]
    @State private var steps: [DraftStep]
    @State private var saving = false
    @FocusState private var focus: Field?

    init(existing: SavedRecipe? = nil) {
        self.existing = existing
        _title = State(initialValue: existing?.title ?? "")
        _existingImageUrl = State(initialValue: existing?.imageUrl)
        if let existing {
            let lines = existing.ingredients.map {
                DraftIngredient(name: $0.name, quantity: $0.quantity)
            }
            _ingredients = State(initialValue: lines.isEmpty ? [DraftIngredient()] : lines)
            let stepLines = existing.steps.map { DraftStep(text: $0) }
            _steps = State(initialValue: stepLines.isEmpty ? [DraftStep()] : stepLines)
        } else {
            _ingredients = State(initialValue: [DraftIngredient()])
            _steps = State(initialValue: [DraftStep()])
        }
    }

    private static let accent = Color(hex: 0xBF6B36)

    private var cleanTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool {
        !cleanTitle.isEmpty && ingredients.contains { !$0.isBlank }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                CherryBackground(mood: .warm)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 22) {
                        CherrySheetHeader(
                            title: existing == nil ? "Write a recipe" : "Edit recipe",
                            subtitle: "Name, photo, ingredients, steps"
                        )
                        photoWell
                        titleField
                        ingredientsSection
                        stepsSection
                        Spacer(minLength: 40)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .font(Theme.body(16))
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        save()
                    } label: {
                        Text(saving ? "Saving…" : "Save")
                            .font(Theme.body(15, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .frame(height: 34)
                            .background(
                                canSave ? AnyShapeStyle(Theme.brandGradient) : AnyShapeStyle(Theme.subtle.opacity(0.35)),
                                in: .capsule
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSave || saving)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focus = nil }
                        .font(Theme.body(15, weight: .bold))
                        .foregroundStyle(Theme.brand)
                }
            }
            .confirmationDialog("Recipe photo", isPresented: $showPhotoOptions, titleVisibility: .hidden) {
                if CameraPicker.isAvailable {
                    Button("Take a photo") { showCamera = true }
                }
                Button("Choose from library") { showLibrary = true }
                if photo != nil || existingImageUrl != nil {
                    Button("Remove photo", role: .destructive) {
                        photo = nil
                        existingImageUrl = nil
                        photoDirty = true
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
            .photosPicker(isPresented: $showLibrary, selection: $libraryItem, matching: .images)
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image in
                    photo = image
                    photoDirty = true
                    Haptics.medium()
                }
                .ignoresSafeArea()
            }
            .onChange(of: libraryItem) { _, item in loadFromLibrary(item) }
            .task {
                guard photo == nil, let existingImageUrl else { return }
                photo = await ImageCache.loadAny(existingImageUrl)
            }
            // Niente tastiera automatica: si apre quando tocchi il campo.
        }
        .interactiveDismissDisabled(saving)
    }

    // MARK: - Foto

    private var photoWell: some View {
        Button {
            Haptics.light()
            focus = nil
            showPhotoOptions = true
        } label: {
            ZStack {
                if let photo {
                    Image(uiImage: photo)
                        .resizable()
                        .scaledToFill()
                } else {
                    LinearGradient(
                        colors: [Theme.peach.opacity(0.85), Theme.butter.opacity(0.9)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                    VStack(spacing: 10) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(Self.accent)
                            .frame(width: 52, height: 52)
                            .background(.white.opacity(0.9), in: .circle)
                        VStack(spacing: 3) {
                            Text("Add a photo")
                                .font(Theme.title(17))
                                .foregroundStyle(Theme.ink)
                            Text("Camera or library")
                                .font(Theme.body(12))
                                .foregroundStyle(Theme.subtle)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 220)
            .clipShape(RoundedRectangle(cornerRadius: Theme.pebbleRadius, style: .continuous))
            .overlay(alignment: .bottomTrailing) {
                if photo != nil {
                    HStack(spacing: 5) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 11, weight: .bold))
                        Text("Change")
                            .font(Theme.body(12, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.45), in: .capsule)
                    .padding(12)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func loadFromLibrary(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self),
               let image = UIImage(data: data) {
                photo = image
                photoDirty = true
                Haptics.medium()
            }
            libraryItem = nil
        }
    }

    // MARK: - Nome

    /// Il nome è il titolo della pagina, non un campo in una casella.
    private var titleField: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Name your recipe", text: $title)
                .font(Theme.title(26))
                .foregroundStyle(Theme.ink)
                .textInputAutocapitalization(.sentences)
                .submitLabel(.next)
                .focused($focus, equals: .title)
                .onSubmit {
                    if let first = ingredients.first {
                        focus = .ingredientName(first.id)
                    }
                }
            Rectangle()
                .fill(focus == .title ? Theme.brand : Theme.ink.opacity(0.12))
                .frame(height: 1.5)
                .animation(Theme.Motion.quick, value: focus)
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Ingredienti

    private var ingredientsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("INGREDIENTS", count: ingredients.filter { !$0.isBlank }.count)

            VStack(spacing: 0) {
                ForEach($ingredients) { $line in
                    ingredientRow($line)
                    Divider().padding(.leading, 16)
                }

                addRow("Add ingredient") {
                    appendIngredient(focusing: true)
                }
            }
            .background(Theme.peach.opacity(0.42), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .animation(Theme.Motion.signature, value: ingredients.map(\.id))
        }
    }

    private func ingredientRow(_ line: Binding<DraftIngredient>) -> some View {
        let id = line.wrappedValue.id
        return HStack(spacing: 10) {
            TextField("Cherry tomatoes", text: line.name)
                .font(Theme.body(15, weight: .medium))
                .foregroundStyle(Theme.ink)
                .textInputAutocapitalization(.sentences)
                .submitLabel(.next)
                .focused($focus, equals: .ingredientName(id))
                .onSubmit { focus = .ingredientQuantity(id) }

            TextField("300 g", text: line.quantity)
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.trailing)
                .submitLabel(.next)
                .frame(width: 80)
                .focused($focus, equals: .ingredientQuantity(id))
                .onSubmit { advanceIngredient(after: id) }

            clearButton(visible: !line.wrappedValue.isBlank || !line.wrappedValue.quantity.isEmpty) {
                removeIngredient(id)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
    }

    /// Return sulla quantità: si passa alla riga dopo; se non c'è, se
    /// ne apre una nuova. Su una riga vuota, invece, si chiude tutto.
    private func advanceIngredient(after id: UUID) {
        guard let index = ingredients.firstIndex(where: { $0.id == id }) else { return }
        if ingredients[index].isBlank {
            focus = nil
            return
        }
        if index + 1 < ingredients.count {
            focus = .ingredientName(ingredients[index + 1].id)
        } else {
            appendIngredient(focusing: true)
        }
    }

    private func appendIngredient(focusing: Bool) {
        let line = DraftIngredient()
        withAnimation(Theme.Motion.signature) { ingredients.append(line) }
        if focusing {
            DispatchQueue.main.async { focus = .ingredientName(line.id) }
        }
    }

    private func removeIngredient(_ id: UUID) {
        Haptics.light()
        withAnimation(Theme.Motion.signature) {
            ingredients.removeAll { $0.id == id }
            if ingredients.isEmpty { ingredients = [DraftIngredient()] }
        }
    }

    // MARK: - Passaggi

    private var stepsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("STEPS", count: steps.filter { !$0.isBlank }.count)

            VStack(spacing: 0) {
                ForEach(Array($steps.enumerated()), id: \.element.id) { index, $step in
                    stepRow($step, number: index + 1)
                    Divider().padding(.leading, 16)
                }

                addRow("Add step") {
                    appendStep(focusing: true)
                }
            }
            .background(Theme.butter.opacity(0.55), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .animation(Theme.Motion.signature, value: steps.map(\.id))
        }
    }

    private func stepRow(_ step: Binding<DraftStep>, number: Int) -> some View {
        let id = step.wrappedValue.id
        return HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(Theme.body(13, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Circle().fill(Theme.brand))
                .padding(.top, 1)

            // Campo multilinea: il return inserisce "\n", e lo si
            // intercetta per passare al passaggio successivo.
            TextField("Boil the pasta…", text: step.text, axis: .vertical)
                .font(Theme.body(15))
                .foregroundStyle(Theme.ink)
                .textInputAutocapitalization(.sentences)
                .lineLimit(1...8)
                .focused($focus, equals: .step(id))
                .onChange(of: step.wrappedValue.text) { _, text in
                    guard text.contains("\n") else { return }
                    splitStep(id, text: text)
                }

            clearButton(visible: !step.wrappedValue.isBlank) {
                removeStep(id)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
    }

    /// Return in un passaggio: il testo resta, il cursore scende al
    /// passaggio dopo (nuovo se serve). Se il testo incollato aveva più
    /// righe, ogni riga diventa un passaggio. Return su riga vuota:
    /// hai finito, la tastiera si chiude.
    private func splitStep(_ id: UUID, text: String) {
        guard let index = steps.firstIndex(where: { $0.id == id }) else { return }
        let parts = text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
        let kept = parts.filter { !$0.isEmpty }

        if kept.isEmpty {
            steps[index].text = ""
            focus = nil
            return
        }

        steps[index].text = kept[0]
        var lastId = id
        var extra: [DraftStep] = []
        for part in kept.dropFirst() {
            var step = DraftStep()
            step.text = part
            extra.append(step)
            lastId = step.id
        }

        withAnimation(Theme.Motion.signature) {
            steps.insert(contentsOf: extra, at: index + 1)
        }

        // Dopo l'ultimo pezzo si scende al passaggio seguente; se non
        // esiste ancora, se ne apre uno vuoto.
        guard let lastIndex = steps.firstIndex(where: { $0.id == lastId }) else { return }
        if lastIndex + 1 < steps.count {
            DispatchQueue.main.async { focus = .step(steps[lastIndex + 1].id) }
        } else {
            appendStep(focusing: true)
        }
    }

    private func appendStep(focusing: Bool) {
        let step = DraftStep()
        withAnimation(Theme.Motion.signature) { steps.append(step) }
        if focusing {
            DispatchQueue.main.async { focus = .step(step.id) }
        }
    }

    private func removeStep(_ id: UUID) {
        Haptics.light()
        withAnimation(Theme.Motion.signature) {
            steps.removeAll { $0.id == id }
            if steps.isEmpty { steps = [DraftStep()] }
        }
    }

    // MARK: - Pezzi comuni

    private func sectionHeader(_ text: String, count: Int) -> some View {
        HStack {
            Text(text.capitalized)
                .font(Theme.title(20))
                .foregroundStyle(Theme.ink)
            Spacer()
            if count > 0 {
                Text("\(count)")
                    .font(Theme.body(12, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Theme.mint.opacity(0.7), in: .capsule)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(.horizontal, 4)
        .animation(Theme.Motion.quick, value: count)
    }

    private func addRow(_ label: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 18))
                Text(label)
                    .font(Theme.body(15, weight: .semibold))
                Spacer()
            }
            .foregroundStyle(Theme.brand)
            .padding(.horizontal, 16)
            .padding(.vertical, 13)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    /// La "x" compare solo quando la riga ha qualcosa da cancellare:
    /// una riga vuota non ha bisogno di un tasto in più.
    private func clearButton(visible: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 16))
                .foregroundStyle(Theme.subtle.opacity(0.45))
                .frame(width: 24, height: 24)
        }
        .buttonStyle(.plain)
        .opacity(visible ? 1 : 0)
        .disabled(!visible)
        .animation(Theme.Motion.quick, value: visible)
    }

    // MARK: - Salvataggio

    private func save() {
        guard canSave, !saving else { return }
        Haptics.medium()
        focus = nil
        saving = true

        let payloadIngredients = ingredients
            .filter { !$0.isBlank }
            .map { line -> [String: Any] in
                let name = line.name.trimmingCharacters(in: .whitespacesAndNewlines)
                return [
                    "name": name,
                    "quantity": line.quantity.trimmingCharacters(in: .whitespacesAndNewlines),
                    // Indovinato dal nome: senza reparto la spesa
                    // ammucchierebbe tutto sotto "Other".
                    "storeSection": AisleGuess.section(for: name).rawValue,
                    "costUsd": 0,
                ]
            }

        let payloadSteps = steps
            .map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        Task {
            var payload: [String: Any] = [
                "title": cleanTitle,
                "ingredients": payloadIngredients,
                "steps": payloadSteps,
            ]

            if let existing {
                payload["oneLiner"] = existing.oneLiner ?? ""
                payload["cuisine"] = existing.cuisine ?? ""
                payload["costUsd"] = existing.costUsd
                payload["cookMinutes"] = existing.cookMinutes
                payload["servings"] = existing.servings
                payload["origin"] = existing.origin ?? "manual"
                if let sourceUrl = existing.sourceUrl { payload["sourceUrl"] = sourceUrl }
                if existing.preset == true { payload["preset"] = true }
            } else {
                payload["oneLiner"] = ""
                payload["cuisine"] = ""
                payload["costUsd"] = 0
                payload["cookMinutes"] = 0
                payload["servings"] = 2
                payload["origin"] = "manual"
            }

            let replacingPhoto = photoDirty || existing == nil
            if replacingPhoto, let photo {
                if let ref = await persistPhoto(photo) {
                    payload["imageUrl"] = ref
                }
            } else if replacingPhoto, existing != nil {
                payload["imageUrl"] = FieldValue.delete()
            }

            FirestoreService.saveRecipe(uid: appState.uid, recipeId: existing?.id, payload)
            appState.jobs.ping(existing == nil ? "recipe.manual" : "recipe.edit")
            Haptics.success()
            saving = false
            dismiss()
        }
    }

    /// Carica su Storage e tiene una copia in cache: anche se il
    /// download remoto fallisce, la Collection mostra comunque la foto.
    private func persistPhoto(_ photo: UIImage) async -> String? {
        do {
            let path = try await StorageUploader.uploadJPEG(photo, uid: appState.uid, prefix: "recipe")
            ImageCache.store(photo, forKey: path)
            if let url = try? await StorageUploader.downloadURL(for: path) {
                ImageCache.store(photo, for: url)
                return url.absoluteString
            }
            return path
        } catch {
            print("[Recipe] photo upload failed: \(error.localizedDescription)")
            let local = "local://\(UUID().uuidString)"
            ImageCache.store(photo, forKey: local)
            return local
        }
    }
}

/// Reparto dedotto dal nome dell'ingrediente. Non deve azzeccarli
/// tutti: basta che al supermercato la lista resti divisa per corsie
/// invece di finire tutta in "Other".
enum AisleGuess {
    private static let rules: [(StoreSection, [String])] = [
        (.frozen, ["frozen", "ice cream"]),
        (.bakery, ["bread", "bun", "pita", "tortilla", "baguette", "breadcrumb", "brioche", "focaccia"]),
        (.nutsSeeds, ["nut", "cashew", "almond", "pistachio", "walnut", "sesame", "seed", "tahini", "pine kernel"]),
        (.dairyAlternatives, ["milk", "yogurt", "yoghurt", "cheese", "butter", "cream", "mayo", "mayonnaise"]),
        (.proteins, ["tofu", "tempeh", "seitan", "protein"]),
        (.cannedJarred, ["can ", "canned", "tin ", "jar", "beans", "chickpea", "lentil", "olives", "stock", "broth", "passata", "coconut milk", "jackfruit"]),
        (.spicesCondiments, ["oil", "vinegar", "salt", "black pepper", "soy sauce", "paprika", "cumin", "oregano", "cinnamon", "chili", "chilli", "curry", "syrup", "mustard", "spice", "sugar", "nutritional yeast", "sauce", "miso", "stock cube"]),
        (.grainsPasta, ["pasta", "rice", "noodle", "spaghetti", "penne", "rigatoni", "macaroni", "orzo", "lasagna", "flour", "oats", "quinoa", "couscous", "polenta", "barley"]),
        (.produce, ["tomato", "onion", "garlic", "lemon", "lime", "potato", "carrot", "pepper", "spinach", "kale", "lettuce", "cucumber", "zucchini", "courgette", "eggplant", "aubergine", "mushroom", "basil", "parsley", "cilantro", "coriander", "ginger", "apple", "banana", "avocado", "broccoli", "cauliflower", "cabbage", "celery", "scallion", "leek", "herb", "salad", "squash", "corn", "pea", "berry", "orange", "mint", "rosemary", "thyme", "bok choy", "sprout"]),
    ]

    static func section(for name: String) -> StoreSection {
        let needle = name.lowercased()
        for (section, keywords) in rules where keywords.contains(where: needle.contains) {
            return section
        }
        return .other
    }
}
