import SwiftUI

// ============================================================
// Identità visiva Cherry v2 — Liquid Glass (iOS 26).
// Pastelli sfumati sotto, vetro sopra: gli sfondi sono mesh
// gradient animati, ogni superficie che galleggia è glass.
// ============================================================
enum Theme {
    // MARK: Palette pastello

    /// Rosso ciliegia pastello: il colore del brand (CTA, accenti, selezioni)
    static let brand = Color(hex: 0xE5566E)
    /// Arancione pastello, il secondo colore del brand
    static let orange = Color(hex: 0xF6A77E)
    /// Verde "va bene": SOLO per i verdetti (prodotto ok, piatto
    /// consigliato, ingrediente compatibile). Mai come accento.
    static let fit = Color(hex: 0x4FA36F)
    /// Il fondo chiaro dei verdetti verdi
    static let fitWash = Color(hex: 0xD3EEDC)
    /// Rosso ciliegia pieno del logo (wordmark)
    static let cherry = Color(hex: 0xE0263F)
    /// Inchiostro caldo per i testi
    static let ink = Color(hex: 0x2B1E22)
    /// Base calda degli sfondi
    static let cream = Color(hex: 0xFDF8F4)
    /// Superficie card (usata solo dove il glass non ha senso)
    static let card = Color.white
    /// Arancione pastello scuro (budget, evidenziazioni)
    static let amber = Color(hex: 0xEE9A62)
    /// Testo secondario
    static let subtle = Color(hex: 0x7A686C)
    /// Errori morbidi
    static let soft_red = Color(hex: 0xD97862)

    // Pastelli del mesh
    /// Rosa ciliegia chiarissimo (il "lavaggio" del brand)
    static let mint = Color(hex: 0xFAD6DC)
    static let peach = Color(hex: 0xFCDDC8)
    /// Arancione pastello chiarissimo
    static let butter = Color(hex: 0xFDE8D6)
    static let lavender = Color(hex: 0xE2DCF7)
    static let blush = Color(hex: 0xF8D9DC)
    static let sky = Color(hex: 0xD4E9F5)

    /// Gradiente brand per testi/riempimenti hero: ciliegia → arancione
    static var brandGradient: LinearGradient {
        LinearGradient(
            colors: [Color(hex: 0xE5566E), Color(hex: 0xEF7F7A), Color(hex: 0xF6A77E)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
    }

    static var sunsetGradient: LinearGradient {
        LinearGradient(
            colors: [amber, Color(hex: 0xF2C078)],
            startPoint: .top, endPoint: .bottom
        )
    }

    // MARK: Tipografia (rounded, food-first)

    static func display(_ size: CGFloat) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
    }

    static func title(_ size: CGFloat = 24) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
    }

    static func body(_ size: CGFloat = 16, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    static let cornerRadius: CGFloat = 28

    // MARK: Identità di movimento

    /// Cherry si muove come parla: caldo, rotondo, mai severo. L'archetipo
    /// è Playful — rimbalzo contenuto attorno al 15%, durate brevi, archi
    /// invece di linee rette. Da qui in avanti le animazioni si scelgono
    /// SOLO in questo elenco: sei curve diverse sparse per l'app non
    /// fanno uno stile, fanno rumore.
    enum Motion {
        /// La curva firma: l'80% dei movimenti passa di qui. `snappy` è
        /// la molla di sistema con rimbalzo 0.15, cioè esattamente
        /// l'overshoot che serve a un'app giocosa senza farla sembrare
        /// un giocattolo.
        static var signature: Animation { .snappy(duration: standard) }

        /// Feedback immediato: pressioni, toggle, chip del quiz.
        static var quick: Animation { .snappy(duration: fast) }

        /// Cambi di contesto: fasi dell'onboarding, sheet, schermate.
        static var slow: Animation { .snappy(duration: leisurely) }

        /// Momenti da festeggiare (acquisto, lista pronta): qui e solo
        /// qui il rimbalzo può esagerare.
        static var celebration: Animation { .bouncy(duration: 0.45, extraBounce: 0.1) }

        /// Le uscite accelerano e durano meno delle entrate: l'utente
        /// guarda quello che arriva, non quello che se ne va.
        static var exit: Animation { .easeIn(duration: 0.16) }

        /// Movimento di fondo che non deve mai attirare lo sguardo.
        static var ambient: Animation {
            .easeInOut(duration: 2.6).repeatForever(autoreverses: true)
        }

        // Le tre durate. Non se ne aggiungono altre.
        static let fast: TimeInterval = 0.15
        static let standard: TimeInterval = 0.25
        static let leisurely: TimeInterval = 0.40

        /// Ritardo a cascata per liste e griglie. Il totale è tenuto
        /// sotto i 400ms: oltre quella soglia una cascata non è più
        /// eleganza, è attesa.
        static func stagger(_ index: Int) -> TimeInterval {
            min(Double(max(index, 0)) * 0.045, 0.36)
        }

        /// Avanzamento fra schermate: la nuova arriva da destra, la
        /// vecchia se ne va a sinistra. Farle uscire entrambe dallo
        /// stesso lato rompe la continuità spaziale e fa perdere il filo
        /// di dove ci si trova nel percorso.
        static var push: AnyTransition {
            .asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .move(edge: .leading).combined(with: .opacity)
            )
        }

        /// Entrata firmata: sale da sotto con un filo di scala, esce
        /// smaterializzandosi sul posto.
        static var entrance: AnyTransition {
            .asymmetric(
                insertion: .offset(y: 18).combined(with: .scale(scale: 0.96, anchor: .bottom)).combined(with: .opacity),
                removal: .scale(scale: 0.98).combined(with: .opacity)
            )
        }
    }
}

