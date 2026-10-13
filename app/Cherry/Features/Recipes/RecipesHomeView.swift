import SwiftUI
import FirebaseFirestore

// Tab Recipes (§6). Sopra: la pipeline d'ingresso (lo Swap engine),
// primo elemento dello schermo, mai un "+" nell'angolo. Sotto due
// porte: scrivere una ricetta a mano, o aprire la collezione (che si
// cerca, invece di stare tutta spalmata qui sotto).
struct RecipesHomeView: View {
    @EnvironmentObject private var appState: AppState

    @State private var saved: [SavedRecipe] = []
    @State private var listener: ListenerRegistration?

    @State private var activeSwap: SwapStore?
    @State private var showLinkSheet = false
    @State private var showManualEditor = false
    @State private var showCollection = false

    var body: some View {
        NavigationStack {
            ZStack {
                CherryBackground(mood: .warm)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 12) {
                        Color.clear.frame(height: TabScreenHeader.headlineHeight)

                        entryPipeline
                            .homeTourAnchor(.recipesImport)

                        inboxSection

                        libraryCards

                        Spacer(minLength: 120)
                    }
                    .padding(.horizontal, 20)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .onDisappear {
            // La tab resta montata dietro Grocery, quindi qui si passa
            // solo quando la main view sparisce (logout, reset): il
            // listener non deve sopravvivere alla pagina.
            listener?.remove()
            listener = nil
        }
        .onAppear {
            listen()
            consumePendingSwapURL()
        }
        .onChange(of: appState.pendingSwapURL) { _, _ in
            consumePendingSwapURL()
        }
        .sheet(isPresented: $showLinkSheet) {
            LinkImportSheet { url in startSwap(source: ["type": "link", "url": url]) }
        }
        .sheet(isPresented: $showManualEditor) {
            ManualRecipeSheet()
        }
        .sheet(isPresented: $showCollection) {
            SavedRecipesSheet(
                recipes: saved,
                onDelete: deleteRecipe,
                onVeganize: { url in
                    // Lo swap è a schermo pieno: prima si chiude la
                    // collezione, altrimenti resta sotto e non parte.
                    showCollection = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                        startSwap(source: ["type": "link", "url": url])
                    }
                }
            )
        }
        .fullScreenCover(item: $activeSwap) { store in
            SwapView(store: store)
        }
    }

