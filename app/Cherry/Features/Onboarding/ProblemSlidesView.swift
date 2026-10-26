import SwiftUI

// Beat "pairs" — quattro coppie problema → soluzione, dopo le domande.
// Il problema è un'illustrazione (stesso personaggio in quattro posti:
// corsia, ristorante, divano, etichetta) con i suoi pensieri che
// affiorano sopra la testa; la soluzione è un iPhone finto dentro cui
// GIRA la funzione che lo risolve, con gli stessi componenti dell'app.
// L'ordine lo decidono i blockers appena scelti: il primo problema che
// l'utente vede è quello che ha appena detto di avere.

/// I quattro posti in cui il plant-based si inceppa.
enum ProblemTopic: String, CaseIterable, Identifiable {
    case grocery, menu, recipe, barcode

    var id: String { rawValue }

    /// I blockers che portano questo problema in testa.
    var blockers: Set<OnboardingBlocker> {
        switch self {
        case .grocery: [.inspiration, .effort, .grocery]
        case .menu: [.eatingOut]
        case .recipe: [.recipes, .swaps]
        case .barcode: [.labels]
        }
    }

    /// Sempre prima le ricette dai social, la funzione di punta; poi i
    /// problemi che l'utente ha dichiarato, nell'ordine in cui li ha
    /// toccati; poi gli altri nell'ordine di default.
    static func ordered(for blockers: [OnboardingBlocker]) -> [ProblemTopic] {
        var result: [ProblemTopic] = [.recipe]
        for blocker in blockers {
            for topic in allCases where topic.blockers.contains(blocker) && !result.contains(topic) {
                result.append(topic)
            }
        }
        for topic in allCases where !result.contains(topic) {
            result.append(topic)
        }
        return result
    }

    // MARK: Problema

    var imageName: String { "onb_problem_\(rawValue)" }

    /// Il crema esatto dello sfondo di ogni illustrazione: la pagina
    /// lo riprende e l'immagine non ha più un bordo.
    var pageColor: Color {
        switch self {
        case .grocery, .recipe: Color(hex: 0xF9E9CE)
        case .menu: Color(hex: 0xF9E7C9)
        case .barcode: Color(hex: 0xF7E6CA)
        }
    }

    /// Dove sta la faccia, in coordinate 0…1 dell'illustrazione: da lì
    /// parte la rivelazione e attorno a lì respira l'immagine.
    var face: UnitPoint {
        switch self {
        case .grocery: UnitPoint(x: 0.49, y: 0.38)
        case .menu: UnitPoint(x: 0.50, y: 0.42)
        case .recipe: UnitPoint(x: 0.45, y: 0.43)
        case .barcode: UnitPoint(x: 0.50, y: 0.38)
        }
    }

    var quote: String {
        switch self {
        case .grocery: "“What do I\neven buy?”"
        case .menu: "“What can I even\norder here?”"
        case .recipe: "“Saved it.\nNever cooked it.”"
        case .barcode: "“What's actually\nin this?”"
        }
    }

    var line: String {
        switch self {
        case .grocery: "Standing in the aisle with an empty basket, and nothing on the shelves turns into dinner."
        case .menu: "Everyone's already chosen. You're reading the menu for the third time, pretending to hesitate."
        case .recipe: "You saved the video. Tonight you're scrolling back and forth to catch the steps."
        case .barcode: "Tiny print, strange codes. Ten minutes per box, and you're still not sure."
        }
    }

    /// I pensieri che affiorano nel vuoto sopra la testa. `struck`:
    /// la parola viene barrata appena compare (è un no).
    struct Thought {
        let text: String
        let x: CGFloat
        let y: CGFloat
        let tilt: Double
        var struck = false
    }

    var thoughts: [Thought] {
        switch self {
        case .grocery: [
            Thought(text: "chicken?", x: 0.18, y: 0.12, tilt: -8),
            Thought(text: "pasta… again?", x: 0.76, y: 0.09, tilt: 5),
            Thought(text: "what was that recipe??", x: 0.78, y: 0.22, tilt: 7),
            Thought(text: "and then what?", x: 0.20, y: 0.24, tilt: -4),
        ]
        case .menu: [
            Thought(text: "Fried calamari", x: 0.20, y: 0.11, tilt: -6, struck: true),
            Thought(text: "Double burger", x: 0.76, y: 0.14, tilt: 5, struck: true),
            Thought(text: "Four cheese", x: 0.22, y: 0.22, tilt: -3, struck: true),
            Thought(text: "…side salad?", x: 0.78, y: 0.27, tilt: 4),
        ]
        case .recipe: [
            Thought(text: "wait, how much pasta?", x: 0.70, y: 0.09, tilt: 4),
            Thought(text: "what did she add?", x: 0.22, y: 0.14, tilt: -7),
            Thought(text: "rewind…", x: 0.78, y: 0.21, tilt: 6),
            Thought(text: "where was that video?", x: 0.72, y: 0.33, tilt: -3),
        ]
        case .barcode: [
            Thought(text: "E120?", x: 0.18, y: 0.11, tilt: -8),
            Thought(text: "palm oil…", x: 0.76, y: 0.09, tilt: 6),
            Thought(text: "how much sugar?", x: 0.19, y: 0.21, tilt: -4),
            Thought(text: "“natural flavors”??", x: 0.76, y: 0.19, tilt: 5),
        ]
        }
    }

    // MARK: Soluzione

    var solutionTitle: String {
        switch self {
        case .grocery: "Swipe recipes.\nGet one grocery list."
        case .menu: "Snap the menu.\nSort it your way."
        case .recipe: "Share it from TikTok.\nCook it step by step."
        case .barcode: "Scan the barcode.\nSee what's inside."
        }
    }

    var solutionText: String {
        switch self {
        case .grocery: "Swipe recipes you like. Cherry turns them into one grocery list, priced to your budget."
        case .menu: "Snap any menu. Then tap vegan, high-protein, light or low-carb and every dish gets re-sorted for you."
        case .recipe: "Share any recipe video to Cherry. It saves the recipe and splits the video into steps you can follow while you cook."
        case .barcode: "Cherry reads the ingredients and the nutrition label, and checks them against what you told us you avoid."
        }
    }

    /// Una riga in più, dove serve dire come è fatto il prodotto.
    var solutionNote: String? {
        switch self {
        case .grocery: "Real recipes from every cuisine. AI only adapts them to you and finds the swaps."
        default: nil
        }
    }
}

// MARK: - Il pager delle coppie

struct ProblemSlidesView: View {
    let blockers: [OnboardingBlocker]
    let onDone: () -> Void

    @EnvironmentObject private var appState: AppState
    @State private var page = Shot.pairPage ?? 0 // SHOT

    private var topics: [ProblemTopic] { ProblemTopic.ordered(for: blockers) }
    private var pageCount: Int { topics.count * 2 }
    private var isProblem: Bool { page.isMultiple(of: 2) }
    private var pairIndex: Int { page / 2 }
    private var topic: ProblemTopic { topics[min(pairIndex, topics.count - 1)] }

    var body: some View {
        ZStack {
            // Sulle slide problema la pagina prende il crema
            // dell'illustrazione; sulle soluzioni torna lo sfondo
            // del flusso.
            topic.pageColor
                .opacity(isProblem ? 1 : 0)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Group {
                    if isProblem {
                        ProblemStorySlide(topic: topic, number: pairIndex + 1, total: topics.count)
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing).combined(with: .opacity),
                                removal: .scale(scale: 1.06).combined(with: .opacity)
                            ))
                    } else {
                        SolutionSlide(topic: topic)
                            .transition(.asymmetric(
                                insertion: .move(edge: .bottom).combined(with: .opacity),
                                removal: .move(edge: .leading).combined(with: .opacity)
                            ))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .id(page)

                progress
                    .padding(.bottom, 14)

                HStack(spacing: 12) {
                    if page > 0 {
                        Button("Back") {
                            Haptics.light()
                            withAnimation(Theme.Motion.slow) { page -= 1 }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .frame(width: 110)
                    }

                    Button(ctaLabel) {
                        Haptics.light()
                        if page < pageCount - 1 {
                            withAnimation(Theme.Motion.slow) { page += 1 }
                        } else {
                            onDone()
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
            }
        }
        .animation(Theme.Motion.slow, value: page)
        .onAppear { track(page) }
        .onChange(of: page) { _, new in track(new) }
    }

    /// Quattro tacche, una per coppia: mezza piena sul problema,
    /// piena sulla soluzione.
    private var progress: some View {
        HStack(spacing: 6) {
            ForEach(0..<topics.count, id: \.self) { i in
                let fill: CGFloat = i < pairIndex ? 1 : (i == pairIndex ? (isProblem ? 0.5 : 1) : 0)
                Capsule()
                    .fill(Theme.brand.opacity(0.18))
                    .frame(width: 34, height: 5)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(Theme.brand)
                            .frame(width: 34 * fill, height: 5)
                    }
                    .animation(Theme.Motion.signature, value: page)
            }
        }
    }

    private var ctaLabel: String {
        if isProblem { return "That's me" }
        return page == pageCount - 1 ? "I want this" : "Next"
    }

    /// Uno step per pagina, per posizione: la prima coppia è sempre
    /// `pair1`, qualunque problema contenga, così il funnel non si
    /// spezza in base all'ordine che ogni utente ha ricevuto.
    private func track(_ page: Int) {
        let id = "pair\(page / 2 + 1).\(page.isMultiple(of: 2) ? "problem" : "solution")"
        guard let step = OnboardingStep(rawValue: id) else { return }
        appState.trackOnboarding(step)
    }
}

// MARK: - Slide problema: l'illustrazione e i pensieri

private struct ProblemStorySlide: View {
    let topic: ProblemTopic
    let number: Int
    let total: Int

    @State private var revealed = false
    @State private var copyShown = false
    @State private var shownThoughts = 0
    @State private var breathe = false
    @State private var underlined = false

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let fullHeight = width * 4 / 3
            let imageHeight = min(fullHeight, geo.size.height * 0.64)