// MARK: - Entrata firmata

/// Il pattern d'ingresso unico di Cherry: dal basso, con un accenno di
/// scala e il rimbalzo della curva firma. `index` scala il ritardo per
/// le cascate. Rispetta "Riduci movimento": chi l'ha attivo vede il
/// contenuto comparire senza spostamenti.
struct CherryEntrance: ViewModifier {
    var index: Int = 0
    var anchor: UnitPoint = .bottom

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .scaleEffect(shown || reduceMotion ? 1 : 0.96, anchor: anchor)
            .offset(y: shown || reduceMotion ? 0 : 18)
            .onAppear {
                guard !shown else { return }
                let animation = reduceMotion
                    ? .easeOut(duration: Theme.Motion.standard)
                    : Theme.Motion.signature
                withAnimation(animation.delay(Theme.Motion.stagger(index))) { shown = true }
            }
    }
}

extension View {
    /// Entrata firmata Cherry. Passa l'indice per ottenere la cascata.
    func vegoEntrance(_ index: Int = 0, anchor: UnitPoint = .bottom) -> some View {
        modifier(CherryEntrance(index: index, anchor: anchor))
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

// MARK: - Sfondo: mesh gradient pastello che respira

/// Lo sfondo di tutta l'app: un MeshGradient 3×3 i cui punti derivano
/// lentamente nel tempo. Sotto il vetro, il colore vive.
struct CherryBackground: View {
    /// Varianti tonali per dare un'atmosfera diversa alle sezioni.
    enum Mood {
        case fresh      // rosa ciliegia + arancione (default)
        case warm       // peach + blush (cibo, deck)
        case calm       // lavender + sky (scan, loading)
    }

    var mood: Mood = .fresh

    /// Pagina montata ma non a schermo: il mesh non ha motivo di tickare.
    @Environment(\.vegoMotionPaused) private var paused

    var body: some View {
        // Base crema OPACA sotto il mesh: i pastelli hanno alpha, e in
        // un cover senza fondo lascerebbero trasparire ciò che c'è dietro.
        ZStack {
            Theme.cream
            TimelineView(.animation(minimumInterval: 1.0 / 20.0, paused: paused)) { context in
                let t = context.date.timeIntervalSinceReferenceDate / 9
                let wave = Float(sin(t))
                let wave2 = Float(cos(t * 0.8))

                MeshGradient(
                    width: 3, height: 3,
                    points: [
                        [0, 0], [0.5, 0], [1, 0],
                        [0, 0.5], [0.5 + 0.12 * wave, 0.5 + 0.12 * wave2], [1, 0.5],
                        [0, 1], [0.5, 1], [1, 1],
                    ],
                    colors: colors
                )
            }
        }
        .ignoresSafeArea()
    }

    private var colors: [Color] {
        switch mood {
        case .fresh:
            [
                Theme.cream, Theme.mint.opacity(0.8), Theme.cream,
                Theme.butter.opacity(0.75), Theme.cream, Theme.mint.opacity(0.65),
                Theme.cream, Theme.cream, Theme.mint.opacity(0.35),
            ]
        case .warm:
            [
                Theme.cream, Theme.peach.opacity(0.85), Theme.cream,
                Theme.blush.opacity(0.6), Theme.cream, Theme.butter.opacity(0.8),
                Theme.cream, Theme.cream, Theme.peach.opacity(0.35),
            ]
        case .calm:
            [
                Theme.cream, Theme.lavender.opacity(0.7), Theme.cream,
                Theme.sky.opacity(0.7), Theme.cream, Theme.mint.opacity(0.55),
                Theme.cream, Theme.cream, Theme.lavender.opacity(0.3),
            ]
        }
    }
}

private struct CherryMotionPausedKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Vero sulle pagine tenute montate fuori schermo (le tab non
    /// selezionate): il movimento di fondo si ferma.
    var vegoMotionPaused: Bool {
        get { self[CherryMotionPausedKey.self] }
        set { self[CherryMotionPausedKey.self] = newValue }
    }
}

// MARK: - Bottoni Liquid Glass

/// Le card grandi della home sono bottoni. Niente vetro interattivo lì
/// sopra: su una superficie di quella taglia costa, e la luce che segue
/// il dito sopra un'illustrazione sembra una sfumatura che si sposta.
/// Il feedback è un lieve schiacciamento, come per le CTA.
struct CherryCardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(
                configuration.isPressed ? Theme.Motion.quick : Theme.Motion.signature,
                value: configuration.isPressed
            )
    }
}

