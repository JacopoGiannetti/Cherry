import SwiftUI

// Tour della home. Prima un benvenuto con la mascotte (Start / Skip),
// poi un giro per Grocery (tab, spazio, Smart List, liste a mano,
// My Lists), lo stesso giro per Recipes, e infine il + dello Scan.
// Ogni passo illumina UN pezzo di UI vera; la card sta lontana dal buco.

enum HomeTourStep: Int, CaseIterable {
    case welcome

    case groceryTab
    case grocerySpace
    case grocerySmart
    case groceryManual
    case groceryLists

    case recipesTab
    case recipesImport
    case recipesWrite
    case recipesCollection

    case scan

    enum Section { case grocery, recipes, scan }

    var next: HomeTourStep? { HomeTourStep(rawValue: rawValue + 1) }

    var anchor: HomeTourAnchor? {
        switch self {
        case .welcome: nil
        case .groceryTab: .groceryTab
        case .grocerySpace: .space
        case .grocerySmart: .smartList
        case .groceryManual: .manualRow
        case .groceryLists: .myLists
        case .recipesTab: .recipesTab
        case .recipesImport: .recipesImport
        case .recipesWrite: .recipesWrite
        case .recipesCollection: .recipesCollection
        case .scan: .scan
        }
    }

    /// Su quale tab deve stare la home per mostrare il pezzo illuminato.
    var tab: AppState.Tab {
        switch self {
        case .recipesTab, .recipesImport, .recipesWrite, .recipesCollection: .recipes
        default: .grocery
        }
    }

    var section: Section? {
        switch self {
        case .welcome: nil
        case .groceryTab, .grocerySpace, .grocerySmart, .groceryManual, .groceryLists: .grocery
        case .recipesTab, .recipesImport, .recipesWrite, .recipesCollection: .recipes
        case .scan: .scan
        }
    }

    /// Posizione dentro la sezione (per i puntini): "2 of 5".
    var sectionIndex: Int {
        switch self {
        case .welcome: 0
        case .groceryTab: 0
        case .grocerySpace: 1
        case .grocerySmart: 2
        case .groceryManual: 3
        case .groceryLists: 4
        case .recipesTab: 0
        case .recipesImport: 1
        case .recipesWrite: 2
        case .recipesCollection: 3
        case .scan: 0
        }
    }

    var sectionCount: Int {
        switch section {
        case .grocery: 5
        case .recipes: 4
        case .scan, .none: 1
        }
    }

    var sectionLabel: String {
        switch section {
        case .grocery: "GROCERY"
        case .recipes: "RECIPES"
        case .scan: "SCAN"
        case .none: ""
        }
    }

    /// Il buco è una capsula (tab, pill, +) o un rettangolo arrotondato.
    var isCapsule: Bool {
        switch self {
        case .groceryTab, .recipesTab, .scan, .grocerySpace: true
        default: false
        }
    }

    var title: String {
        switch self {
        case .welcome: "Welcome"
        case .groceryTab: "Grocery"
        case .grocerySpace: "Just me — or together"
        case .grocerySmart: "Smart List"
        case .groceryManual: "Blank or recipes"
        case .groceryLists: "My Lists"
        case .recipesTab: "Recipes"
        case .recipesImport: "Add a recipe"
        case .recipesWrite: "Write one"
        case .recipesCollection: "Collection"
        case .scan: "Scan"
        }
    }