            VStack(spacing: 0) {
                illustration(width: width, fullHeight: fullHeight, visibleHeight: imageHeight)

                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        Rectangle()
                            .fill(Theme.amber)
                            .frame(width: 22, height: 2)
                        Text("Problem \(number) of \(total)")
                            .font(Theme.body(11.5, weight: .bold))
                            .tracking(1.8)
                            .textCase(.uppercase)
                            .foregroundStyle(Theme.amber)
                    }

                    Text(topic.quote)
                        .font(Theme.display(30))
                        .foregroundStyle(Theme.ink)
                        .lineSpacing(1)
                        .fixedSize(horizontal: false, vertical: true)
                        .overlay(alignment: .bottomLeading) {
                            HandUnderline()
                                .trim(from: 0, to: underlined ? 1 : 0)
                                .stroke(Theme.amber, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                                .frame(width: 120, height: 10)
                                .offset(y: 12)
                        }

                    Text(topic.line)
                        .font(Theme.body(15.5))
                        .foregroundStyle(Theme.subtle)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 28)
                .padding(.top, 10)
                .opacity(copyShown ? 1 : 0)
                .offset(y: copyShown ? 0 : 18)

                Spacer(minLength: 0)
            }
        }
        .onAppear(perform: play)
    }

    /// L'illustrazione è 3:4 e sopra la testa ha un quarto di vuoto
    /// per i pensieri. Nello spazio che resta sopra al testo si mostra
    /// dal 5% al 93% dell'altezza, rimpicciolendo se serve: i bordi
    /// laterali e il fondo sfumano nella pagina, che ha lo stesso
    /// crema, quindi del ritaglio non si vede niente.
    private func illustration(width: CGFloat, fullHeight: CGFloat, visibleHeight: CGFloat) -> some View {
        let scale = min(1, visibleHeight / (fullHeight * 0.88))
        let drawnWidth = width * scale
        let drawnHeight = fullHeight * scale
        let topCrop = drawnHeight * 0.05
        let sideInset = (width - drawnWidth) / 2
        let face = CGPoint(x: sideInset + topic.face.x * drawnWidth, y: topic.face.y * drawnHeight - topCrop)
        let revealDiameter = max(width, visibleHeight) * 2.3

        return ZStack(alignment: .top) {
            ZStack(alignment: .topLeading) {
                Image(topic.imageName)
                    .resizable()
                    .scaledToFill()
                    .frame(width: drawnWidth, height: drawnHeight)
                    .scaleEffect(breathe ? 1.035 : 1, anchor: topic.face)

                ForEach(Array(topic.thoughts.enumerated()), id: \.offset) { i, thought in
                    ThoughtWord(text: thought.text, struck: thought.struck, shown: shownThoughts > i, phase: Double(i))
                        .rotationEffect(.degrees(thought.tilt))
                        .position(x: thought.x * drawnWidth, y: thought.y * drawnHeight)
                }
            }
            .frame(width: drawnWidth, height: drawnHeight)
            .offset(y: -topCrop)
        }
        .frame(width: width, height: visibleHeight, alignment: .top)
        .clipped()
        // Il fondo e i fianchi dell'immagine sfumano nella pagina
        .mask(
            LinearGradient(
                stops: [
                    .init(color: .black, location: 0),
                    .init(color: .black, location: 0.84),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
        )
        .mask(
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .black, location: 0.09),
                    .init(color: .black, location: 0.91),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .leading, endPoint: .trailing
            )
        )
        // La rivelazione parte dalla faccia
        .mask(
            Circle()
                .frame(width: revealDiameter, height: revealDiameter)
                .scaleEffect(revealed ? 1 : 0.001)
                .position(face)
        )
    }

    private func play() {
        withAnimation(.easeOut(duration: 0.9).delay(0.05)) { revealed = true }
        withAnimation(Theme.Motion.slow.delay(0.4)) { copyShown = true }
        for i in 1...topic.thoughts.count {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.75 + Double(i - 1) * 0.34) {
                withAnimation(.spring(duration: 0.5, bounce: 0.35)) { shownThoughts = i }
                Haptics.light()
            }
        }
        withAnimation(.easeInOut(duration: 0.55).delay(1.05)) { underlined = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.95) {
            withAnimation(.easeInOut(duration: 4.5).repeatForever(autoreverses: true)) { breathe = true }
        }
    }
}

/// Un pensiero in corsivo che affiora, ondeggia piano e, se è un no,
/// viene barrato con un tratto che si disegna.
private struct ThoughtWord: View {
    let text: String
    let struck: Bool
    let shown: Bool
    let phase: Double

    @State private var bob = false
    @State private var strike: CGFloat = 0

    var body: some View {
        Text(text)
            .font(.system(size: 17, weight: .medium, design: .serif))
            .italic()
            .foregroundStyle(Theme.ink.opacity(0.82))
            .fixedSize()
            .overlay {
                if struck {
                    StrikeLine()
                        .trim(from: 0, to: strike)
                        .stroke(Theme.soft_red, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .padding(.horizontal, -5)
                }
            }
            .scaleEffect(shown ? 1 : 0.55)
            .opacity(shown ? 1 : 0)
            .offset(y: bob ? -4 : 4)
            .onAppear {
                withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true).delay(phase * 0.35)) {
                    bob = true
                }
            }
            .onChange(of: shown) { _, now in
                guard now, struck else { return }
                withAnimation(.easeInOut(duration: 0.35).delay(0.4)) { strike = 1 }
            }
    }
}

/// Tratto di penna da sinistra a destra, un filo in salita.
private struct StrikeLine: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY + 2))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.midY - 2),
            control: CGPoint(x: rect.midX, y: rect.midY - 1)
        )
        return path
    }
}

/// Sottolineatura a mano: un'onda sola, non una riga.
private struct HandUnderline: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY + 1))
        path.addCurve(
            to: CGPoint(x: rect.maxX, y: rect.midY - 1),
            control1: CGPoint(x: rect.width * 0.3, y: rect.minY - 2),
            control2: CGPoint(x: rect.width * 0.7, y: rect.maxY + 2)
        )
        return path
    }
}

// MARK: - Slide soluzione: il telefono che risolve

private struct SolutionSlide: View {
    let topic: ProblemTopic

    @State private var landed = false
    @State private var copyShown = false

    var body: some View {
        VStack(spacing: 10) {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    Rectangle()
                        .fill(Theme.brand)
                        .frame(width: 22, height: 2)
                    Text("How Cherry fixes it")
                        .font(Theme.body(11.5, weight: .bold))
                        .tracking(1.8)
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.brand)
                }

                // Il problema di prima, barrato: la coppia si legge
                // anche qui.
                Text(topic.quote.replacingOccurrences(of: "\n", with: " "))
                    .font(.system(size: 14, weight: .medium, design: .serif))
                    .italic()
                    .strikethrough(true, color: Theme.soft_red)
                    .foregroundStyle(Theme.subtle)

                Text(topic.solutionTitle)
                    .font(Theme.display(24))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 12)
            .padding(.horizontal, 24)
            .opacity(copyShown ? 1 : 0)
            .offset(y: copyShown ? 0 : -12)

            DemoPhone { demo }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.vertical, 4)
                .rotation3DEffect(.degrees(landed ? 0 : 16), axis: (x: 1, y: 0, z: 0), perspective: 0.6)
                .offset(y: landed ? 0 : 70)
                .opacity(landed ? 1 : 0)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.top, 2)
                    Text(topic.solutionText)
                        .font(Theme.body(14, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(Theme.brand)

                if let note = topic.solutionNote {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "book.closed.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .padding(.top, 2)
                        Text(note)
                            .font(Theme.body(13, weight: .medium))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(Theme.ink.opacity(0.75))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 38)
            .padding(.bottom, 14)
            .opacity(copyShown ? 1 : 0)
            .offset(y: copyShown ? 0 : 12)
        }
        .onAppear {
            withAnimation(.spring(duration: 0.8, bounce: 0.22).delay(0.1)) { landed = true }
            withAnimation(Theme.Motion.slow.delay(0.35)) { copyShown = true }
        }
    }

    @ViewBuilder
    private var demo: some View {
        switch topic {
        case .grocery: DeckDemo()
        case .menu: MenuScanDemo()
        case .recipe: SwapDemo()
        case .barcode: BarcodeDemo()
        }
    }
}

// MARK: - L'iPhone finto

/// Scocca in titanio, Dynamic Island, tasti laterali, home indicator.
/// Il contenuto è disegnato su un canvas fisso 300×640 e riscalato:
/// dentro le demo si usano i componenti veri dell'app alle loro
/// dimensioni naturali, come uno screen registrato.
/// Il canvas fisso su cui sono disegnate le demo (poi riscalato).
private enum PhoneCanvas {
    static let size = CGSize(width: 300, height: 640)
}

private struct DemoPhone<Content: View>: View {
    @ViewBuilder let content: () -> Content

    private let bezel: CGFloat = 9