/// CTA primaria: vetro prominente tinto di rosso ciliegia, interattivo
/// (si flette e brilla sotto il dito).
struct PrimaryButtonStyle: ButtonStyle {
    var fullWidth = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(17, weight: .bold))
            .foregroundStyle(.white)
            .padding(.vertical, 17)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .padding(.horizontal, fullWidth ? 0 : 28)
            // Il vetro è un background: senza contentShape l'area
            // toccabile resterebbe la sola etichetta di testo.
            .contentShape(.capsule)
            .glassEffect(.regular.tint(Theme.brand.opacity(0.92)).interactive(), in: .capsule)
            // Schiacciata rapida sotto il dito, risalita con rimbalzo:
            // premere deve costare meno tempo che essere ricompensati.
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .offset(y: configuration.isPressed ? 1 : 0)
            .animation(
                configuration.isPressed ? Theme.Motion.quick : Theme.Motion.signature,
                value: configuration.isPressed
            )
    }
}

/// Azione secondaria: vetro neutro con testo rosso ciliegia.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(16, weight: .semibold))
            .foregroundStyle(Theme.brand)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity)
            .contentShape(.capsule)
            .glassEffect(.regular.interactive(), in: .capsule)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .offset(y: configuration.isPressed ? 1 : 0)
            .animation(
                configuration.isPressed ? Theme.Motion.quick : Theme.Motion.signature,
                value: configuration.isPressed
            )
    }
}

// MARK: - Dichiarazione dei contenuti generati dall'AI

/// Ricette, verdetti sui menu, swap e foto dei piatti li scrive un
/// modello, non una redazione: Apple chiede che sia dichiarato dove
/// l'utente li legge. Un solo componente per tutta l'app, così
/// l'etichetta è sempre la stessa e nessuna schermata se la dimentica.
struct AIGeneratedBadge: View {
    enum Surface {
        case light   // su card e sfondi chiari
        case overlay // sopra una foto
    }

    var label: String = "AI-generated"
    var surface: Surface = .light

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "sparkles")
                .font(.system(size: 9, weight: .bold))
            Text(label)
                .font(.system(size: 10, weight: .bold, design: .rounded))
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(background, in: .capsule)
        .accessibilityLabel("\(label) content")
    }

    private var foreground: Color {
        switch surface {
        case .light: Theme.subtle
        case .overlay: .white.opacity(0.95)
        }
    }

    private var background: some ShapeStyle {
        switch surface {
        case .light: AnyShapeStyle(Theme.ink.opacity(0.07))
        case .overlay: AnyShapeStyle(.black.opacity(0.42))
        }
    }
}

/// Versione distesa, per il fondo di una schermata che è per intero
/// il risultato di una generazione.
struct AIGeneratedNote: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "sparkles")
                .font(.system(size: 11, weight: .bold))
                .padding(.top, 1)
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(Theme.body(11.5, weight: .medium))
        .foregroundStyle(Theme.subtle)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Superfici

/// Card di vetro: la superficie standard che galleggia sul mesh.
struct GlassCard: ViewModifier {
    var cornerRadius: CGFloat = Theme.cornerRadius

    func body(content: Content) -> some View {
        content
            .glassEffect(.regular, in: .rect(cornerRadius: cornerRadius))
    }
}

/// Card di vetro tinta (per stati selezionati o accenti).
struct TintedGlassCard: ViewModifier {
    let tint: Color
    var cornerRadius: CGFloat = Theme.cornerRadius

    func body(content: Content) -> some View {
        content
            .glassEffect(.regular.tint(tint), in: .rect(cornerRadius: cornerRadius))
    }
}

extension View {
    func vegoCard(cornerRadius: CGFloat = Theme.cornerRadius) -> some View {
        modifier(GlassCard(cornerRadius: cornerRadius))
    }

    func vegoTintedCard(_ tint: Color, cornerRadius: CGFloat = Theme.cornerRadius) -> some View {
        modifier(TintedGlassCard(tint: tint, cornerRadius: cornerRadius))
    }

    /// Chip di vetro a capsula (legende, tag, contatori).
    func glassChip(tint: Color? = nil, interactive: Bool = false) -> some View {
        Group {
            switch (tint, interactive) {
            case (nil, false): self.glassEffect(.regular, in: .capsule)
            case (nil, true): self.glassEffect(.regular.interactive(), in: .capsule)
            case (let color?, false): self.glassEffect(.regular.tint(color), in: .capsule)
            case (let color?, true): self.glassEffect(.regular.tint(color).interactive(), in: .capsule)
            }
        }
    }
}
