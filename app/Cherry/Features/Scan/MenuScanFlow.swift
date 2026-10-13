import SwiftUI
import PhotosUI
import FirebaseFirestore

// Menu scan (§5.1): multi-foto per menu multi-pagina, output = la
// risposta a "cosa ordino?", non un menu decorato. Solo buone notizie.
struct MenuScanFlow: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var photos: [UIImage] = []
    @State private var showCamera = false
    @State private var libraryItem: PhotosPickerItem?
    @State private var analyzing = false
    @State private var scanId: String?
    @State private var scan: Scan?
    @State private var listener: ListenerRegistration?
    @State private var errorMessage: String?

    /// Menu già letti in passato: restano su Firestore, prima non
    /// c'era modo di ritrovarli.
    @State private var pastScans: [Scan] = []
    @State private var historyListener: ListenerRegistration?
    @State private var viewingHistory = false
    @State private var scanToDelete: Scan?

    var body: some View {
        ZStack(alignment: .top) {
            CherryBackground(mood: .calm)

            // Il risultato scorre sotto l'header, che lo dissolve col
            // suo velo: senza sovrapposizione la foto si tagliava di
            // netto contro il bordo bianco della barra.
            Group {
                if let scan, scan.status == "done" {
                    MenuResultView(
                        scan: scan,
                        photos: photos,
                        topInset: FeatureFlowHeader<EmptyView, EmptyView>.reservedHeight
                    )
                } else if analyzing {
                    analyzingState
                } else {
                    VStack(spacing: 0) {
                        Color.clear.frame(height: FeatureFlowHeader<EmptyView, EmptyView>.reservedHeight)
                        captureState
                    }
                }
            }
            // L'header galleggia sopra: senza un frame pieno il
            // contenuto si stringe sul proprio ingombro e si incolla
            // in cima (il loader finiva sotto il logo invece che al
            // centro, e il risultato usciva dallo schermo).
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if !analyzing {
                FeatureFlowHeader {
                    if viewingHistory {
                        Button {
                            Haptics.light()
                            scan = nil
                            viewingHistory = false
                        } label: {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Theme.brand)
                        }
                    } else {
                        EmptyView()
                    }
                } trailing: {
                    HStack(spacing: 12) {
                        if scan?.status == "done" {
                            Button {
                                Haptics.light()
                                scanToDelete = scan
                            } label: {
                                Image(systemName: "trash")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.soft_red)
                            }
                        }
                        FeatureFlowCloseButton { dismiss() }
                    }
                }
                .featureFlowHeaderVeil()
            } else {
                CherryWordmark(height: CherryWordmarkSize.header)
                    .padding(.top, 8)
                    .padding(.bottom, 6)
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                photos.append(image)
                Haptics.medium()
            }
            .ignoresSafeArea()
        }
        .onChange(of: libraryItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    await MainActor.run {
                        photos.append(image)
                        libraryItem = nil
                        Haptics.medium()
                    }
                }
            }
        }
        .onAppear(perform: listenHistory)
        .onDisappear {
            listener?.remove()
            historyListener?.remove()
        }
        .alert(
            "Delete this menu?",
            isPresented: Binding(
                get: { scanToDelete != nil },
                set: { if !$0 { scanToDelete = nil } }
            )
        ) {
            Button("Delete", role: .destructive) {
                if let scan = scanToDelete { deleteSavedMenu(scan) }
                scanToDelete = nil
            }
            Button("Cancel", role: .cancel) { scanToDelete = nil }
        } message: {
            Text("The photos and dishes from this scan will be removed.")
        }
    }

    private func listenHistory() {
        guard historyListener == nil else { return }
        historyListener = FirestoreService.listenCollection(
            FirestoreService.scansQuery(uid: appState.uid, type: "menu"),
            as: Scan.self
        ) { scans in
            pastScans = scans.filter { $0.status == "done" }
        }
    }

    // MARK: - Cattura

    private var captureState: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 8)

            if photos.isEmpty {
                menuHero
                    .padding(.horizontal, 24)
                    .vegoEntrance(0)
            } else {
                capturedPages
                    .vegoEntrance(0)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.soft_red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 30)
                    .padding(.top, 12)
            }

            Spacer(minLength: 12)

            if photos.isEmpty && !pastScans.isEmpty {
                menuHistory
                    .padding(.bottom, 16)
            }

            captureActions
                .padding(.bottom, 24)
        }
    }

    private var menuHero: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .strokeBorder(Theme.lavender.opacity(0.45), lineWidth: 1)
                    .frame(width: 148, height: 148)
                Circle()
                    .strokeBorder(Theme.sky.opacity(0.4), lineWidth: 1)
                    .frame(width: 124, height: 124)
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [Theme.lavender, Theme.sky],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 96, height: 96)
                    Image(systemName: "menucard.fill")
                        .font(.system(size: 36, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                }
                .glassEffect(.regular.tint(Theme.lavender.opacity(0.35)), in: .circle)
            }

            VStack(spacing: 8) {
                Text("Snap the menu")
                    .font(Theme.display(30))
                    .foregroundStyle(Theme.brandGradient)
                Text("We'll tell you what to order. Several pages? Photograph each one.")
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.subtle)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 8) {
                heroChip(symbol: "fork.knife", text: "What fits you")
                heroChip(symbol: "text.bubble.fill", text: "What to ask")
            }
        }
        .padding(.vertical, 10)
    }

    private func heroChip(symbol: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .bold))
            Text(text)
                .font(Theme.body(12, weight: .semibold))
        }
        .foregroundStyle(Theme.brand)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .glassEffect(.regular, in: .capsule)
    }

    private var capturedPages: some View {
        VStack(spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(Array(photos.enumerated()), id: \.offset) { index, photo in
                        Image(uiImage: photo)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 124, height: 168)
                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .strokeBorder(.white.opacity(0.35), lineWidth: 1)
                            }
                            .overlay(alignment: .topTrailing) {
                                Button {
                                    photos.remove(at: index)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(.white)
                                        .frame(width: 24, height: 24)
                                        .background(.black.opacity(0.45), in: .circle)
                                        .padding(8)
                                }
                            }
                            .overlay(alignment: .bottomLeading) {
                                Text("\(index + 1)")
                                    .font(Theme.body(11, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(.black.opacity(0.4), in: .capsule)
                                    .padding(8)
                            }
                    }
                }
                .padding(.horizontal, 24)
            }

            Text(photos.count == 1 ? "1 page ready" : "\(photos.count) pages ready")
                .font(Theme.body(13, weight: .semibold))
                .foregroundStyle(Theme.subtle)
        }
    }

    private var captureActions: some View {
        VStack(spacing: 10) {
            GlassEffectContainer(spacing: 14) {
                HStack(spacing: 10) {
                    if CameraPicker.isAvailable {
                        Button {
                            Haptics.light()
                            showCamera = true
                        } label: {
                            Label(photos.isEmpty ? "Take photo" : "Add page", systemImage: "camera.fill")
                                .font(Theme.body(16, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.vertical, 16)
                                .frame(maxWidth: .infinity)
                                .contentShape(.capsule)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(.regular.tint(Theme.brand.opacity(0.9)).interactive(), in: .capsule)
                    }
                    PhotosPicker(selection: $libraryItem, matching: .images) {
                        Label("Library", systemImage: "photo.on.rectangle")
                            .font(Theme.body(16, weight: .semibold))
                            .foregroundStyle(Theme.brand)
                            .padding(.vertical, 16)
                            .frame(maxWidth: .infinity)
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .capsule)
                }
            }
            .padding(.horizontal, 20)

            if !photos.isEmpty {
                Button("What do I order?") { analyze() }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.horizontal, 20)
            }
        }
    }

    /// I menu già letti: tornarci sopra costa meno che rifotografarli.
    private var menuHistory: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("MENUS YOU'VE SCANNED")
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(Theme.subtle)
                    .tracking(1.2)
                Spacer()
                Text(pastScans.count == 1 ? "1 saved" : "\(pastScans.count) saved")
                    .font(Theme.body(11, weight: .semibold))
                    .foregroundStyle(Theme.subtle)
            }
            .padding(.horizontal, 24)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(pastScans.enumerated()), id: \.offset) { index, past in
                        pastMenuCard(past, index: index)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    private func pastMenuCard(_ past: Scan, index: Int) -> some View {
        ZStack(alignment: .topTrailing) {
            Button {
                Haptics.light()
                photos = []
                scan = past
                viewingHistory = true
            } label: {
                VStack(alignment: .leading, spacing: 10) {
                    Image(systemName: "menucard.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .frame(width: 32, height: 32)
                        .background(Theme.lavender.opacity(0.7), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

                    VStack(alignment: .leading, spacing: 3) {
                        Text(past.restaurantName?.isEmpty == false ? past.restaurantName! : "Menu")
                            .font(Theme.body(15, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text(historySubtitle(past))
                            .font(Theme.body(11))
                            .foregroundStyle(Theme.subtle)
                            .lineLimit(1)
                    }
                }
                .padding(14)
                .padding(.trailing, 22)
                .frame(width: 196, alignment: .leading)
                .contentShape(.rect(cornerRadius: 20))
            }
            .buttonStyle(.plain)

            Button {
                Haptics.light()
                scanToDelete = past
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.soft_red.opacity(0.85))
                    .frame(width: 28, height: 28)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .padding(8)
        }
        .glassEffect(.regular.tint(Theme.lavender.opacity(0.18)), in: .rect(cornerRadius: 20))
        .contextMenu {
            Button(role: .destructive) {
                scanToDelete = past
            } label: {
                Label("Delete menu", systemImage: "trash")
            }
        }
        .vegoEntrance(index + 1)
    }

    private func historySubtitle(_ past: Scan) -> String {
        let count = (past.bestBets?.count ?? 0) + (past.askForThese?.count ?? 0)
        let dishes = count == 1 ? "1 dish" : "\(count) dishes"
        guard let date = past.createdAt else { return dishes }
        return "\(date.formatted(date: .abbreviated, time: .omitted)) · \(dishes)"
    }

    private func deleteSavedMenu(_ scan: Scan) {
        guard let id = scan.id else { return }
        Haptics.medium()
        let paths = scan.storagePaths ?? []

        // Sparisce subito dalla lista: aspettare il giro di Firestore
        // faceva sembrare che il cestino non funzionasse.
        withAnimation(.snappy(duration: 0.25)) {
            pastScans.removeAll { $0.id == id }
        }
        if self.scan?.id == id {
            self.scan = nil
            viewingHistory = false
            photos = []
        }

        Task {
            do {
                try await FirestoreService.deleteScan(uid: appState.uid, scanId: id)
                for path in paths {
                    await StorageUploader.delete(path)
                }
            } catch {
                // Non è sparito davvero: il listener lo rimetterà in
                // lista, quindi va detto invece di lasciarlo riapparire
                // senza spiegazione.
                errorMessage = "Couldn't delete that menu. Try again."
            }
        }
    }

    private var analyzingState: some View {
        CherryLoadingScreen(
            animation: .cookingRelax,
            title: "Reading the menu…",
            subtitle: "Finding everything you can eat"
        )
    }

    // MARK: - Analisi (upload su Storage → job → listener Firestore)

    private func analyze() {
        Haptics.medium()
        analyzing = true
        errorMessage = nil
        let id = UUID().uuidString
        scanId = id

        Task {
            do {
                var paths: [String] = []
                for photo in photos {
                    paths.append(try await StorageUploader.uploadJPEG(photo, uid: appState.uid, prefix: "menu"))
                }
                try await appState.jobs.start("/scan/menu", body: [
                    "scanId": id,
                    "storagePaths": paths,
                ])
                await MainActor.run { listenScan(id) }
            } catch {
                await MainActor.run {
                    analyzing = false
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func listenScan(_ id: String) {
        listener = FirestoreService.listenDocument("users/\(appState.uid)/scans/\(id)", as: Scan.self) { result in
            guard let result else { return }
            scan = result
            if result.status == "done" {
                Haptics.success()
                analyzing = false
            }
        }
        // Timeout gentile: se dopo 90s non è arrivato nulla, messaggio chiaro.
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) {
            if analyzing {
                analyzing = false
                errorMessage = "Taking too long — check your connection and try again."
            }
        }
    }
}

// MARK: - Risultato: la foto del menu come scena, la risposta sopra

/// Come rileggere la lista: il buco vuoto è "quel che ti piace",
/// l'ordine di gusto deciso dallo scan.
enum MenuLens: String, CaseIterable, Identifiable {
    case vegan, light, protein, lowCarb
    var id: String { rawValue }

    var word: String {
        switch self {
        case .vegan: "vegan"
        case .light: "light"
        case .protein: "high-protein"
        case .lowCarb: "low-carb"
        }
    }

    var magnet: WordMagnet {
        switch self {
        case .vegan: WordMagnet(id: rawValue, word: word, wash: Color(hex: 0xD3EEDC), ink: Color(hex: 0x2E8B57))
        case .light: WordMagnet(id: rawValue, word: word, wash: Theme.sky, ink: Color(hex: 0x3B78A3))
        case .protein: WordMagnet(id: rawValue, word: word, wash: Theme.peach, ink: Color(hex: 0xBF6B36))
        case .lowCarb: WordMagnet(id: rawValue, word: word, wash: Theme.lavender, ink: Color(hex: 0x6C5FA8))
        }
    }

    var note: String {
        switch self {
        case .vegan: "Only what's vegan, or one request away."
        case .light: "Lightest first. Calories are estimates for a restaurant portion."
        case .protein: "Most protein first, estimated per portion."
        case .lowCarb: "Fewest carbs first, estimated per portion."
        }
    }

    /// La cifra che giustifica l'ordine, sulla card.
    func metric(_ dish: MenuDish) -> String? {
        switch self {
        case .vegan: nil
        case .light: dish.kcal.map { "≈ \(Int($0)) kcal" }
        case .protein: dish.proteinG.map { "≈ \(Int($0)) g protein" }
        case .lowCarb: dish.carbsG.map { "≈ \(Int($0)) g carbs" }
        }
    }

    /// Più piccolo = più in alto. Chi non ha la stima va in fondo.
    private func key(_ dish: MenuDish) -> Double {
        switch self {
        case .vegan: 0
        case .light: dish.kcal ?? .infinity
        case .protein: -(dish.proteinG ?? -.infinity)
        case .lowCarb: dish.carbsG ?? .infinity
        }
    }

    /// Le due liste dello scan, rilette. A parità resta l'ordine di gusto.
    func apply(bestBets: [MenuDish], askForThese: [MenuDish]) -> (asIs: [MenuDish], ask: [MenuDish]) {
        switch self {
        case .vegan:
            let asIs = bestBets.filter { $0.vegan == "yes" }
            let ask = askForThese.filter { $0.vegan == "yes" }
                + bestBets.compactMap { dish -> MenuDish? in
                    guard dish.vegan == "ask", let phrase = dish.veganPhrase, !phrase.isEmpty else { return nil }
                    var asked = dish
                    asked.waiterPhrase = phrase
                    return asked
                }
            return (asIs, ask)
        default:
            func sorted(_ dishes: [MenuDish]) -> [MenuDish] {
                dishes.enumerated()
                    .sorted { (key($0.element), $0.offset) < (key($1.element), $1.offset) }
                    .map(\.element)
            }
            return (sorted(bestBets), sorted(askForThese))
        }
    }

    static func available(in dishes: [MenuDish], diet: DietaryIdentity) -> [MenuLens] {
        let hasEstimates = dishes.contains { $0.kcal != nil }
        let knowsVegan = diet != .vegan && dishes.contains { $0.vegan != nil }
        return allCases.filter { $0 == .vegan ? knowsVegan : hasEstimates }
    }
}

/// La schermata è la risposta a "cosa ordino?". Tre piani: la foto
/// del menu a tutto schermo in alto (il contesto, si scorre e si
/// allunga), una card-verdetto che ci si appoggia sopra con la
/// mascotte (il titolo della risposta), e sotto i piatti in ordine,
/// numerati come una classifica. Verde = si ordina così com'è,
/// ambra = con una frase da dire al cameriere.
struct MenuResultView: View {
    let scan: Scan
    let photos: [UIImage]
    /// Altezza dell'header sovrapposto. La foto gli passa sotto: serve
    /// solo a decidere quanto deve essere alta perché ne resti a vista
    /// abbastanza.
    var topInset: CGFloat = 0

    @State private var gallery: [UIImage] = []
    @State private var galleryLoaded = false
    @State private var page = 0
    @State private var showGallery = false
    @State private var anchoredDish: MenuDish?
    @State private var lensChoice: String?

    @EnvironmentObject private var appState: AppState

    /// Inchiostro dell'ambra sui pastelli chiari.
    private static let amberInk = Color(hex: 0xB07A1F)
    /// Di quanto la card-verdetto sale sopra il bordo della foto.
    private static let verdictOverlap: CGFloat = 38

    private var restaurant: String {
        let name = scan.restaurantName?.trimmingCharacters(in: .whitespaces) ?? ""
        return name.isEmpty ? "This menu" : name
    }

    private var lenses: [MenuLens] {
        MenuLens.available(in: (scan.bestBets ?? []) + (scan.askForThese ?? []), diet: appState.tasteProfile.dietaryIdentity)
    }
    private var lens: MenuLens? { lensChoice.flatMap(MenuLens.init(rawValue:)) }

    private var lensed: (asIs: [MenuDish], ask: [MenuDish]) {
        let asIs = scan.bestBets ?? [], ask = scan.askForThese ?? []
        return lens?.apply(bestBets: asIs, askForThese: ask) ?? (asIs, ask)
    }
    private var bestBets: [MenuDish] { lensed.asIs }
    private var askForThese: [MenuDish] { lensed.ask }
    private var orderCount: Int { bestBets.count + askForThese.count }
    private var hasPhotos: Bool { !gallery.isEmpty || !galleryLoaded }

    var body: some View {
        GeometryReader { root in
            // Foto: metà schermo scarsa, più quel che sta sotto header
            // e status bar. Senza foto (scan vecchi senza file) resta
            // un pastello basso col nome sopra.
            let heroHeight = hasPhotos
                ? root.safeAreaInsets.top + topInset + max(220, root.size.height * 0.30)
                : root.safeAreaInsets.top + topInset + 96

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    hero(height: heroHeight)

                    VStack(alignment: .leading, spacing: 22) {
                        verdictCard
                            .padding(.top, -Self.verdictOverlap)
                            .vegoEntrance(0)

                        if !lenses.isEmpty {
                            lensSentence
                                .vegoEntrance(1)
                        }

                        dishes
                            .animation(Theme.Motion.signature, value: lensChoice)

                        AIGeneratedNote(text: "Menu read and dishes picked by AI. Confirm ingredients and allergens with the restaurant before ordering.")
                            .padding(.top, 4)
                        Spacer(minLength: 30)
                    }
                    .padding(.horizontal, 20)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .ignoresSafeArea(edges: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: scan.id) { await loadGallery() }        .fullScreenCover(isPresented: $showGallery) {
            MenuPhotoPager(photos: gallery, startIndex: page)
        }
        .fullScreenCover(item: $anchoredDish) { dish in
            MenuAnchorView(dish: dish, photos: gallery)
        }
    }

    // MARK: Hero — la foto a tutto schermo, che si allunga tirando giù

    private var heroShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            bottomLeadingRadius: 40,
            bottomTrailingRadius: 40,
            style: .continuous
        )
    }

    private func hero(height: CGFloat) -> some View {
        GeometryReader { geo in
            // Tirando verso il basso la foto cresce invece di lasciare
            // vuoto sopra: il bordo inferiore resta dov'è.
            let pull = max(0, geo.frame(in: .scrollView).minY)

            ZStack(alignment: .bottom) {
                photoStack
                    .frame(width: geo.size.width, height: height + pull)
                    .clipped()

                // Il testo si legge sul terzo basso, foto o non foto.
                LinearGradient(
                    stops: [
                        .init(color: .black.opacity(0), location: 0.35),
                        .init(color: .black.opacity(0.18), location: 0.6),
                        .init(color: .black.opacity(0.62), location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: height + pull)
                .opacity(gallery.isEmpty ? 0 : 1)

                heroCaption
                    .padding(.horizontal, 22)
                    .padding(.bottom, Self.verdictOverlap + 22)
            }
            .frame(width: geo.size.width, height: height + pull)
            .clipShape(heroShape)
            .contentShape(heroShape)
            .offset(y: -pull)
            .onTapGesture {
                guard !gallery.isEmpty else { return }
                Haptics.light()
                showGallery = true
            }
        }
        .frame(height: height)
    }

    /// Nome del posto e, accanto, condividi e schermo intero. Sopra il
    /// nome, la chip con le pagine: sostituisce i pallini del pager.
    private var heroCaption: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "menucard.fill")
                        .font(.system(size: 9, weight: .bold))
                    Text(gallery.count > 1 ? "PAGE \(page + 1) OF \(gallery.count)" : "MENU SCAN")
                        .font(.system(size: 10, weight: .heavy, design: .rounded))
                        .tracking(1)
                        .contentTransition(.numericText())
                }
                .foregroundStyle(gallery.isEmpty ? Theme.ink : .white)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(.ultraThinMaterial, in: .capsule)
                .background((gallery.isEmpty ? Theme.lavender : Theme.ink).opacity(0.3), in: .capsule)
                .overlay(Capsule().stroke(.white.opacity(0.3), lineWidth: 1))

                Text(restaurant)
                    .font(Theme.display(28))
                    .foregroundStyle(gallery.isEmpty ? Theme.ink : .white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .shadow(color: .black.opacity(gallery.isEmpty ? 0 : 0.25), radius: 8, y: 2)
            }

            Spacer(minLength: 0)

            if let photo = gallery[safe: page] {
                HStack(spacing: 8) {
                    ShareLink(
                        item: Image(uiImage: photo),
                        preview: SharePreview(restaurant, image: Image(uiImage: photo))
                    ) {
                        heroOrb("square.and.arrow.up")
                    }
                    .buttonStyle(.plain)

                    Button {
                        Haptics.light()
                        showGallery = true
                    } label: {
                        heroOrb("arrow.up.left.and.arrow.down.right")
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // Vetrini sopra la foto: material, non glassEffect (che non
    // campiona dentro un contenitore clippato).
    private func heroOrb(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 38, height: 38)
            .background(.ultraThinMaterial, in: .circle)
            .background(Theme.ink.opacity(0.25), in: .circle)
            .overlay(Circle().stroke(.white.opacity(0.35), lineWidth: 1))
            .contentShape(.circle)
    }

    @ViewBuilder
    private var photoStack: some View {
        if gallery.isEmpty && !galleryLoaded {
            ZStack {
                Theme.lavender.opacity(0.6)
                ProgressView().tint(Color(hex: 0x6C5FA8))
            }
        } else if gallery.isEmpty {
            LinearGradient(
                colors: [Theme.lavender, Theme.sky.opacity(0.8)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        } else if gallery.count == 1 {
            pagePhoto(gallery[0])
        } else {
            TabView(selection: $page.animation(Theme.Motion.signature)) {
                ForEach(Array(gallery.enumerated()), id: \.offset) { index, photo in
                    pagePhoto(photo).tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
    }

    /// La foto riempie il riquadro senza dettarne la larghezza: da sola
    /// `scaledToFill` prende la larghezza naturale dello scatto (spesso
    /// più larga dello schermo) e allargava l'intera pagina.
    private func pagePhoto(_ photo: UIImage) -> some View {
        Color.clear
            .overlay {
                Image(uiImage: photo)
                    .resizable()
                    .scaledToFill()
            }
            .clipped()
    }

    // MARK: Verdetto — la risposta in una riga, con la mascotte

    private var verdictHeadline: String {
        if orderCount == 0 { return "Slim pickings" }
        if bestBets.isEmpty { return "Doable, with a word" }
        return orderCount == 1 ? "One dish for you" : "\(orderCount) dishes for you"
    }

    private var verdictDetail: String {
        if orderCount == 0 {
            return "Nothing fits as-is. Kitchens often adapt — it's worth asking."
        }
        var parts: [String] = []
        if !bestBets.isEmpty {
            parts.append(bestBets.count == 1 ? "1 ready as it is" : "\(bestBets.count) ready as they are")
        }
        if !askForThese.isEmpty {
            parts.append(askForThese.count == 1 ? "1 with a quick ask" : "\(askForThese.count) with a quick ask")
        }
        return parts.joined(separator: " · ")
    }

    private var verdictCard: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("WHAT TO ORDER")
                    .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                    .tracking(1.2)
                    .foregroundStyle(Theme.brand)
                Text(verdictHeadline)
                    .font(Theme.display(26))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text(verdictDetail)
                    .font(Theme.body(13, weight: .medium))
                    .foregroundStyle(Theme.subtle)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 4)

            CherryMascotView(size: 78, pose: bestBets.isEmpty ? .listen : .cheer)
                .padding(.top, 6)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(Theme.mint.opacity(0.6)), in: CherryPebbleShape(hero: false))
        .shadow(color: Theme.ink.opacity(0.12), radius: 20, y: 10)
    }

    // MARK: Frase — come rileggere la lista

    private var lensSentence: some View {
        VStack(alignment: .leading, spacing: 12) {
            MagnetSentence(
                lead: "Something",
                magnets: lenses.map(\.magnet),
                selection: $lensChoice,
                compact: true,
                emptyWord: "I'll love"
            )

            Text(lens?.note ?? "Ranked by your taste.")
                .font(Theme.body(13, weight: .medium))
                .foregroundStyle(lens?.magnet.ink ?? Theme.subtle)
                .fixedSize(horizontal: false, vertical: true)
                .contentTransition(.opacity)
                .animation(Theme.Motion.signature, value: lensChoice)
        }
        .padding(.horizontal, 2)
        .padding(.top, 4)
    }

    // MARK: Piatti — due sezioni, piatti numerati

    @ViewBuilder
    private var dishes: some View {
        if !bestBets.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                sectionHeader(
                    symbol: "checkmark.seal.fill",
                    color: Theme.fit,
                    ink: Theme.fit,
                    title: "Order as is",
                    subtitle: lens == .vegan ? "Vegan as written." : "Already right for you — no changes needed.",
                    count: bestBets.count
                )
                ForEach(Array(bestBets.enumerated()), id: \.element.id) { index, dish in
                    dishCard(dish, rank: index + 1, isBestBet: true)
                        .vegoEntrance(index + 1)
                }
            }
        }

        if !askForThese.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                sectionHeader(
                    symbol: "bubble.left.fill",
                    color: Theme.amber,
                    ink: Self.amberInk,
                    title: "Ask for a tweak",
                    subtitle: lens == .vegan ? "One small request and it's vegan." : "One small request and it's yours.",
                    count: askForThese.count
                )
                ForEach(Array(askForThese.enumerated()), id: \.element.id) { index, dish in
                    dishCard(dish, rank: index + 1, isBestBet: false)
                        .vegoEntrance(bestBets.count + index + 1)
                }
            }
        }

        if orderCount == 0 {
            emptyDishes
                .vegoEntrance(1)
        }
    }

    private func sectionHeader(
        symbol: String,
        color: Color,
        ink: Color,
        title: String,
        subtitle: String,
        count: Int
    ) -> some View {
        HStack(spacing: 11) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(color, in: .circle)

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(Theme.title(19))
                    .foregroundStyle(Theme.ink)
                Text(subtitle)
                    .font(Theme.body(12.5))
                    .foregroundStyle(Theme.subtle)
            }

            Spacer(minLength: 8)

            Text("\(count)")
                .font(Theme.body(12, weight: .bold))
                .foregroundStyle(ink)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(color.opacity(0.14), in: .capsule)
        }
        .padding(.leading, 2)
    }

    private func dishCard(_ dish: MenuDish, rank: Int, isBestBet: Bool) -> some View {
        let accent = isBestBet ? Theme.fit : Theme.amber
        let ink = isBestBet ? Theme.fit : Self.amberInk
        let canAnchor = dish.photoIndex < gallery.count

        return Button {
            Haptics.light()
            if canAnchor { anchoredDish = dish }
        } label: {
            HStack(alignment: .top, spacing: 14) {
                // Il numero è la classifica: il primo è il piatto da
                // prendere se non si vuole leggere oltre.
                Text("\(rank)")
                    .font(Theme.display(17))
                    .foregroundStyle(ink)
                    .frame(width: 36, height: 36)
                    .background(.white.opacity(0.75), in: .circle)
                    .overlay(Circle().stroke(accent.opacity(0.35), lineWidth: 1.5))

                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(dish.dishName)
                            .font(Theme.body(17, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        if let price = dish.priceText, !price.isEmpty {
                            Text(price)
                                .font(Theme.body(15, weight: .bold))
                                .foregroundStyle(ink)
                        }
                    }

                    if let lens, let metric = lens.metric(dish) {
                        Text(metric)
                            .font(Theme.body(12.5, weight: .bold))
                            .foregroundStyle(lens.magnet.ink)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(lens.magnet.wash, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .leading)))
                    }

                    if isBestBet, let description = dish.description, !description.isEmpty {
                        Text(description)
                            .font(Theme.body(13.5))
                            .foregroundStyle(Theme.subtle)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if !isBestBet, let phrase = dish.waiterPhrase, !phrase.isEmpty {
                        waiterLine(phrase)
                    }

                    if canAnchor {
                        HStack(spacing: 5) {
                            Image(systemName: "viewfinder")
                                .font(.system(size: 10, weight: .bold))
                            Text("Show me on the menu")
                        }
                        .font(Theme.body(12, weight: .bold))
                        .foregroundStyle(ink)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 7)
                        .glassEffect(.regular.tint(.white.opacity(0.4)), in: .capsule)
                        .padding(.top, 2)
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(CherryPebbleShape(hero: false))
            .glassEffect(
                .regular.tint(isBestBet ? Theme.fitWash.opacity(0.5) : Theme.butter.opacity(0.55)),
                in: CherryPebbleShape(hero: false)
            )
        }
        .buttonStyle(CherryCardButtonStyle())
    }

    /// La frase da dire, in un fumetto: si legge come parlato, non come
    /// una nota a margine.
    private func waiterLine(_ phrase: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("SAY THIS")
                .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                .tracking(1.1)
                .foregroundStyle(Self.amberInk)
            MascotBubble(style: .speech, tail: .bottomLeading, tint: .white) {
                Text("“\(phrase)”")
                    .font(Theme.body(14, weight: .medium))
                    .italic()
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.bottom, 6)
        }
        .padding(.top, 2)
    }

    private var emptyDishes: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What you can still do")
                .font(Theme.title(19))
                .foregroundStyle(Theme.ink)
            ForEach([
                lens == .vegan || appState.tasteProfile.dietaryIdentity.isPlantBased
                    ? ("hand.raised.fill", "Ask if a dish can be made without dairy or meat — most kitchens will.")
                    : ("hand.raised.fill", "Ask the kitchen what they can leave out — most will."),
                ("leaf.fill", "Sides and starters are often the safest bets: bread, salads, grilled veg."),
                ("camera.fill", "Missed a page? Scan the whole menu, specials included."),
            ], id: \.1) { symbol, tip in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: symbol)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color(hex: 0x6C5FA8))
                        .frame(width: 28, height: 28)
                        .background(Theme.lavender.opacity(0.7), in: .circle)
                    Text(tip)
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(Theme.lavender.opacity(0.4)), in: CherryPebbleShape(hero: false))
    }

    private func loadGallery() async {
        galleryLoaded = false
        if !photos.isEmpty {
            gallery = photos
            galleryLoaded = true
            return
        }
        guard let paths = scan.storagePaths, !paths.isEmpty else {
            gallery = []
            galleryLoaded = true
            return
        }
        var loaded: [UIImage] = []
        loaded.reserveCapacity(paths.count)
        for path in paths {
            if let image = await StorageUploader.download(path) {
                loaded.append(image)
            }
        }
        gallery = loaded
        galleryLoaded = true
    }
}

// MARK: - Pager a schermo intero delle pagine del menu

private struct MenuPhotoPager: View {
    let photos: [UIImage]
    let startIndex: Int

    @Environment(\.dismiss) private var dismiss
    @State private var page: Int = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TabView(selection: $page) {
                ForEach(Array(photos.enumerated()), id: \.offset) { index, photo in
                    Image(uiImage: photo)
                        .resizable()
                        .scaledToFit()
                        .tag(index)
                        .padding(.horizontal, 8)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: photos.count > 1 ? .always : .never))

            VStack {
                HStack {
                    if photos.count > 1 {
                        Text("\(page + 1)/\(photos.count)")
                            .font(Theme.body(13, weight: .bold))
                            .foregroundStyle(.white.opacity(0.85))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.white.opacity(0.15), in: .capsule)
                    }
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 32))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
                .padding(20)
                Spacer()
            }
        }
        .onAppear { page = min(startIndex, max(0, photos.count - 1)) }
        .onTapGesture { dismiss() }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