    var body: some View {
        GeometryReader { geo in
            let screen = PhoneCanvas.size
            let bodySize = CGSize(width: screen.width + bezel * 2, height: screen.height + bezel * 2)
            let scale = min(geo.size.width / (bodySize.width + 16), geo.size.height / bodySize.height)

            ZStack {
                // Scocca
                RoundedRectangle(cornerRadius: 56, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: 0x4A4D54), Color(hex: 0x1A1B1E)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 56, style: .continuous)
                            .strokeBorder(.white.opacity(0.22), lineWidth: 1.2)
                    )
                    .frame(width: bodySize.width, height: bodySize.height)
                    // Tasti laterali
                    .overlay(alignment: .topLeading) {
                        VStack(spacing: 12) {
                            sideButton(height: 22)
                            sideButton(height: 38)
                            sideButton(height: 38)
                        }
                        .offset(x: -2.5, y: 120)
                    }
                    .overlay(alignment: .topTrailing) {
                        sideButton(height: 62)
                            .offset(x: 2.5, y: 170)
                    }

                // Schermo
                ZStack(alignment: .top) {
                    content()
                        .frame(width: screen.width, height: screen.height)

                    // Dynamic Island
                    Capsule()
                        .fill(.black)
                        .frame(width: 90, height: 25)
                        .padding(.top, 11)
                }
                .frame(width: screen.width, height: screen.height)
                .clipShape(RoundedRectangle(cornerRadius: 47, style: .continuous))
                .overlay(alignment: .bottom) {
                    Capsule()
                        .fill(Theme.ink.opacity(0.35))
                        .frame(width: 96, height: 4)
                        .padding(.bottom, 7)
                }
            }
            .compositingGroup()
            .shadow(color: Theme.ink.opacity(0.28), radius: 22, y: 12)
            .scaleEffect(scale)
            .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
    }

    private func sideButton(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(Color(hex: 0x2A2C30))
            .frame(width: 3, height: height)
    }
}

/// Status bar da iPhone: ora, rete, batteria. Ogni demo la disegna
/// del colore giusto per il proprio sfondo.
private struct PhoneStatusBar: View {
    var tint: Color = Theme.ink

    var body: some View {
        HStack {
            Text("9:41")
                .font(.system(size: 14, weight: .semibold, design: .rounded))
            Spacer()
            HStack(spacing: 5) {
                Image(systemName: "cellularbars")
                Image(systemName: "wifi")
                Image(systemName: "battery.100percent")
            }
            .font(.system(size: 12, weight: .medium))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 26)
        .padding(.top, 15)
    }
}

// MARK: - Demo 1: il deck vero che diventa lista

/// Le stesse carte dell'app (`RecipeCardFace`, foto vere delle ricette
/// mock) swippate da un dito finto: a destra si accende il verde KEEP,
/// a sinistra il rosso PASS — il wash e i timbri sono quelli veri.
private struct DeckDemo: View {
    private static let picks: [Recipe] = {
        let catalog = DemoDeck.deck(preferring: [])
        let wanted = ["Creamy Peanut Ramen", "Crispy Chickpea Gyros", "Sticky Teriyaki Eggplant Bowls"]
        let chosen = wanted.compactMap { title in catalog.first { $0.title == title } }
        return chosen.count == 3 ? chosen : Array(catalog.prefix(3))
    }()

    /// true = keep, false = pass, nil = ancora nel mazzo.
    @State private var decisions: [Bool?] = [nil, nil, nil]
    /// Drag della carta in cima (guida wash e timbri come nell'app).
    @State private var dragOffset: CGSize = .zero
    @State private var fingerVisible = false
    @State private var showCoach = true
    @State private var showList = false
    @State private var checks = Array(repeating: false, count: 7)

    private var budget: Double {
        (Self.picks[0].costUsd + Self.picks[2].costUsd + 4).rounded()
    }

    private var spent: Double {
        zip(Self.picks, decisions)
            .filter { $0.1 == true }
            .map(\.0.costUsd)
            .reduce(0, +)
    }

    private var keptCount: Int { decisions.filter { $0 == true }.count }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.cream
            CherryBackground(mood: .warm)

            VStack(spacing: 8) {
                PhoneStatusBar()

                BudgetMeterBar(spent: spent, budget: budget, keptCount: keptCount)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                deckArea
                    .frame(height: 404)
                    .padding(.horizontal, 16)
                    .padding(.top, 2)

                actionBar
                Spacer(minLength: 0)
            }

            listScreen
        }
        .frame(width: PhoneCanvas.size.width, height: PhoneCanvas.size.height)
        .task { await runLoop() }
    }

    // Il mazzo, con le carte dietro sfocate come nell'app vera.
    private var deckArea: some View {
        ZStack {
            ForEach(Array(Self.picks.indices.reversed()), id: \.self) { i in
                if decisions[i] == nil {
                    let stackPos = i - decisions.prefix(i).compactMap { $0 }.count
                    let isTop = stackPos == 0

                    RecipeCardFace(recipe: Self.picks[i], dragOffset: isTop ? dragOffset : .zero)
                        .overlay(alignment: .top) {
                            if isTop && showCoach {
                                coachBanner.padding(.top, 52)
                            }
                        }
                        .scaleEffect(isTop ? 1 : 1 - CGFloat(stackPos) * 0.045)
                        .offset(y: isTop ? 0 : CGFloat(stackPos) * 12)
                        .blur(radius: isTop ? 0 : CGFloat(stackPos) * 5)
                        .opacity(isTop ? 1 : (stackPos == 1 ? 0.9 : 0.7))
                        .offset(isTop ? dragOffset : .zero)
                        .rotationEffect(.degrees(isTop ? Double(dragOffset.width) / 18 : 0))
                        .zIndex(Double(3 - stackPos))
                }
            }

            // Il dito che insegna il gesto
            if fingerVisible {
                Circle()
                    .fill(.white.opacity(0.55))
                    .overlay(Circle().strokeBorder(.white.opacity(0.9), lineWidth: 2))
                    .frame(width: 30, height: 30)
                    .shadow(color: Theme.ink.opacity(0.3), radius: 6, y: 2)
                    .offset(x: dragOffset.width, y: 130 + dragOffset.height)
                    .zIndex(10)
                    .transition(.opacity)
            }
        }
    }

    private var coachBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "chevron.left")
                .foregroundStyle(Theme.soft_red)
            Text("swipe to choose")
                .foregroundStyle(.white)
                .tracking(0.4)
            Image(systemName: "chevron.right")
                .foregroundStyle(Theme.fit)
        }
        .font(Theme.body(12, weight: .bold))
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: Capsule())
        .background(Theme.ink.opacity(0.35), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(0.25), lineWidth: 1))
        .transition(.opacity)
    }

    // La stessa fila di azioni del deck vero: Pass / Save / Keep.
    private var actionBar: some View {
        HStack(spacing: 20) {
            actionCircle("xmark", tint: Theme.soft_red, label: "Pass", size: 48)
            actionCircle("star", tint: Theme.amber, label: "Save", size: 42)
            actionCircle("cart.fill.badge.plus", tint: Theme.fit, label: "Keep", size: 48)
        }
        .padding(.top, 6)
    }

    private func actionCircle(_ systemName: String, tint: Color, label: String, size: CGFloat) -> some View {
        VStack(spacing: 4) {
            Image(systemName: systemName)
                .font(.system(size: size * 0.36, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: size, height: size)
                .glassEffect(.regular, in: .circle)
            Text(label)
                .font(Theme.body(10, weight: .semibold))
                .foregroundStyle(Theme.subtle)
        }
    }

    // La schermata lista, come GroceryListView: arriva da destra.
    // Base cream sotto la mesh: CherryBackground da solo è traslucido
    // e lascerebbe intravedere il budget meter del deck sotto.
    private var listScreen: some View {
        ZStack(alignment: .top) {
            Theme.cream
            CherryBackground(mood: .fresh)

            VStack(alignment: .leading, spacing: 8) {
                PhoneStatusBar()

                Text("Your list")
                    .font(Theme.display(26))
                    .foregroundStyle(Theme.ink)
                    .padding(.top, 12)

                Text("\(checks.filter { $0 }.count)/\(checks.count) items · $\(Int(spent)) spent")
                    .font(Theme.body(13, weight: .semibold))
                    .foregroundStyle(Theme.subtle)
                    .contentTransition(.numericText())

                ForEach(listSections.indices, id: \.self) { s in
                    Text(listSections[s].0)
                        .font(Theme.body(11, weight: .bold))
                        .foregroundStyle(Theme.subtle)
                        .tracking(1.2)
                        .padding(.top, 8)

                    VStack(spacing: 6) {
                        ForEach(listSections[s].1.indices, id: \.self) { r in
                            let i = flatIndex(section: s, row: r)
                            listRow(name: listSections[s].1[r].0, price: listSections[s].1[r].1, checked: checks[i])
                        }
                    }
                }

                HStack(spacing: 6) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 12, weight: .bold))
                    Text("Under budget, $\(Int(budget - spent)) left")
                        .font(Theme.body(12, weight: .bold))
                }
                .foregroundStyle(Theme.fit)
                .padding(.top, 8)

                Spacer()
            }
            .padding(.horizontal, 18)
        }
        .frame(width: PhoneCanvas.size.width, height: PhoneCanvas.size.height)
        .offset(x: showList ? 0 : PhoneCanvas.size.width + 20)
    }

    private func listRow(name: String, price: String, checked: Bool) -> some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(checked ? Theme.brand : .white)
                .overlay(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(checked ? Theme.brand : Theme.ink.opacity(0.18), lineWidth: 1.5)
                )
                .overlay {
                    if checked {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(.white)
                    }
                }
                .frame(width: 22, height: 22)

            Text(name)
                .font(Theme.body(13, weight: .medium))
                .foregroundStyle(Theme.ink)
                .strikethrough(checked, color: Theme.ink.opacity(0.3))
                .opacity(checked ? 0.5 : 1)

            Spacer()

            Text(price)
                .font(Theme.body(12, weight: .semibold))
                .foregroundStyle(Theme.subtle)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
    }

    /// La spesa che quelle due ricette produrrebbero davvero:
    /// il ramen al burro d'arachidi e le eggplant bowls teriyaki.
    private var listSections: [(String, [(String, String)])] {
        [
            ("PRODUCE", [
                ("Eggplants", "$3"),
                ("Scallions", "$1"),
                ("Fresh ginger", "$1"),
            ]),
            ("PANTRY", [
                ("Ramen noodles", "$3"),
                ("Peanut butter", "$4"),
                ("Jasmine rice", "$2"),
                ("Soy sauce", "$2"),
            ]),
        ]
    }

    private func flatIndex(section: Int, row: Int) -> Int {
        listSections.prefix(section).map(\.1.count).reduce(0, +) + row
    }

    // MARK: sequenza

    private func runLoop() async {
        // Il primo giro parte subito: un secondo di mazzo fermo
        // all'apertura della slide sembra uno screenshot. I giri
        // successivi hanno il tempo della lista che esce, poi di nuovo
        // lo swipe senza pausa extra.
        var firstPass = true
        while !Task.isCancelled {
            if !firstPass {
                withAnimation(Theme.Motion.slow) { showList = false }
                try? await Task.sleep(for: .seconds(0.4))
                withAnimation(nil) {
                    decisions = [nil, nil, nil]
                    checks = Array(repeating: false, count: 7)
                    dragOffset = .zero
                    showCoach = true
                }
                try? await Task.sleep(for: .seconds(0.18))
            }
            firstPass = false

            await swipe(card: 0, keep: true)
            await swipe(card: 1, keep: false)
            await swipe(card: 2, keep: true)

            try? await Task.sleep(for: .seconds(0.55))
            withAnimation(.spring(duration: 0.55, bounce: 0.2)) { showList = true }
            for i in 0..<4 {
                try? await Task.sleep(for: .seconds(0.42))
                withAnimation(.spring(duration: 0.35, bounce: 0.4)) { checks[i] = true }
                Haptics.light()
            }
            try? await Task.sleep(for: .seconds(1.9))
        }
    }

    /// Un gesto vero: il dito si posa, trascina (wash + timbro come
    /// nell'app), poi la carta vola via dal lato della decisione.
    private func swipe(card: Int, keep: Bool) async {
        withAnimation(Theme.Motion.quick) {
            fingerVisible = true
            showCoach = false
        }
        // Il dito e la carta partono insieme: una posa di 300ms
        // dopo il plant è di nuovo uno screenshot.
        try? await Task.sleep(for: .seconds(0.12))

        withAnimation(.easeInOut(duration: 0.6)) {
            dragOffset = CGSize(width: keep ? 110 : -110, height: -10)
        }
        try? await Task.sleep(for: .seconds(0.85))

        withAnimation(.easeOut(duration: 0.32)) {
            dragOffset = CGSize(width: keep ? 560 : -560, height: -50)
            fingerVisible = false
        }
        Haptics.light()
        try? await Task.sleep(for: .seconds(0.3))

        withAnimation(.spring(duration: 0.4, bounce: 0.2)) {
            decisions[card] = keep
            dragOffset = .zero
        }
        try? await Task.sleep(for: .seconds(0.35))
    }
}