    var body: String {
        switch self {
        case .welcome:
            ""
        case .groceryTab:
            "This is the Grocery tab. Everything here is about building your shopping list — with Cherry’s help, or by hand."
        case .grocerySpace:
            "Lists can be just yours, or live in a shared space with someone else — a partner, a roommate. Tap here to switch or create a space: everyone in it sees the same list."
        case .grocerySmart:
            "Set a budget, swipe through recipes Cherry picks for your tastes, and the shopping list writes itself from what you say yes to."
        case .groceryManual:
            "Blank list: type the items yourself. From my recipes: pick dishes you’ve saved and Cherry turns their ingredients into a list."
        case .groceryLists:
            "Every list you’ve made lives here. Reopen one, check what you bought, or start again from it."
        case .recipesTab:
            "This is the Recipes tab: your place to collect dishes. Anything saved here can become a grocery list in a tap."
        case .recipesImport:
            "Paste a link from TikTok, Instagram or any site. Save it as it is, or have Cherry make it vegan, lighter, higher in protein and more. You can also hit Share in those apps and pick Cherry."
        case .recipesWrite:
            "Your own dish, in your words: name, photo, ingredients, steps."
        case .recipesCollection:
            "Everything you’ve saved, searchable by name or ingredient. From here a dish goes straight into a grocery list."
        case .scan:
            "The green button in the middle. Tap it and pick Menu — point the camera at a restaurant menu and Cherry tells you what to order — or Product, to see what's really in a packaged item."
        }
    }

    var nextTitle: String {
        switch self {
        case .welcome: "Start the tour"
        case .scan: "Got it"
        default: "Next"
        }
    }
}

enum HomeTourAnchor: Hashable {
    case groceryTab, space, smartList, manualRow, myLists
    case recipesTab, recipesImport, recipesWrite, recipesCollection
    case scan
}

/// I riquadri viaggiano come `Anchor`, non come CGRect già calcolati:
/// si risolvono nel GeometryReader che disegna il velo, quindi le due
/// origini coincidono su qualunque iPhone (Dynamic Island, notch o SE).
struct HomeTourAnchorKey: PreferenceKey {
    static var defaultValue: [HomeTourAnchor: Anchor<CGRect>] = [:]
    static func reduce(value: inout [HomeTourAnchor: Anchor<CGRect>], nextValue: () -> [HomeTourAnchor: Anchor<CGRect>]) {
        value.merge(nextValue(), uniquingKeysWith: { $1 })
    }
}

extension View {
    /// Pubblica il proprio riquadro al tour.
    func homeTourAnchor(_ id: HomeTourAnchor) -> some View {
        anchorPreference(key: HomeTourAnchorKey.self, value: .bounds) { [id: $0] }
    }
}

struct HomeTourOverlay: View {
    let step: HomeTourStep
    /// Area del velo: la stessa in cui è risolto `hole`.
    let size: CGSize
    /// nil se il pezzo da illuminare non è (ancora) a schermo.
    let hole: CGRect?
    var firstName: String?
    let onNext: () -> Void
    let onSkip: () -> Void

    /// Altezza vera della card, misurata: niente stime che sbagliano.
    @State private var cardHeight: CGFloat = 300