// MARK: - Anchoring sul menu fisico (§5.1): piatto evidenziato,
// tutto il resto oscurato — il contesto spaziale resta.

struct MenuAnchorView: View {
    let dish: MenuDish
    let photos: [UIImage]

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if dish.photoIndex < photos.count {
                GeometryReader { geo in
                    let image = photos[dish.photoIndex]
                    let fit = fittedRect(image: image.size, in: geo.size)

                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(width: geo.size.width, height: geo.size.height)
                        .overlay {
                            if let box = dish.box {
                                let highlight = CGRect(
                                    x: fit.minX + box.x * fit.width,
                                    y: fit.minY + box.y * fit.height,
                                    width: box.w * fit.width,
                                    height: box.h * fit.height
                                ).insetBy(dx: -8, dy: -8)

                                // Tutto oscurato tranne il piatto
                                Rectangle()
                                    .fill(.black.opacity(0.65))
                                    .reverseMask {
                                        RoundedRectangle(cornerRadius: 10)
                                            .frame(width: highlight.width, height: highlight.height)
                                            .position(x: highlight.midX, y: highlight.midY)
                                    }
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(Theme.amber, lineWidth: 3)
                                    .frame(width: highlight.width, height: highlight.height)
                                    .position(x: highlight.midX, y: highlight.midY)
                            }
                        }
                }
            }

            VStack {
                HStack {
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 32))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                    .padding(20)
                }
                Spacer()
                Text(dish.dishName)
                    .font(Theme.title(20))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(.black.opacity(0.6)))
                    .padding(.bottom, 40)
            }
        }
        .onTapGesture { dismiss() }
    }

    private func fittedRect(image: CGSize, in container: CGSize) -> CGRect {
        guard image.width > 0, image.height > 0 else { return .zero }
        let scale = min(container.width / image.width, container.height / image.height)
        let size = CGSize(width: image.width * scale, height: image.height * scale)
        return CGRect(
            x: (container.width - size.width) / 2,
            y: (container.height - size.height) / 2,
            width: size.width,
            height: size.height
        )
    }
}

extension View {
    /// Maschera inversa: buca la vista con la forma passata.
    func reverseMask<Mask: View>(@ViewBuilder _ mask: () -> Mask) -> some View {
        self.mask {
            Rectangle()
                .overlay(mask().blendMode(.destinationOut))
                .compositingGroup()
        }
    }
}