    private func deleteRecipe(_ recipe: SavedRecipe) {
        guard let id = recipe.id else { return }
        Haptics.medium()
        Task {
            do {
                try await FirestoreService.deleteSavedRecipe(uid: appState.uid, recipeId: id)
            } catch {
                // Un errore muto qui si legge come "non si può cancellare".
                print("[Recipes] delete \(id) failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Deep link dalla share extension (in QUALSIASI momento)

    private func consumePendingSwapURL() {
        guard let url = appState.pendingSwapURL, appState.phase == .main else { return }
        appState.pendingSwapURL = nil
        startSwap(source: ["type": "link", "url": url])
    }

    private func startSwap(source: [String: Any]) {
        // Per i link lo swapId deriva dall'URL: se il backend ha già
        // elaborato quel link (prewarm in background o un tentativo
        // precedente) ci si riaggancia al documento esistente e il
        // ledger compare subito, invece di ripartire da zero.
        let store: SwapStore
        if let url = source["url"] as? String {
            store = SwapStore(uid: appState.uid, jobs: appState.jobs, swapId: SharedInboxStore.swapId(for: url))
        } else {
            store = SwapStore(uid: appState.uid, jobs: appState.jobs)
        }
        activeSwap = store
        Task { await store.startImport(source: source) }
    }

    // MARK: - Pipeline d'ingresso

    private var entryPipeline: some View {
        Button {
            Haptics.light()
            showLinkSheet = true
        } label: {
            // La sera al fuoco, telefono in mano: è quando le ricette
            // si salvano. La scena notturna fa da hero, non si ripete.
            // Il pastello è il fondo stesso dell'illustrazione: così la
            // sua forma a goccia vive dentro la card, non ci sbatte.
            CherryIllustratedCard(
                wash: Color(hex: 0xF4F3DF),
                image: "IllustrationNightCamp",
                height: 212,
                imageAlignment: .center,
                fadeEnd: 0.72
            ) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 6) {
                        Image(systemName: "link")
                            .font(.system(size: 10, weight: .bold))
                        Text("Paste or share")
                            .font(.system(size: 11, weight: .heavy, design: .rounded))
                    }
                    .foregroundStyle(Theme.brand)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .glassEffect(.regular.tint(.white.opacity(0.35)), in: .capsule)

                    Spacer(minLength: 4)

                    Text("Add any recipe")
                        .font(Theme.display(26))
                        .foregroundStyle(Theme.ink)
                    Text("Paste a link, or Share from\nTikTok and Instagram.")
                        .font(Theme.body(13, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: 8) {
                        pathChip(symbol: "bookmark.fill", text: "Just save")
                        if appState.tasteProfile.dietaryIdentity == .vegan {
                            pathChip(symbol: "leaf.fill", text: "Or veganize")
                        } else {
                            pathChip(symbol: "wand.and.stars", text: "Or make it yours")
                        }
                    }
                    .padding(.top, 2)
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

    private func pathChip(symbol: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .bold))
            Text(text)
                .font(Theme.body(12, weight: .semibold))
        }
        .foregroundStyle(Theme.brand)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .glassEffect(.regular.tint(.white.opacity(0.35)), in: .capsule)
    }

    // MARK: - Inbox dei link condivisi

    @ViewBuilder
    private var inboxSection: some View {
        if !appState.sharedInbox.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Waiting")
                        .font(Theme.body(12, weight: .bold))
                        .foregroundStyle(Theme.subtle)
                    Spacer()
                    Text(appState.sharedInbox.count == 1 ? "1 link" : "\(appState.sharedInbox.count) links")
                        .font(Theme.body(11, weight: .bold))
                        .foregroundStyle(Theme.amber)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Theme.butter.opacity(0.8), in: .capsule)
                }

                ForEach(appState.sharedInbox.reversed(), id: \.self) { url in
                    inboxRow(url)
                }
            }
            .onAppear { appState.syncInboxPreviews() }
            .onChange(of: appState.sharedInbox.count) { _, _ in
                appState.syncInboxPreviews()
            }
        }
    }

    private func inboxRow(_ url: String) -> some View {
        let preview = appState.sharedInboxStore.previews[url]
        let recipeReady = appState.sharedInboxStore.isSwapReady(for: url)

        return HStack(spacing: 12) {
            inboxThumb(url: url, preview: preview)

            VStack(alignment: .leading, spacing: 3) {
                Text(preview?.title ?? sourceName(for: url))
                    .font(Theme.body(14, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)

                // La riga dice cosa è successo davvero dietro le quinte:
                // ricetta già estratta → si apre al volo; altrimenti si
                // sta ancora lavorando o c'è solo l'anteprima del link.
                if recipeReady {
                    Label("Recipe ready", systemImage: "checkmark.circle.fill")
                        .font(Theme.body(11, weight: .semibold))
                        .foregroundStyle(Theme.brand)
                } else if appState.sharedInboxStore.isSwapInProgress(for: url) {
                    // Solo se il lavoro è davvero vivo: uno swap in
                    // stallo o fallito torna alla riga normale, dove
                    // Veganize fa ripartire tutto da capo.
                    Text("Reading the recipe…")
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.subtle)
                } else if preview?.isLoading == true {
                    Text("Fetching preview…")
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.subtle)
                } else {
                    Text(sourceName(for: url))
                        .font(Theme.body(11))
                        .foregroundStyle(Theme.subtle)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            Button {
                Haptics.light()
                appState.discardInboxItem(url)
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.soft_red.opacity(0.85))
                    .frame(width: 34, height: 34)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Discard")

            Button {
                Haptics.medium()
                appState.jobs.ping("inbox.open")
                startSwap(source: ["type": "link", "url": url])
            } label: {
                Text(recipeReady || appState.tasteProfile.dietaryIdentity != .vegan ? "Open" : "Veganize")
                    .font(Theme.body(13, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .glassEffect(.regular.tint(Theme.brand.opacity(0.92)), in: .capsule)
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .glassEffect(.regular.tint(Theme.butter.opacity(0.45)), in: CherryPebbleShape(hero: false))
    }

    @ViewBuilder
    private func inboxThumb(url: String, preview: InboxPreview?) -> some View {
        let side: CGFloat = 52
        if let thumb = preview?.thumbnail, let imageURL = URL(string: thumb) {
            CachedImage(url: imageURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                inboxThumbPlaceholder(preview: preview, side: side)
            }
            .frame(width: side, height: side)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        } else {
            inboxThumbPlaceholder(preview: preview, side: side)
        }
    }

    private func inboxThumbPlaceholder(preview: InboxPreview?, side: CGFloat) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.peach.opacity(0.7))
                .frame(width: side, height: side)
            if preview?.isLoading == true {
                ProgressView().controlSize(.small).tint(Theme.amber)
            } else {
                Image(systemName: "play.rectangle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.amber)
            }
        }
    }

    private func sourceName(for url: String) -> String {
        let host = URL(string: url)?.host?.lowercased() ?? ""
        if host.contains("tiktok") { return "From TikTok" }
        if host.contains("instagram") { return "From Instagram" }
        if host.contains("youtu") { return "From YouTube" }
        if host.contains("pinterest") { return "From Pinterest" }
        return host.isEmpty ? "Shared link" : "From \(host.replacingOccurrences(of: "www.", with: ""))"
    }

    // MARK: - Le due porte della collezione

    /// La griglia non sta più aperta qui sotto: due card a tutta
    /// larghezza, una sopra l'altra, nello stesso linguaggio della
    /// card "My Lists" della home Grocery (vetro tinto pastello, titolo
    /// a sinistra, un piccolo pezzo di illustrazione a destra).
    private var libraryCards: some View {
        VStack(spacing: 12) {
            writeRecipeCard
                .homeTourAnchor(.recipesWrite)
            collectionCard
                .homeTourAnchor(.recipesCollection)
        }
        .padding(.top, 4)
    }

    /// Pesca: caldo, da cucina, si stacca dal verde menta della card
    /// d'ingresso senza litigarci.
    private static let peachInk = Color(hex: 0xBF6B36)
    /// Lavanda: la collezione è il posto "calmo" della pagina.
    private static let lavenderInk = Color(hex: 0x6C5FA8)

    private var writeRecipeCard: some View {
        Button {
            Haptics.light()
            showManualEditor = true
        } label: {
            // Le lucine tra gli alberi, ritaglio alto: la stessa sera
            // della collezione vista dall'alto, senza ripeterne le persone.
            // Il fondo bianco dell'immagine si fonde nel pesca.
            CherryIllustratedCard(
                wash: Theme.peach,
                image: "IllustrationLightsCamp",
                height: 150,
                imageAlignment: .top,
                blendsWhite: true,
                fadeEnd: 0.7
            ) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Write a recipe")
                        .font(Theme.display(22))
                        .foregroundStyle(Theme.ink)
                    Text("Your own dish, your words.")
                        .font(Theme.body(13, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    cardGoChip(title: "Start writing", tint: Self.peachInk)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 20)
            }
            .contentShape(CherryPebbleShape())
        }
        .buttonStyle(CherryCardButtonStyle())
    }

    private var collectionCard: some View {
        Button {
            Haptics.light()
            showCollection = true
        } label: {
            // Il cuore alzato davanti alla tenda: le ricette che ami,
            // tenute al sicuro.
            CherryIllustratedCard(
                wash: Theme.lavender,
                image: "IllustrationHeartCamp",
                height: 150,
                imageAlignment: .center,
                mirrored: true,
                fadeEnd: 0.66
            ) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("My collection")
                        .font(Theme.display(22))
                        .foregroundStyle(Theme.ink)
                    Text(saved.isEmpty
                         ? "Nothing saved yet."
                         : (saved.count == 1 ? "1 recipe saved" : "\(saved.count) recipes saved"))
                        .font(Theme.body(13, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                    Spacer(minLength: 0)
                    cardGoChip(title: "Browse & search", tint: Self.lavenderInk)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 20)
            }
            .contentShape(CherryPebbleShape())
        }
        .buttonStyle(CherryCardButtonStyle())
    }

    /// Azione della card come chip di vetro: si legge anche sopra
    /// l'illustrazione, non si perde nel pastello.
    private func cardGoChip(title: String, tint: Color) -> some View {
        HStack(spacing: 5) {
            Text(title)
            Image(systemName: "arrow.right")
        }
        .font(Theme.body(13, weight: .bold))
        .foregroundStyle(tint)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .glassEffect(.regular.tint(.white.opacity(0.35)), in: .capsule)
    }

    private func listen() {
        guard listener == nil else { return }
        listener = FirestoreService.listenCollection(
            FirestoreService.savedRecipesQuery(uid: appState.uid),
            as: SavedRecipe.self
        ) { saved = $0 }
    }
}

// MARK: - Sheet di import

private struct LinkImportSheet: View {
    let onSubmit: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""

    var body: some View {
        VStack(spacing: 18) {
            Text("Paste the link")
                .font(Theme.display(24))
                .foregroundStyle(Theme.ink)
                .padding(.top, 30)

            Text("TikTok, Instagram, or any recipe site.\nWe'll pull it in — save it as it is, or make it yours.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            HStack {
                TextField("https://…", text: $link)
                    .font(Theme.body(15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Button {
                    if let pasted = UIPasteboard.general.string { link = pasted }
                } label: {
                    Image(systemName: "doc.on.clipboard")
                        .foregroundStyle(Theme.brand)
                }
            }
            .padding(14)
            .glassEffect(.regular, in: .rect(cornerRadius: 18))
            .padding(.horizontal, 24)

            Button("Import recipe") {
                let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                dismiss()
                onSubmit(trimmed)
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.horizontal, 24)

            Spacer()
        }
        .presentationDetents([.height(360)])
        .presentationCornerRadius(32)
        .background(CherryBackground(mood: .fresh))
    }
}