    var body: some View {
        let bounds = CGRect(origin: .zero, size: size)
        let cutout = paddedHole(in: bounds)

        ZStack(alignment: .topLeading) {
            spotlight(cutout: cutout, bounds: bounds)

            if cutout.width > 4 {
                RoundedRectangle(cornerRadius: radius(for: cutout), style: .continuous)
                    .stroke(.white.opacity(0.95), lineWidth: 2.5)
                    .frame(width: cutout.width, height: cutout.height)
                    .position(x: cutout.midX, y: cutout.midY)
                    .allowsHitTesting(false)
            }

            Group {
                if step == .welcome {
                    WelcomeCard(
                        firstName: firstName,
                        compact: size.height < 720,
                        onStart: onNext,
                        onSkip: onSkip
                    )
                } else {
                    stepCard
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { cardHeight = $0 }
            .padding(.horizontal, 20)
            .offset(y: cardOriginY(cutout: cutout, in: bounds))
        }
        .frame(width: size.width, height: size.height)
        .animation(Theme.Motion.signature, value: cutout)
    }

    // MARK: - Buco

    private func paddedHole(in bounds: CGRect) -> CGRect {
        guard let hole, hole.width > 8, hole.height > 8 else { return .zero }
        let pad: CGFloat = step.isCapsule ? 8 : 6
        let raw = hole.insetBy(dx: -pad, dy: -pad)
        return raw.intersection(bounds.insetBy(dx: 6, dy: 6))
    }

    private func radius(for rect: CGRect) -> CGFloat {
        step.isCapsule ? min(rect.width, rect.height) / 2 : 32
    }

    private func spotlight(cutout: CGRect, bounds: CGRect) -> some View {
        Path { path in
            path.addRect(bounds)
            if cutout.width > 4 {
                let r = radius(for: cutout)
                path.addRoundedRect(
                    in: cutout,
                    cornerRadii: RectangleCornerRadii(topLeading: r, bottomLeading: r, bottomTrailing: r, topTrailing: r)
                )
            }
        }
        .fill(Color.black.opacity(step == .welcome ? 0.5 : 0.6), style: FillStyle(eoFill: true))
        .contentShape(Rectangle())
    }

    /// Welcome al centro. Le altre card stanno lontane dal buco:
    /// sotto se c'è spazio, sopra se no — mai sopra il pezzo illuminato.
    ///
    /// I margini sono più larghi della zona morta del telefono peggiore
    /// (Dynamic Island 59pt in alto, home indicator 34pt in basso): così
    /// la card resta leggibile anche su SE, dove quello spazio è vuoto.
    private func cardOriginY(cutout: CGRect, in bounds: CGRect) -> CGFloat {
        let gap: CGFloat = 18
        let topLimit = bounds.minY + 72
        let bottomLimit = bounds.maxY - 44

        if step == .welcome {
            return max(topLimit, (bounds.height - cardHeight) / 2)
        }

        if cutout.width > 4 {
            let below = cutout.maxY + gap
            if below + cardHeight < bottomLimit { return below }
            let above = cutout.minY - gap - cardHeight
            if above > topLimit { return above }
            // Non entra né sopra né sotto: sta dal lato con più aria.
            let roomAbove = cutout.minY - topLimit
            let roomBelow = bottomLimit - cutout.maxY
            return roomAbove >= roomBelow ? topLimit : bottomLimit - cardHeight
        }
        return max(topLimit, bottomLimit - cardHeight - 96)
    }

    // MARK: - Card dei passi

    private var stepCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(step.sectionLabel) · \(step.sectionIndex + 1)/\(step.sectionCount)")
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(Theme.brand)
                    .tracking(1.2)
                Spacer(minLength: 8)
                Button("Skip tour") { onSkip() }
                    .font(Theme.body(13, weight: .semibold))
                    .foregroundStyle(Theme.subtle)
            }

            Text(step.title)
                .font(Theme.title(22))
                .foregroundStyle(Theme.ink)

            Text(step.body)
                .font(Theme.body(14))
                .foregroundStyle(Theme.ink.opacity(0.78))
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                sectionDots
                Spacer()
                Button(step.nextTitle) {
                    Haptics.light()
                    onNext()
                }
                .font(Theme.body(15, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .frame(height: 42)
                .background(Theme.brandGradient, in: .capsule)
                .buttonStyle(.plain)
            }
            .padding(.top, 4)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cream, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(Theme.ink.opacity(0.06), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.18), radius: 24, y: 10)
    }

    private var sectionDots: some View {
        HStack(spacing: 6) {
            ForEach(0..<step.sectionCount, id: \.self) { index in
                Capsule()
                    .fill(index == step.sectionIndex ? Theme.brand : Theme.ink.opacity(0.15))
                    .frame(width: index == step.sectionIndex ? 16 : 6, height: 6)
            }
        }
        .animation(Theme.Motion.quick, value: step)
        .accessibilityLabel("\(step.sectionLabel.capitalized), step \(step.sectionIndex + 1) of \(step.sectionCount)")
    }
}

// MARK: - Benvenuto

/// La card del ciao: la mascotte (l'avocado dell'icona) saluta con la
/// mano, sfondo menta che sfuma nella crema, un solo bottone grande.
private struct WelcomeCard: View {
    var firstName: String?
    /// Schermi corti (SE, mini): stessa card, tutto un po' più stretto.
    var compact = false
    let onStart: () -> Void
    let onSkip: () -> Void