// MARK: - Le tessere toccate dal dito finto

/// La frase con il buco delle schermate vere (`MagnetSentence`), ma
/// guidata dalla demo: la scelta arriva da fuori e ogni tessera dice
/// dove si trova, così il dito finto preme proprio lì.
private struct DemoMagnetPicker: View {
    let lead: String
    let magnets: [WordMagnet]
    let selection: String?
    var emptyWord: String?
    var compact = true
    var pressed: String?
    let space: String
    @Binding var frames: [String: CGRect]

    @Namespace private var fridge

    private var picked: WordMagnet? { magnets.first { $0.id == selection } }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 12 : 18) {
            if compact {
                HStack(spacing: 8) {
                    Text(lead)
                        .font(Theme.display(22))
                        .foregroundStyle(Theme.ink)
                    slot
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(lead)
                        .font(Theme.display(30))
                        .foregroundStyle(Theme.ink)
                    slot
                }
            }

            MagnetWrap(spacing: 8) {
                ForEach(magnets) { magnet in
                    trayTile(magnet)
                        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(space)) } action: { frames[magnet.id] = $0 }
                }
            }
        }
    }

    @ViewBuilder
    private var slot: some View {
        if let picked {
            MagnetTile(magnet: picked, size: compact ? .regular : .large)
                .matchedGeometryEffect(id: picked.id, in: fridge)
        } else {
            Text(emptyWord ?? "…")
                .font(emptyWord == nil ? Theme.display(compact ? 20 : 26) : Theme.body(compact ? 14 : 18, weight: .bold))
                .foregroundStyle(Theme.ink.opacity(emptyWord == nil ? 0.25 : 0.4))
                .padding(.horizontal, emptyWord == nil ? 0 : 12)
                .frame(minWidth: compact ? 86 : 120, minHeight: compact ? 40 : 52)
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                        .foregroundStyle(Theme.ink.opacity(0.2))
                }
        }
    }

    @ViewBuilder
    private func trayTile(_ magnet: WordMagnet) -> some View {
        if magnet.id == selection {
            MagnetTile(magnet: magnet)
                .hidden()
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                        .foregroundStyle(magnet.ink.opacity(0.28))
                }
                .rotationEffect(tilt(magnet))
        } else {
            MagnetTile(magnet: magnet)
                .matchedGeometryEffect(id: magnet.id, in: fridge)
                .rotationEffect(tilt(magnet))
                .scaleEffect(pressed == magnet.id ? 0.9 : 1)
        }
    }

    private func tilt(_ magnet: WordMagnet) -> Angle {
        let seed = magnet.id.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return .degrees(Double(seed % 7) - 3)
    }
}

/// Il polpastrello finto: lo stesso cerchio bianco del deck.
private struct DemoFinger: View {
    var pressing: Bool

    var body: some View {
        Circle()
            .fill(.white.opacity(0.55))
            .overlay(Circle().strokeBorder(.white.opacity(0.95), lineWidth: 2))
            .frame(width: 32, height: 32)
            .shadow(color: Theme.ink.opacity(0.35), radius: 6, y: 2)
            .scaleEffect(pressing ? 0.75 : 1)
            .allowsHitTesting(false)
    }
}

// MARK: - Demo 2: il menu scansionato

/// Il mirino sul menu di carta, poi la schermata risultato come
/// MenuResultView: i piatti in ordine di gusto e la frase "Something
/// ___". Il dito tocca high-protein e la lista si riordina con i
/// grammi, poi vegan e restano solo i piatti che puoi ordinare.
private struct MenuScanDemo: View {
    private enum Phase { case scanning, result }

    private struct Dish: Identifiable {
        let name: String
        let blurb: String
        let price: String
        let protein: Int
        let taste: Int
        let vegan: Bool
        /// La richiesta che lo rende vegano, se basta chiedere.
        var ask: String?
        var id: String { name }
    }

    private static let dishes: [Dish] = [
        Dish(name: "Spaghetti carbonara", blurb: "Egg, pecorino, guanciale", price: "$13", protein: 28, taste: 1, vegan: false),
        Dish(name: "Mushroom risotto", blurb: "Porcini, butter, parmesan", price: "$12", protein: 12, taste: 2, vegan: false,
             ask: "no butter, no parmesan"),
        Dish(name: "Grilled chicken salad", blurb: "Chicken, greens, lemon", price: "$14", protein: 42, taste: 3, vegan: false),
        Dish(name: "Tomato bruschetta", blurb: "Tomato, garlic, basil", price: "$6", protein: 8, taste: 4, vegan: true),
        Dish(name: "Lentil & spinach soup", blurb: "Lentils, spinach, cumin", price: "$9", protein: 19, taste: 5, vegan: true),
        Dish(name: "Grilled salmon", blurb: "Salmon, greens, capers", price: "$18", protein: 38, taste: 6, vegan: false),
    ]

    private static let lenses: [MenuLens] = [.vegan, .light, .protein, .lowCarb]
    private static let space = "menuDemo"

    @State private var phase: Phase = .scanning
    /// Già sul menu al primo frame: se aspettiamo il task per
    /// far comparire il fascio, la slide si apre su una foto ferma.
    @State private var beamProgress: CGFloat = 0.08
    @State private var shownCards = 0
    @State private var flash = false
    @State private var lens: MenuLens?
    @State private var frames: [String: CGRect] = [:]
    @State private var finger = CGPoint(x: 250, y: 620)
    @State private var fingerShown = false
    @State private var pressing: String?

    private var rows: [Dish] {
        switch lens {
        case .protein:
            return Array(Self.dishes.sorted { $0.protein > $1.protein }.prefix(4))
        case .vegan:
            return Self.dishes
                .filter { $0.vegan || $0.ask != nil }
                .sorted { ($0.vegan ? 0 : 1, $0.taste) < ($1.vegan ? 0 : 1, $1.taste) }
        default:
            return Array(Self.dishes.sorted { $0.taste < $1.taste }.prefix(4))
        }
    }