    /// Accende le scintille intorno alla mascotte (lei entra da sola).
    @State private var mascotShown = false

    private var greeting: String {
        if let firstName, !firstName.isEmpty { return "Hi \(firstName)!" }
        return "Hi there!"
    }

    var body: some View {
        VStack(spacing: 0) {
            hero
                .frame(height: compact ? 132 : 176)
                .frame(maxWidth: .infinity)
                .clipped()

            VStack(spacing: compact ? 8 : 10) {
                Text(greeting)
                    .font(Theme.display(compact ? 24 : 28))
                    .foregroundStyle(Theme.brandGradient)

                Text("Welcome to Cherry.")
                    .font(Theme.body(16, weight: .semibold))
                    .foregroundStyle(Theme.ink)

                Text("Here’s a quick, easy tour so you know your way around — Grocery, Recipes and Scan. It takes a minute.")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.ink.opacity(0.78))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Button {
                    Haptics.medium()
                    onStart()
                } label: {
                    Text("Start the tour")
                        .font(Theme.body(16, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(Theme.brandGradient, in: .capsule)
                }
                .buttonStyle(.plain)
                .padding(.top, 8)

                Button {
                    Haptics.light()
                    onSkip()
                } label: {
                    Text("Skip for now")
                        .font(Theme.body(14, weight: .semibold))
                        .foregroundStyle(Theme.subtle)
                        .frame(height: 36)
                }
                .buttonStyle(.plain)

                Text("You can replay the tour anytime from Settings.")
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.subtle.opacity(0.8))
            }
            .padding(.horizontal, 22)
            .padding(.top, compact ? 10 : 14)
            .padding(.bottom, compact ? 14 : 18)
        }
        .background(Theme.cream)
        // Il ritaglio va sulla card intera: senza, l'immagine in cima
        // resta squadrata e solo il fondo segue il raggio.
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .stroke(Theme.ink.opacity(0.06), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.2), radius: 28, y: 12)
        .onAppear(perform: animateIn)
    }

    private var hero: some View {
        ZStack {
            // Menta in alto che si scioglie nella crema della card.
            LinearGradient(
                colors: [Theme.mint, Theme.mint.opacity(0.45), Theme.cream],
                startPoint: .top, endPoint: .bottom
            )

            // Due macchie pastello e qualche scintilla: aria di festa,
            // senza rubare la scena alla mascotte.
            Circle()
                .fill(Theme.butter.opacity(0.9))
                .frame(width: 120, height: 120)
                .blur(radius: 24)
                .offset(x: -110, y: -30)
            Circle()
                .fill(Theme.peach.opacity(0.8))
                .frame(width: 110, height: 110)
                .blur(radius: 24)
                .offset(x: 120, y: 10)

            sparkle(size: 14, x: -96, y: -42, delay: 0)
            sparkle(size: 10, x: 104, y: -50, delay: 0.5)
            sparkle(size: 9, x: -70, y: 40, delay: 1.0)
            sparkle(size: 12, x: 82, y: 34, delay: 1.5)

            CherryMascotView(size: compact ? 96 : 124, pose: .wave)
                .padding(.top, 10)
        }
    }

    private func sparkle(size: CGFloat, x: CGFloat, y: CGFloat, delay: Double) -> some View {
        Image(systemName: "sparkle")
            .font(.system(size: size, weight: .bold))
            .foregroundStyle(Theme.brand.opacity(0.7))
            .offset(x: x, y: y)
            .symbolEffect(.pulse, options: .repeating.speed(0.7))
            .opacity(mascotShown ? 1 : 0)
            .animation(Theme.Motion.slow.delay(delay * 0.25), value: mascotShown)
    }

    private func animateIn() {
        withAnimation(Theme.Motion.celebration.delay(0.1)) {
            mascotShown = true
        }
    }
}