    var body: some View {
        ZStack(alignment: .top) {
            // Base del risultato (cream sotto: la mesh è traslucida)
            Theme.cream
            CherryBackground(mood: .calm)

            // In fase scatto lo schermo è una camera vera: buio
            // attorno, il menu illuminato al centro.
            LinearGradient(
                colors: [Color(hex: 0x101512), Color(hex: 0x1E2620), Color(hex: 0x0C100D)],
                startPoint: .top, endPoint: .bottom
            )
            .opacity(phase == .scanning ? 1 : 0)

            // Il menu di carta: al centro sotto il mirino, poi si
            // ritira nell'angolo come la foto del risultato.
            menuPaper
                .frame(width: 236)
                .overlay { if phase == .scanning { viewfinder } }
                .scaleEffect(phase == .result ? 0.3 : 1, anchor: .topTrailing)
                .rotationEffect(.degrees(phase == .result ? 4 : 0))
                .offset(x: phase == .result ? 12 : 0, y: phase == .result ? 50 : 128)

            if phase == .scanning {
                VStack {
                    PhoneStatusBar(tint: .white)

                    Text("Point at the menu")
                        .font(Theme.body(13, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(.white.opacity(0.16), in: .capsule)
                        .padding(.top, 14)

                    Spacer()

                    // Otturatore della camera
                    ZStack {
                        Circle().strokeBorder(.white.opacity(0.85), lineWidth: 3.5).frame(width: 62, height: 62)
                        Circle().fill(.white).frame(width: 50, height: 50).scaleEffect(flash ? 0.8 : 1)
                    }
                    .padding(.bottom, 34)
                }
                .transition(.opacity)
            }

            // Il flash dello scatto
            Color.white
                .opacity(flash ? 0.85 : 0)
                .allowsHitTesting(false)

            if phase == .result {
                resultScreen
                    .transition(.opacity)
            }

            DemoFinger(pressing: pressing != nil)
                .position(finger)
                .opacity(fingerShown ? 1 : 0)
        }
        .frame(width: PhoneCanvas.size.width, height: PhoneCanvas.size.height)
        .coordinateSpace(.named(Self.space))
        .task { await runLoop() }
    }

    private var resultScreen: some View {
        VStack(alignment: .leading, spacing: 0) {
            PhoneStatusBar()

            VStack(alignment: .leading, spacing: 2) {
                Text("Trattoria Rossa")
                    .font(Theme.display(22))
                    .foregroundStyle(Theme.ink)
                Text("6 dishes read")
                    .font(Theme.body(12, weight: .semibold))
                    .foregroundStyle(Theme.subtle)
            }
            .padding(.top, 22)

            DemoMagnetPicker(
                lead: "Something",
                magnets: Self.lenses.map(\.magnet),
                selection: lens?.rawValue,
                emptyWord: "I'll love",
                pressed: pressing,
                space: Self.space,
                frames: $frames
            )
            .padding(.top, 30)
            .opacity(shownCards >= 1 ? 1 : 0)

            Text(lens?.note ?? "Ranked by your taste. Tap a word to sort it another way.")
                .font(Theme.body(12, weight: .semibold))
                .foregroundStyle(Theme.subtle)
                .fixedSize(horizontal: false, vertical: true)
                .contentTransition(.opacity)
                .padding(.top, 12)
                .opacity(shownCards >= 1 ? 1 : 0)

            VStack(spacing: 6) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, dish in
                    dishRow(dish, rank: index + 1)
                        .transition(.opacity.combined(with: .scale(scale: 0.92)))
                }
            }
            .padding(.top, 10)
            .opacity(shownCards >= 2 ? 1 : 0)
            .offset(y: shownCards >= 2 ? 0 : 18)

            Spacer()
        }
        .padding(.horizontal, 18)
    }

    private func dishRow(_ dish: Dish, rank: Int) -> some View {
        let asks = lens == .vegan && !dish.vegan
        let accent = asks ? Theme.amber : Theme.fit

        return HStack(spacing: 10) {
            Text("\(rank)")
                .font(Theme.display(14))
                .foregroundStyle(accent)
                .contentTransition(.numericText())
                .frame(width: 26, height: 26)
                .background(.white.opacity(0.8), in: .circle)
                .overlay(Circle().stroke(accent.opacity(0.35), lineWidth: 1.2))

            VStack(alignment: .leading, spacing: 2) {
                Text(dish.name)
                    .font(Theme.body(13, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                detail(dish, asks: asks)
            }

            Spacer(minLength: 4)

            Text(dish.price)
                .font(Theme.body(12, weight: .heavy))
                .foregroundStyle(Theme.ink.opacity(0.55))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background((asks ? Theme.butter : Theme.fitWash).opacity(0.6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .background(.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder
    private func detail(_ dish: Dish, asks: Bool) -> some View {
        switch lens {
        case .protein:
            Text("≈ \(dish.protein) g protein")
                .font(Theme.body(11, weight: .bold))
                .foregroundStyle(MenuLens.protein.magnet.ink)
        case .vegan:
            if asks, let ask = dish.ask {
                Text("Ask: “\(ask)”")
                    .font(Theme.body(11, weight: .semibold))
                    .italic()
                    .foregroundStyle(Theme.amber)
            } else {
                Label("Vegan as it is", systemImage: "checkmark")
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(Theme.fit)
            }
        default:
            Text(dish.blurb)
                .font(Theme.body(11))
                .foregroundStyle(Theme.subtle)
        }
    }

    /// La "foto" del menu, con il fascio che la legge.
    private var menuPaper: some View {
        VStack(spacing: 8) {
            Text("TRATTORIA ROSSA")
                .font(.system(size: 13, weight: .bold, design: .serif))
                .foregroundStyle(Theme.ink)
                .tracking(2)
                .padding(.top, 4)
            Rectangle()
                .fill(Theme.ink.opacity(0.15))
                .frame(width: 60, height: 1)

            ForEach(Self.dishes) { dish in
                paperRow(dish.name, String(dish.price.dropFirst()))
            }
        }
        .padding(16)
        .background(.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .shadow(color: Theme.ink.opacity(0.15), radius: 12, y: 6)
        .overlay { beam }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func paperRow(_ name: String, _ price: String) -> some View {
        HStack {
            Text(name)
                .font(.system(size: 11.5, design: .serif))
            Spacer()
            Text(price)
                .font(.system(size: 11.5, design: .serif))
                .opacity(0.7)
        }
        .foregroundStyle(Theme.ink)
        .padding(.vertical, 3)
    }

    private var beam: some View {
        GeometryReader { geo in
            LinearGradient(
                colors: [.clear, Theme.brand.opacity(0.35), Theme.brand.opacity(0.65), Theme.brand.opacity(0.35), .clear],
                startPoint: .top, endPoint: .bottom
            )
            .frame(height: 46)
            .overlay(Rectangle().fill(Theme.brand).frame(height: 1.5))
            .offset(y: geo.size.height * beamProgress - 23)
            .opacity(beamProgress > -0.15 && beamProgress < 1.15 ? 1 : 0)
        }
        .allowsHitTesting(false)
    }

    /// Le quattro L del mirino, agganciate agli angoli del menu.
    private var viewfinder: some View {
        ZStack {
            cornerMark.rotationEffect(.degrees(0))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .offset(x: -13, y: -13)
            cornerMark.rotationEffect(.degrees(90))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .offset(x: 13, y: -13)
            cornerMark.rotationEffect(.degrees(180))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .offset(x: 13, y: 13)
            cornerMark.rotationEffect(.degrees(270))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                .offset(x: -13, y: 13)
        }
        .allowsHitTesting(false)
    }

    private var cornerMark: some View {
        Path { path in
            path.move(to: CGPoint(x: 0, y: 26))
            path.addLine(to: CGPoint(x: 0, y: 7))
            path.addQuadCurve(to: CGPoint(x: 7, y: 0), control: .zero)
            path.addLine(to: CGPoint(x: 26, y: 0))
        }
        .stroke(Theme.brand, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
        .frame(width: 26, height: 26)
    }

    private func tap(_ target: MenuLens) async {
        guard let rect = frames[target.rawValue] else { return }
        withAnimation(.easeInOut(duration: 0.55)) {
            finger = CGPoint(x: rect.midX, y: rect.midY)
            fingerShown = true
        }
        try? await Task.sleep(for: .seconds(0.6))
        withAnimation(.easeOut(duration: 0.12)) { pressing = target.rawValue }
        try? await Task.sleep(for: .seconds(0.15))
        Haptics.selection()
        withAnimation(Theme.Motion.signature) {
            pressing = nil
            lens = target
        }
    }

    private func runLoop() async {
        var firstPass = true
        while !Task.isCancelled {
            if firstPass {
                firstPass = false
            } else {
                withAnimation(nil) {
                    phase = .scanning
                    beamProgress = 0.08
                    shownCards = 0
                    flash = false
                    lens = nil
                    fingerShown = false
                    finger = CGPoint(x: 250, y: 620)
                }
                try? await Task.sleep(for: .seconds(0.12))
            }

            withAnimation(.easeInOut(duration: 1.5)) { beamProgress = 1.25 }
            try? await Task.sleep(for: .seconds(1.7))

            // Lo scatto: flash e otturatore che si stringe
            withAnimation(.easeOut(duration: 0.1)) { flash = true }
            Haptics.light()
            try? await Task.sleep(for: .seconds(0.12))
            withAnimation(.easeIn(duration: 0.3)) { flash = false }
            try? await Task.sleep(for: .seconds(0.3))

            withAnimation(.spring(duration: 0.65, bounce: 0.15)) { phase = .result }
            try? await Task.sleep(for: .seconds(0.5))

            for i in 1...2 {
                withAnimation(.spring(duration: 0.45, bounce: 0.25)) { shownCards = i }
                try? await Task.sleep(for: .seconds(0.4))
            }
            try? await Task.sleep(for: .seconds(1.2))

            await tap(.protein)
            try? await Task.sleep(for: .seconds(2.4))

            await tap(.vegan)
            try? await Task.sleep(for: .seconds(2.6))

            withAnimation(.easeOut(duration: 0.3)) { fingerShown = false }
            try? await Task.sleep(for: .seconds(0.4))
        }
    }
}

// MARK: - Demo 3: dalla ricetta TikTok alla vista dinamica

/// Il video con la pasta (foto vera di una ricetta mock), la share
/// card "Recipe caught!" identica all'extension, poi la vista dinamica
/// come nell'app: il video fermo in alto che ripete il suo spezzone, e
/// sotto le card degli step che il dito scorre una alla volta.
private struct SwapDemo: View {
    private enum Phase: Int { case video, share, dynamic }

    private struct Step {
        let title: String
        let lines: [String]
        let ingredients: [(emoji: String, name: String, quantity: String)]
        /// Il fotogramma del video in quello spezzone.
        let image: String
    }

    private static let pasta: Recipe = {
        let catalog = DemoDeck.deck(preferring: ["Italian"])
        return catalog.first { $0.title.contains("Rigatoni") } ?? catalog[0]
    }()

    private static let steps: [Step] = [
        Step(title: "Boil the pasta",
             lines: ["Bring a large pot of salted water to a boil.", "Cook the rigatoni for 11 minutes."],
             ingredients: [("🍝", "Rigatoni", "320 g"), ("🧂", "Salt", "")],
             image: "onb_step_boil"),
        Step(title: "Make the sauce",
             lines: ["Melt the butter, then add the tomatoes.", "Simmer for 10 minutes."],
             ingredients: [("🧈", "Butter", "30 g"), ("🍅", "Tomatoes", "400 g")],
             image: "onb_step_sauce"),
        Step(title: "Add the cream",
             lines: ["Stir in the cream and the parmesan."],
             ingredients: [("🥛", "Heavy cream", "200 ml"), ("🧀", "Parmesan", "60 g")],
             image: "onb_step_cream"),
        Step(title: "Toss and serve",
             lines: ["Toss the rigatoni in the sauce.", "Top with fresh basil."],
             ingredients: [("🌿", "Basil", "a handful")],
             image: "onb_step_serve"),
    ]

    private static let playerHeight: CGFloat = 270
    private static let cardHeight: CGFloat = 190

    @State private var phase: Phase = .video
    @State private var finger = CGPoint(x: 150, y: 560)
    @State private var fingerShown = false
    @State private var pressing: String?
    @State private var openPressed = false
    @State private var sharePulse = false
    @State private var discSpinning = false
    @State private var videoProgress: CGFloat = 0

    @State private var step = 0
    @State private var drag: CGFloat = 0
    /// Dentro lo spezzone: 0 all'inizio, 1 quando ricomincia.
    @State private var segmentProgress: CGFloat = 0

    var body: some View {
        ZStack {
            videoScreen
                .offset(x: slide(for: .share))

            dynamicScreen
                .offset(x: slide(for: .dynamic))

            DemoFinger(pressing: pressing != nil)
                .position(finger)
                .opacity(fingerShown ? 1 : 0)
        }
        .frame(width: PhoneCanvas.size.width, height: PhoneCanvas.size.height)
        .clipped()
        .task { await runLoop() }
    }

    /// Le schermate scorrono in fila: quella attiva al centro, le
    /// passate a sinistra, le prossime a destra.
    private func slide(for screen: Phase) -> CGFloat {
        let current = phase == .video ? Phase.share.rawValue : phase.rawValue
        return CGFloat(screen.rawValue - current) * PhoneCanvas.size.width
    }

    // Il social: foto vera della pasta come "video", con tutto il
    // vocabolario TikTok — tabs, rail, vinile, ticker, progress bar.
    private var videoScreen: some View {
        ZStack(alignment: .top) {
            RecipePhoto(imageUrl: Self.pasta.imageUrl, imageStatus: "ready")
                .frame(width: PhoneCanvas.size.width, height: PhoneCanvas.size.height)
                .overlay(
                    LinearGradient(
                        colors: [.black.opacity(0.4), .clear, .black.opacity(0.8)],
                        startPoint: .top, endPoint: .bottom
                    )
                )

            PhoneStatusBar(tint: .white)

            // Tabs in alto, come il feed vero
            HStack(spacing: 18) {
                Text("Following")
                    .foregroundStyle(.white.opacity(0.6))
                VStack(spacing: 4) {
                    Text("For You")
                        .foregroundStyle(.white)
                    Capsule().fill(.white).frame(width: 26, height: 2.5)
                }
            }
            .font(Theme.body(14, weight: .bold))
            .shadow(color: .black.opacity(0.4), radius: 3)
            .padding(.top, 46)

            // Rail a destra: avatar, like, commenti, salva, share
            VStack(spacing: 16) {
                ZStack(alignment: .bottom) {
                    Circle()
                        .fill(LinearGradient(colors: [Theme.amber, Theme.soft_red], startPoint: .top, endPoint: .bottom))
                        .frame(width: 40, height: 40)
                        .overlay(
                            Text("N")
                                .font(.system(size: 17, weight: .heavy, design: .rounded))
                                .foregroundStyle(.white)
                        )
                        .overlay(Circle().strokeBorder(.white, lineWidth: 1.5))
                    Circle()
                        .fill(Color(hex: 0xFE2C55))
                        .frame(width: 16, height: 16)
                        .overlay(
                            Image(systemName: "plus")
                                .font(.system(size: 9, weight: .heavy))
                                .foregroundStyle(.white)
                        )
                        .offset(y: 8)
                }
                .padding(.bottom, 4)

                railIcon("heart.fill", label: "182K")
                railIcon("ellipsis.bubble.fill", label: "2.1K")
                railIcon("bookmark.fill", label: "45K")
                railIcon("arrowshape.turn.up.right.fill", label: "Share")
                    .scaleEffect(sharePulse ? 1.3 : 1)
                    .animation(.spring(duration: 0.4, bounce: 0.55), value: sharePulse)

                // Il vinile che gira
                Circle()
                    .fill(
                        AngularGradient(
                            colors: [Color(hex: 0x2A2A2A), Color(hex: 0x4A4A4A), Color(hex: 0x2A2A2A)],
                            center: .center
                        )
                    )
                    .frame(width: 34, height: 34)
                    .overlay(
                        Image(systemName: "music.note")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                    )
                    .rotationEffect(.degrees(discSpinning ? 360 : 0))
                    .animation(.linear(duration: 3).repeatForever(autoreverses: false), value: discSpinning)
                    .padding(.top, 2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .padding(.trailing, 12)
            .padding(.bottom, 84)

            // Caption e musica in basso a sinistra
            VStack(alignment: .leading, spacing: 6) {
                Text("@nonna.pasta")
                    .font(Theme.body(14, weight: .heavy))
                Text("this pasta you NEED to try 😍 #dinner")
                    .font(Theme.body(12))
                HStack(spacing: 5) {
                    Image(systemName: "music.note")
                        .font(.system(size: 10, weight: .bold))
                    Text("original sound · nonna.pasta")
                        .font(Theme.body(11, weight: .medium))
                }
                .opacity(0.85)
            }
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.4), radius: 3)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            .padding(.leading, 14)
            .padding(.trailing, 70)
            .padding(.bottom, 84)

            // Progress del video
            Capsule()
                .fill(.white.opacity(0.25))
                .frame(height: 2.5)
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(.white)
                        .frame(width: (PhoneCanvas.size.width - 28) * videoProgress, height: 2.5)
                }
                .padding(.horizontal, 14)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, 30)

            // La share card dell'extension, identica
            shareCard
                .frame(maxHeight: .infinity, alignment: .bottom)
                .offset(y: phase == .share ? 0 : 320)
        }
        .frame(width: PhoneCanvas.size.width, height: PhoneCanvas.size.height)
        .onAppear { discSpinning = true }
    }

    private func railIcon(_ systemName: String, label: String) -> some View {
        VStack(spacing: 3) {
            Image(systemName: systemName)
                .font(.system(size: 26, weight: .semibold))
            Text(label)
                .font(Theme.body(10, weight: .semibold))
        }
        .foregroundStyle(.white)
        .shadow(color: .black.opacity(0.45), radius: 4)
    }

    private var shareCard: some View {
        VStack(spacing: 10) {
            Capsule()
                .fill(Theme.ink.opacity(0.14))
                .frame(width: 34, height: 4.5)
                .padding(.top, 8)

            HStack(spacing: 6) {
                Image(systemName: "link.circle.fill")
                    .font(.system(size: 13, weight: .semibold))
                Text("From TikTok")
                    .font(Theme.body(11, weight: .semibold))
            }
            .foregroundStyle(Theme.brand)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Theme.brand.opacity(0.1), in: .capsule)

            Text("Recipe caught!")
                .font(.system(size: 19, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.ink)

            Text("Adapt it now, or keep scrolling.\nWe'll start reading it either way.")
                .font(.system(size: 11.5, design: .rounded))
                .foregroundStyle(Theme.ink.opacity(0.58))
                .multilineTextAlignment(.center)

            Text("Open Cherry now")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(Theme.brand, in: .capsule)
                .scaleEffect(openPressed ? 0.94 : 1)
                .padding(.horizontal, 16)

            Text("Keep scrolling")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.ink.opacity(0.5))
                .padding(.bottom, 14)
        }
        .frame(maxWidth: .infinity)
        .background(Color(hex: 0xFCF9F2).opacity(0.98), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.2), radius: 18, y: -4)
        .padding(.horizontal, 10)
        .padding(.bottom, 22)
    }

    // La vista dinamica di DynamicRecipeView: tacche, player, card.
    private var dynamicScreen: some View {
        ZStack(alignment: .top) {
            Theme.cream
            CherryBackground(mood: .warm)

            VStack(spacing: 12) {
                PhoneStatusBar()

                HStack(spacing: 10) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .frame(width: 30, height: 30)
                        .background(.white.opacity(0.85), in: .circle)
                    HStack(spacing: 3) {
                        ForEach(Self.steps.indices, id: \.self) { n in
                            Capsule()
                                .fill(n <= step ? Theme.brand : Theme.ink.opacity(0.12))
                                .frame(height: 3.5)
                        }
                    }
                }
                .padding(.horizontal, 16)

                player
                    .padding(.horizontal, 16)

                cards
                    .padding(.horizontal, 18)

                Spacer(minLength: 0)

                HStack(spacing: 6) {
                    Text(step == Self.steps.count - 1 ? "Done" : "Next step")
                        .font(Theme.body(13, weight: .bold))
                    Image(systemName: step == Self.steps.count - 1 ? "checkmark" : "chevron.down")
                        .font(.system(size: 10, weight: .bold))
                }
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 18)
                .frame(height: 38)
                .background(.white.opacity(0.85), in: .capsule)
                .contentTransition(.opacity)
                .padding(.bottom, 20)
            }
        }
        .frame(width: PhoneCanvas.size.width, height: PhoneCanvas.size.height)
    }

    /// Il player ufficiale: il video del creator, col suo nome, che
    /// ripete lo spezzone dello step aperto.
    private var player: some View {
        let shot = Self.steps[step]
        return ZStack(alignment: .bottom) {
            Image(shot.image)
                .resizable()
                .scaledToFill()
                .frame(height: Self.playerHeight)
                .scaleEffect(1.04 + segmentProgress * 0.08)
                .id(step)
                .transition(.opacity)

            LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)

            HStack(alignment: .bottom) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(LinearGradient(colors: [Theme.amber, Theme.soft_red], startPoint: .top, endPoint: .bottom))
                        .frame(width: 20, height: 20)
                        .overlay(
                            Text("N")
                                .font(.system(size: 9, weight: .heavy, design: .rounded))
                                .foregroundStyle(.white)
                        )
                    Text("@nonna.pasta")
                        .font(Theme.body(11, weight: .bold))
                        .foregroundStyle(.white)
                }
                Spacer()
                HStack(spacing: 6) {
                    playerButton("pause.fill")
                    playerButton("speaker.wave.2.fill")
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 14)

            Capsule()
                .fill(.white.opacity(0.3))
                .frame(height: 2.5)
                .overlay(alignment: .leading) {
                    GeometryReader { geo in
                        Capsule()
                            .fill(.white)
                            .frame(width: geo.size.width * segmentProgress)
                    }
                }
                .frame(height: 2.5)
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
        }
        .frame(maxWidth: .infinity)
        .frame(height: Self.playerHeight)
        .background(.black)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func playerButton(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 28, height: 28)
            .background(.black.opacity(0.35), in: .circle)
    }

    /// Le card degli step, una per pagina, come lo scroll a pagine
    /// dell'app: il dito le spinge su.
    private var cards: some View {
        VStack(spacing: 0) {
            ForEach(Self.steps.indices, id: \.self) { n in
                card(n)
                    .frame(height: Self.cardHeight, alignment: .top)
            }
        }
        .offset(y: -CGFloat(step) * Self.cardHeight + drag)
        .frame(height: Self.cardHeight, alignment: .top)
        .clipped()
    }

    private func card(_ n: Int) -> some View {
        let s = Self.steps[n]
        let firstLine = Self.steps[..<n].reduce(1) { $0 + $1.lines.count }
        return VStack(alignment: .leading, spacing: 9) {
            VStack(alignment: .leading, spacing: 2) {
                Text("STEP \(n + 1) OF \(Self.steps.count)")
                    .font(Theme.body(9.5, weight: .bold))
                    .foregroundStyle(Theme.subtle)
                    .tracking(1.1)
                Text(s.title)
                    .font(Theme.display(19))
                    .foregroundStyle(Theme.ink)
            }

            ForEach(s.lines.indices, id: \.self) { i in
                HStack(alignment: .top, spacing: 8) {
                    Text("\(firstLine + i)")
                        .font(Theme.body(10, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 18, height: 18)
                        .background(Circle().fill(Theme.brand))
                    Text(s.lines[i])
                        .font(Theme.body(12.5))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            HStack(spacing: 6) {
                ForEach(s.ingredients.indices, id: \.self) { i in
                    let item = s.ingredients[i]
                    HStack(spacing: 4) {
                        Text(item.emoji)
                            .font(.system(size: 11))
                        Text(item.name)
                            .font(Theme.body(11, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                        if !item.quantity.isEmpty {
                            Text(item.quantity)
                                .font(Theme.body(11))
                                .foregroundStyle(Theme.subtle)
                        }
                    }
                    .lineLimit(1)
                    .padding(.horizontal, 9)
                    .frame(height: 26)
                    .background(.white.opacity(0.85), in: .capsule)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func press(_ point: CGPoint, _ pressed: Binding<Bool>) async {
        withAnimation(.easeInOut(duration: 0.5)) {
            finger = point
            fingerShown = true
        }
        try? await Task.sleep(for: .seconds(0.55))
        withAnimation(.easeInOut(duration: 0.15)) {
            pressed.wrappedValue = true
            pressing = "button"
        }
        try? await Task.sleep(for: .seconds(0.18))
        withAnimation(.easeInOut(duration: 0.15)) {
            pressed.wrappedValue = false
            pressing = nil
        }
        Haptics.light()
        try? await Task.sleep(for: .seconds(0.25))
    }

    /// Lo spezzone che gira: la barra riparte da zero e il fotogramma
    /// si avvicina piano, per `seconds`.
    private func playSegment(for seconds: Double) {
        withAnimation(nil) { segmentProgress = 0 }
        withAnimation(.linear(duration: seconds)) { segmentProgress = 1 }
    }

    /// Il dito appoggiato sulle card le spinge su: arriva lo step dopo.
    private func swipeUp() async {
        withAnimation(.easeInOut(duration: 0.4)) {
            finger = CGPoint(x: 190, y: 560)
            fingerShown = true
        }
        try? await Task.sleep(for: .seconds(0.45))
        withAnimation(.easeOut(duration: 0.1)) { pressing = "card" }
        withAnimation(.easeInOut(duration: 0.3)) {
            finger = CGPoint(x: 190, y: 470)
            drag = -40
        }
        try? await Task.sleep(for: .seconds(0.3))
        Haptics.selection()
        withAnimation(.spring(duration: 0.5, bounce: 0.15)) {
            step += 1
            drag = 0
            pressing = nil
        }
        withAnimation(.easeOut(duration: 0.3)) { fingerShown = false }
    }

    private func runLoop() async {
        while !Task.isCancelled {
            withAnimation(nil) {
                phase = .video
                sharePulse = false
                openPressed = false
                fingerShown = false
                finger = CGPoint(x: 150, y: 600)
                videoProgress = 0
                step = 0
                drag = 0
                segmentProgress = 0
            }

            withAnimation(.linear(duration: 3.2)) { videoProgress = 1 }
            try? await Task.sleep(for: .seconds(1.0))

            sharePulse = true
            Haptics.light()
            try? await Task.sleep(for: .seconds(0.6))

            withAnimation(.spring(duration: 0.55, bounce: 0.2)) { phase = .share }
            try? await Task.sleep(for: .seconds(1.0))

            await press(CGPoint(x: 150, y: 562), $openPressed)
            withAnimation(.spring(duration: 0.6, bounce: 0.12)) {
                phase = .dynamic
                fingerShown = false
            }

            for n in Self.steps.indices {
                let hold = n == 0 ? 2.6 : 2.2
                playSegment(for: hold + 0.9)
                try? await Task.sleep(for: .seconds(hold))
                guard !Task.isCancelled else { return }
                if n < Self.steps.count - 1 { await swipeUp() }
            }
            try? await Task.sleep(for: .seconds(1.2))
        }
    }
}

// MARK: - Demo 4: il barcode letto

/// La camera sul retro di una scatola, il laser sul codice, poi la
/// scheda come ProductResultView: le parole che valgono e quelle no,
/// il verdetto con il perché (misurato sul profilo), i valori per
/// 100 g e gli ingredienti con quello che non va evidenziato. Due
/// prodotti si alternano, un no e un sì, sullo stesso profilo.
private struct BarcodeDemo: View {
    private enum Phase { case scanning, result }
    private enum Level { case low, medium, high }

    private struct Product {
        let name: String
        let detail: String
        let tint: Color
        let fits: Bool
        let reason: String
        let vegan: Bool
        let highProtein: Bool
        let nutriScore: Int
        let kcal: Int
        let levels: [(name: String, amount: String, level: Level)]
        let ingredients: [(name: String, flagged: Bool)]
    }

    /// Quello che l'utente ha detto nel quiz: il verdetto si misura qui.
    private static let profile = "no dairy · less sugar"

    private static let products: [Product] = [
        Product(name: "Choco Crunch cookies", detail: "Sweetfield · 200 g", tint: Theme.peach, fits: false,
                reason: "Contains milk powder, and you avoid dairy. Sugar is high too.",
                vegan: false, highProtein: false, nutriScore: 3, kcal: 482,
                levels: [("Fat", "21 g", .medium), ("Sugar", "31 g", .high), ("Salt", "0.4 g", .low)],
                ingredients: [("Wheat flour", false), ("sugar", true), ("palm oil", false), ("milk powder", true),
                              ("cocoa 6%", false), ("salt", false)]),
        Product(name: "Oat & seed crackers", detail: "Nordhavn · 250 g", tint: Theme.butter, fits: true,
                reason: "Nothing you avoid. Low in sugar, rich in fibre.",
                vegan: true, highProtein: true, nutriScore: 0, kcal: 410,
                levels: [("Fat", "14 g", .medium), ("Sugar", "1.2 g", .low), ("Salt", "0.9 g", .medium)],
                ingredients: [("Wholegrain oats", false), ("sunflower seeds", false), ("flaxseed", false),
                              ("sesame", false), ("sea salt", false)]),
    ]

    private static let nutriColors: [Color] = [
        Color(hex: 0x038141), Color(hex: 0x85BB2F), Color(hex: 0xFECB02), Color(hex: 0xEE8100), Color(hex: 0xE63E11),
    ]

    @State private var phase: Phase = .scanning
    @State private var productIndex = 0
    @State private var laser: CGFloat = 0.1
    @State private var flash = false
    @State private var shownRows = 0

    private var product: Product { Self.products[productIndex % Self.products.count] }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.cream
            CherryBackground(mood: .calm)

            LinearGradient(
                colors: [Color(hex: 0x101512), Color(hex: 0x1E2620), Color(hex: 0x0C100D)],
                startPoint: .top, endPoint: .bottom
            )
            .opacity(phase == .scanning ? 1 : 0)

            // La scatola sotto il mirino; a scatto fatto si rimpicciolisce
            // e diventa la foto della scheda.
            box
                .frame(width: 200, height: 150)
                .overlay { if phase == .scanning { viewfinder } }
                .scaleEffect(phase == .result ? 0.36 : 1, anchor: .topLeading)
                .rotationEffect(.degrees(phase == .result ? -3 : 0))
                .offset(x: phase == .result ? -32 : 0, y: phase == .result ? 56 : 190)

            if phase == .scanning {
                VStack {
                    PhoneStatusBar(tint: .white)

                    Text("Point at the barcode")
                        .font(Theme.body(13, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(.white.opacity(0.16), in: .capsule)
                        .padding(.top, 14)

                    Spacer()

                    Text("Hold still…")
                        .font(Theme.body(12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.7))
                        .padding(.bottom, 44)
                }
                .transition(.opacity)
            }

            Color.white
                .opacity(flash ? 0.85 : 0)
                .allowsHitTesting(false)

            if phase == .result {
                resultScreen
                    .transition(.opacity)
            }
        }
        .frame(width: PhoneCanvas.size.width, height: PhoneCanvas.size.height)
        .task { await runLoop() }
    }

    private var resultScreen: some View {
        VStack(alignment: .leading, spacing: 12) {
            PhoneStatusBar()

            VStack(alignment: .leading, spacing: 2) {
                Text(product.name)
                    .font(Theme.display(19))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Text(product.detail)
                    .font(Theme.body(11.5, weight: .medium))
                    .foregroundStyle(Theme.subtle)
            }
            .padding(.leading, 88)
            .frame(minHeight: 58)
            .padding(.top, 8)

            HStack(spacing: 8) {
                badge("vegan", holds: product.vegan, magnet: MenuLens.vegan.magnet)
                badge("high-protein", holds: product.highProtein, magnet: MenuLens.protein.magnet)
            }
            .opacity(shownRows >= 1 ? 1 : 0)
            .offset(y: shownRows >= 1 ? 0 : 14)

            verdictCard
                .opacity(shownRows >= 2 ? 1 : 0)
                .offset(y: shownRows >= 2 ? 0 : 14)

            nutritionCard
                .opacity(shownRows >= 3 ? 1 : 0)
                .offset(y: shownRows >= 3 ? 0 : 14)

            ingredientsCard
                .opacity(shownRows >= 4 ? 1 : 0)
                .offset(y: shownRows >= 4 ? 0 : 14)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
    }

    @ViewBuilder
    private func badge(_ word: String, holds: Bool, magnet: WordMagnet) -> some View {
        if holds {
            Text(word)
                .font(Theme.body(14, weight: .bold))
                .foregroundStyle(magnet.ink)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(magnet.wash)
                        .shadow(color: magnet.ink.opacity(0.24), radius: 0, x: 0, y: 2)
                }
                .rotationEffect(.degrees(-2))
        } else {
            Text(word)
                .font(Theme.body(14, weight: .bold))
                .foregroundStyle(Theme.ink.opacity(0.32))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .overlay {
                    Capsule()
                        .fill(Theme.ink.opacity(0.4))
                        .frame(height: 2)
                        .padding(.horizontal, 8)
                        .rotationEffect(.degrees(-4))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1.2, dash: [5, 4]))
                        .foregroundStyle(Theme.ink.opacity(0.18))
                }
        }
    }

    private var verdictCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Your profile: \(Self.profile)", systemImage: "person.crop.circle")
                .font(Theme.body(10.5, weight: .bold))
                .foregroundStyle(Theme.subtle)

            HStack(alignment: .top, spacing: 10) {
                Image(systemName: product.fits ? "checkmark" : "xmark")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(product.fits ? Theme.fit : Theme.soft_red, in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text(product.fits ? "Fits you" : "Not for you")
                        .font(Theme.title(16))
                        .foregroundStyle(product.fits ? Theme.fit : Theme.soft_red)
                    Text(product.reason)
                        .font(Theme.body(11.5, weight: .medium))
                        .foregroundStyle(Theme.ink.opacity(0.75))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((product.fits ? Theme.fitWash : Theme.blush).opacity(0.7), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var nutritionCard: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text("PER 100 G")
                    .font(Theme.body(9.5, weight: .bold))
                    .tracking(1.1)
                    .foregroundStyle(Theme.subtle)
                Spacer()
                nutriScore
            }
            nutritionRow("Energy", amount: "\(product.kcal) kcal", level: nil)
            ForEach(product.levels.indices, id: \.self) { i in
                let row = product.levels[i]
                nutritionRow(row.name, amount: row.amount, level: row.level)
            }
        }
        .padding(12)
        .background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var nutriScore: some View {
        HStack(spacing: 2) {
            ForEach(0..<5, id: \.self) { i in
                let picked = i == product.nutriScore
                Text(["A", "B", "C", "D", "E"][i])
                    .font(.system(size: picked ? 11 : 8, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(width: picked ? 20 : 13, height: picked ? 20 : 14)
                    .background(Self.nutriColors[i].opacity(picked ? 1 : 0.45), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
        }
    }

    private func nutritionRow(_ name: String, amount: String, level: Level?) -> some View {
        HStack {
            Text(name)
                .font(Theme.body(12, weight: .semibold))
                .foregroundStyle(Theme.ink)
            Spacer()
            Text(amount)
                .font(Theme.body(12, weight: .bold))
                .foregroundStyle(Theme.ink.opacity(0.7))
            if let level {
                let (word, color): (String, Color) = switch level {
                case .low: ("low", Theme.fit)
                case .medium: ("medium", Theme.amber)
                case .high: ("high", Theme.soft_red)
                }
                Text(word)
                    .font(Theme.body(10, weight: .heavy))
                    .foregroundStyle(color)
                    .frame(width: 52, height: 18)
                    .background(color.opacity(0.14), in: .capsule)
            } else {
                Color.clear.frame(width: 52, height: 18)
            }
        }
    }

    private var ingredientsCard: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("INGREDIENTS")
                .font(Theme.body(9.5, weight: .bold))
                .tracking(1.1)
                .foregroundStyle(Theme.subtle)
            Text(ingredientsText)
                .font(Theme.body(12, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    /// Gli ingredienti in fila; quelli che toccano il profilo in rosso.
    private var ingredientsText: AttributedString {
        var text = AttributedString()
        for (i, item) in product.ingredients.enumerated() {
            var part = AttributedString(item.name)
            if item.flagged {
                part.foregroundColor = Theme.soft_red
                part.font = Theme.body(12, weight: .heavy)
                part.underlineStyle = .single
            } else {
                part.foregroundColor = Theme.ink.opacity(0.7)
            }
            text += part
            if i < product.ingredients.count - 1 {
                var comma = AttributedString(", ")
                comma.foregroundColor = Theme.ink.opacity(0.7)
                text += comma
            }
        }
        return text
    }

    /// Il retro della scatola: il blocco ingredienti in righe finte e
    /// il codice a barre sotto, con il laser che lo attraversa.
    private var box: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("INGREDIENTS")
                .font(.system(size: 8, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(Theme.ink.opacity(0.7))
            VStack(alignment: .leading, spacing: 3) {
                ForEach(0..<4, id: \.self) { i in
                    Capsule()
                        .fill(Theme.ink.opacity(0.22))
                        .frame(width: [150, 162, 118, 140][i], height: 3)
                }
            }
            Spacer(minLength: 0)
            barcode
                .frame(height: 44)
                .overlay { laserLine }
                .clipped()
        }
        .padding(14)
        .background(product.tint, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Theme.ink.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: Theme.ink.opacity(0.18), radius: 12, y: 6)
    }

    private var barcode: some View {
        HStack(alignment: .top, spacing: 2) {
            ForEach(0..<34, id: \.self) { i in
                Rectangle()
                    .fill(Theme.ink)
                    .frame(width: (i * 7) % 3 == 0 ? 3 : 1.5)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 6)
        .padding(.vertical, 5)
        .background(.white, in: RoundedRectangle(cornerRadius: 4))
    }

    private var laserLine: some View {
        GeometryReader { geo in
            Rectangle()
                .fill(Theme.soft_red)
                .frame(height: 2)
                .shadow(color: Theme.soft_red.opacity(0.9), radius: 4)
                .offset(y: geo.size.height * laser - 1)
                .opacity(phase == .scanning ? 1 : 0)
        }
        .allowsHitTesting(false)
    }

    private var viewfinder: some View {
        ZStack {
            cornerMark
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .offset(x: -13, y: -13)
            cornerMark.rotationEffect(.degrees(90))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .offset(x: 13, y: -13)
            cornerMark.rotationEffect(.degrees(180))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .offset(x: 13, y: 13)
            cornerMark.rotationEffect(.degrees(270))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                .offset(x: -13, y: 13)
        }
        .allowsHitTesting(false)
    }

    private var cornerMark: some View {
        Path { path in
            path.move(to: CGPoint(x: 0, y: 26))
            path.addLine(to: CGPoint(x: 0, y: 7))
            path.addQuadCurve(to: CGPoint(x: 7, y: 0), control: .zero)
            path.addLine(to: CGPoint(x: 26, y: 0))
        }
        .stroke(Theme.brand, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
        .frame(width: 26, height: 26)
    }

    private func runLoop() async {
        var firstPass = true
        while !Task.isCancelled {
            if firstPass {
                firstPass = false
            } else {
                withAnimation(nil) {
                    phase = .scanning
                    laser = 0.1
                    shownRows = 0
                    flash = false
                    productIndex += 1
                }
                try? await Task.sleep(for: .seconds(0.12))
            }

            // Il laser passa due volte sul codice
            for _ in 0..<2 {
                withAnimation(.easeInOut(duration: 0.55)) { laser = 0.9 }
                try? await Task.sleep(for: .seconds(0.6))
                withAnimation(.easeInOut(duration: 0.55)) { laser = 0.1 }
                try? await Task.sleep(for: .seconds(0.6))
            }

            withAnimation(.easeOut(duration: 0.1)) { flash = true }
            Haptics.light()
            try? await Task.sleep(for: .seconds(0.12))
            withAnimation(.easeIn(duration: 0.3)) { flash = false }
            try? await Task.sleep(for: .seconds(0.3))

            withAnimation(.spring(duration: 0.65, bounce: 0.15)) { phase = .result }
            try? await Task.sleep(for: .seconds(0.5))

            for i in 1...4 {
                withAnimation(.spring(duration: 0.45, bounce: 0.3)) { shownRows = i }
                if i == 2 {
                    if product.fits { Haptics.success() } else { Haptics.medium() }
                }
                try? await Task.sleep(for: .seconds(i == 2 ? 0.8 : 0.45))
            }
            try? await Task.sleep(for: .seconds(3.4))
        }
    }
}
