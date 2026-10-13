import SwiftUI

// Card "sasso": vetro tinto, non lastre bianche. Il pastello è
// solo un tint del glass, così si vede lo sfondo attraverso.

extension Theme {
    /// Quanto un sasso è rotondo. Più del cornerRadius delle lastre.
    static let pebbleRadius: CGFloat = 36
}

/// Soft pill: raggio alto e uguale, come le card degli screen.
/// Non angoli storti — un rettangolo così tondo che sembra un sasso.
struct CherryPebbleShape: Shape {
    var hero = true

    func path(in rect: CGRect) -> Path {
        RoundedRectangle(cornerRadius: hero ? 40 : 28, style: .continuous)
            .path(in: rect)
    }
}

/// Superficie dei contenuti in home: pastello, aria, un solo accento.
struct CherryPebbleCard<Content: View>: View {
    var wash: Color
    var accent: Color
    var height: CGFloat? = nil
    var radius: CGFloat = Theme.pebbleRadius
    var blobs: CherryPastelBlobs.Layout = .garden

    @ViewBuilder var content: () -> Content

    var body: some View {
        let shape = CherryPebbleShape(hero: true)
        ZStack(alignment: .topLeading) {
            CherryPastelBlobs(accent: accent, layout: blobs)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: height)
        .clipShape(shape)
        .contentShape(shape)
        // Vetro fermo: il feedback al tocco lo dà CherryCardButtonStyle.
        .glassEffect(.regular.tint(wash.opacity(0.55)), in: shape)
    }
}

/// Card con un'illustrazione vera dentro. L'immagine riempie TUTTA la
/// card, da bordo a bordo: l'unico taglio è la forma della card, mai
/// un bordo dell'immagine a vista. A sinistra un velo pastello la fa
/// sfumare sotto il testo.
struct CherryIllustratedCard<Content: View>: View {
    var wash: Color
    var image: String
    var height: CGFloat
    /// Quale parte dell'illustrazione tenere quando riempie la card
    /// (es. `.bottom` per il fogliame, `.center` per una scena).
    var imageAlignment: Alignment = .center
    /// Specchia l'illustrazione: il soggetto va dove non c'è testo.
    var mirrored = false
    /// Per illustrazioni su fondo bianco: il bianco si fonde nel
    /// pastello (multiply), così non si vede il rettangolo dell'immagine.
    var blendsWhite = false
    /// Dove finisce il velo pastello (0…1 della larghezza).
    var fadeEnd: CGFloat = 0.7

    @ViewBuilder var content: () -> Content

    var body: some View {
        let shape = CherryPebbleShape(hero: true)
        ZStack(alignment: .leading) {
            GeometryReader { geo in
                ZStack {
                    if blendsWhite {
                        Rectangle().fill(wash)
                    }

                    Image(image)
                        .resizable()
                        .scaledToFill()
                        .scaleEffect(x: mirrored ? -1 : 1, y: 1)
                        .frame(width: geo.size.width, height: geo.size.height, alignment: imageAlignment)
                        .clipped()
                        .blendMode(blendsWhite ? .multiply : .normal)

                    LinearGradient(
                        stops: [
                            .init(color: wash, location: 0),
                            .init(color: wash, location: max(0, fadeEnd - 0.36)),
                            .init(color: wash.opacity(0), location: fadeEnd),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)

            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: height)
        .clipShape(shape)
        .contentShape(shape)
        .glassEffect(.regular.tint(wash.opacity(0.55)), in: shape)
    }
}

/// Un solo disco fermo, sempre nello stesso angolo.
/// Niente macchie che si muovono: la card resta ordinata.
struct CherryPastelBlobs: View {
    enum Layout {
        case garden   // basso a destra
        case sunrise  // alto a destra
        case meadow   // alto a sinistra
        case calm     // basso a sinistra
    }

    var accent: Color
    var layout: Layout = .garden

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height) * 0.72
            Circle()
                .fill(Color.white.opacity(0.28))
                .frame(width: side, height: side)
                .position(anchor(in: geo.size, inset: side * 0.18))
        }
        .allowsHitTesting(false)
    }

    private func anchor(in size: CGSize, inset: CGFloat) -> CGPoint {
        switch layout {
        case .garden: CGPoint(x: size.width - inset, y: size.height - inset)
        case .sunrise: CGPoint(x: size.width - inset, y: inset)
        case .meadow: CGPoint(x: inset, y: inset)
        case .calm: CGPoint(x: inset, y: size.height - inset)
        }
    }
}

/// Marchio della card: un simbolo in un riquadro morbido.
/// Niente sticker: tiene il tono da prodotto, non da adesivo.
struct CherryCardMark: View {
    var symbol: String
    var tint: Color
    var size: CGFloat = 72

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.36, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .glassEffect(
                .regular.tint(tint.opacity(0.22)),
                in: .rect(cornerRadius: size * 0.32)
            )
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Pulsante tondo di vetro: l'unico vetro sulla card, l'azione.
struct CherryGlassOrb: View {
    var symbol: String
    var tint: Color = Theme.brand
    var size: CGFloat = 46
    var ink: Color = .white

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.36, weight: .bold))
            .foregroundStyle(ink)
            .frame(width: size, height: size)
            .contentShape(.circle)
            .glassEffect(.regular.tint(tint.opacity(0.92)).interactive(), in: .circle)
    }
}

/// Riga d'azione in basso a una card: una parola, una freccia.
struct CherryCardGo: View {
    var title: String
    var tint: Color

    var body: some View {
        HStack(spacing: 5) {
            Text(title)
            Image(systemName: "arrow.right")
        }
        .font(Theme.body(13, weight: .bold))
        .foregroundStyle(tint)
    }
}

// MARK: - Fogli (stesso linguaggio degli screen: aria, riga, pastello)

/// Titolo da foglio: grande, inchiostro, poche parole sotto.
struct CherrySheetHeader: View {
    var title: String
    var subtitle: String? = nil
    var chip: String? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(Theme.display(30))
                    .foregroundStyle(Theme.ink)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.body(14, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                }
            }
            Spacer(minLength: 8)
            if let chip {
                Text(chip)
                    .font(Theme.body(12, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .glassEffect(.regular.tint(Theme.butter.opacity(0.45)), in: .capsule)
            }
        }
    }
}

/// Campo pill: ricerca o input, come la search bar degli screen.
struct CherrySearchPill<Trailing: View>: View {
    var icon: String = "magnifyingglass"
    var placeholder: String
    @Binding var text: String
    var submit: (() -> Void)? = nil
    @ViewBuilder var trailing: () -> Trailing

    init(
        icon: String = "magnifyingglass",
        placeholder: String,
        text: Binding<String>,
        submit: (() -> Void)? = nil,
        @ViewBuilder trailing: @escaping () -> Trailing
    ) {
        self.icon = icon
        self.placeholder = placeholder
        _text = text
        self.submit = submit
        self.trailing = trailing
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.subtle)
            TextField(placeholder, text: $text)
                .font(Theme.body(16, weight: .medium))
                .foregroundStyle(Theme.ink)
                .submitLabel(.done)
                .onSubmit { submit?() }
            trailing()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .glassEffect(.regular.interactive(), in: .capsule)
    }
}

extension CherrySearchPill where Trailing == EmptyView {
    init(icon: String = "magnifyingglass", placeholder: String, text: Binding<String>, submit: (() -> Void)? = nil) {
        self.init(icon: icon, placeholder: placeholder, text: text, submit: submit) { EmptyView() }
    }
}

/// Riga "Ongoing": thumbnail tonda, titolo, sottotitolo, meta a destra.
struct CherryMediaRow<Thumb: View, Trailing: View>: View {
    var wash: Color = .white
    @ViewBuilder var thumb: () -> Thumb
    var title: String
    var subtitle: String
    var struck: Bool = false
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 14) {
            thumb()
                .frame(width: 58, height: 58)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.body(16, weight: .bold))
                    .foregroundStyle(struck ? Theme.subtle : Theme.ink)
                    .strikethrough(struck, color: Theme.subtle)
                    .lineLimit(2)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(Theme.body(13, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)
            trailing()
        }
        .padding(14)
        .glassEffect(.regular.tint(wash.opacity(0.45)), in: CherryPebbleShape(hero: false))
    }
}

struct CherrySheetEmpty: View {
    var wash: Color
    var symbol: String
    var tint: Color = Theme.brand
    var title: String
    var subtitle: String

    var body: some View {
        VStack(spacing: 14) {
            CherryCardMark(symbol: symbol, tint: tint, size: 72)
            Text(title)
                .font(Theme.title(20))
                .foregroundStyle(Theme.ink)
            Text(subtitle)
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 36)
        .frame(maxWidth: .infinity)
        .glassEffect(.regular.tint(wash.opacity(0.5)), in: CherryPebbleShape(hero: true))
    }
}

// MARK: - Magneti da frigo

/// Una parola da attaccare a una frase: tessera pastello, inchiostro pieno.
struct WordMagnet: Identifiable, Equatable {
    let id: String
    let word: String
    let wash: Color
    let ink: Color
}

/// La tessera: fondo pastello, bordo spesso sotto come un magnete vero,
/// un filo di luce sopra. Niente vetro: è un oggetto, non una superficie.
struct MagnetTile: View {
    enum Size { case regular, large }

    let magnet: WordMagnet
    var size: Size = .regular

    private var radius: CGFloat { size == .large ? 16 : 12 }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        Text(magnet.word)
            .font(size == .large ? Theme.display(30) : Theme.body(17, weight: .bold))
            .foregroundStyle(magnet.ink)
            .padding(.horizontal, size == .large ? 18 : 14)
            .padding(.vertical, 9)
            .background {
                shape
                    .fill(magnet.wash)
                    .shadow(color: magnet.ink.opacity(0.24), radius: 0, x: 0, y: size == .large ? 3 : 2)
            }
            .overlay { shape.strokeBorder(.white.opacity(0.7), lineWidth: 1) }
            .shadow(color: Theme.ink.opacity(0.08), radius: 8, y: 4)
            .fixedSize()
    }
}

/// "Make it ___": la frase con il buco e, sotto, le parole come magneti
/// da frigo, ognuno storto a modo suo. Toccane uno e vola nel buco
/// raddrizzandosi; quello che c'era torna al suo posto. Dove la tessera
/// è partita resta il segno, così il frigo non si risistema sotto il dito.
struct MagnetSentence: View {
    let lead: String
    let magnets: [WordMagnet]
    @Binding var selection: String?
    /// Frase e buco sulla stessa riga, tessere normali: per quando la
    /// frase sta dentro una schermata invece di esserne il centro.
    var compact = false
    /// Cosa si legge nel buco vuoto, se il vuoto ha già un significato.
    var emptyWord: String?

    @Namespace private var fridge
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    private var picked: WordMagnet? { magnets.first { $0.id == selection } }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 16 : 26) {
            Group {
                if compact {
                    HStack(spacing: 10) {
                        Text(lead)
                            .font(Theme.display(26))
                            .foregroundStyle(Theme.ink)
                        slot
                    }
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(lead)
                            .font(Theme.display(34))
                            .foregroundStyle(Theme.ink)
                        slot
                    }
                }
            }
            .accessibilityElement(children: .combine)

            MagnetWrap(spacing: compact ? 10 : 12) {
                ForEach(magnets) { magnet in
                    trayTile(magnet)
                }
            }
        }
    }

    @ViewBuilder
    private var slot: some View {
        if let picked {
            Button { choose(nil) } label: {
                MagnetTile(magnet: picked, size: compact ? .regular : .large)
                    .matchedGeometryEffect(id: picked.id, in: fridge)
            }
            .buttonStyle(MagnetPressStyle())
            .accessibilityLabel("\(lead) \(picked.word)")
            .accessibilityHint("Takes the word off")
        } else {
            Text(emptyWord ?? "…")
                .font(emptyWord == nil ? Theme.display(compact ? 22 : 30) : Theme.body(compact ? 15 : 20, weight: .bold))
                .foregroundStyle(Theme.ink.opacity(emptyWord == nil ? 0.25 : 0.4))
                .padding(.horizontal, emptyWord == nil ? 0 : 14)
                .frame(minWidth: compact ? 92 : 136, minHeight: compact ? 42 : 58)
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                        .foregroundStyle(Theme.ink.opacity(breathing ? 0.28 : 0.14))
                }
                .onAppear {
                    guard !reduceMotion else { return }
                    withAnimation(Theme.Motion.ambient) { breathing = true }
                }
                .accessibilityLabel(emptyWord.map { "\(lead) \($0)" } ?? "Empty, pick a word below")
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
                .accessibilityHidden(true)
        } else {
            Button { choose(magnet.id) } label: {
                MagnetTile(magnet: magnet)
                    .matchedGeometryEffect(id: magnet.id, in: fridge)
                    .rotationEffect(tilt(magnet))
            }
            .buttonStyle(MagnetPressStyle())
            .accessibilityLabel("\(lead) \(magnet.word)")
        }
    }

    private func choose(_ id: String?) {
        Haptics.selection()
        let animation = reduceMotion ? .easeOut(duration: Theme.Motion.standard) : Theme.Motion.signature
        withAnimation(animation) { selection = id }
    }

    /// Ogni magnete storto sempre allo stesso modo, fra -3° e +3°.
    private func tilt(_ magnet: WordMagnet) -> Angle {
        guard !reduceMotion else { return .zero }
        let seed = magnet.id.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return .degrees(Double(seed % 7) - 3)
    }
}

/// Schiacciata breve sotto il dito, come staccare un magnete.
struct MagnetPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.93 : 1)
            .animation(configuration.isPressed ? Theme.Motion.quick : Theme.Motion.signature, value: configuration.isPressed)
    }
}

/// Le tessere vanno a capo da sole, allineate a sinistra.
struct MagnetWrap: Layout {
    var spacing: CGFloat = 10

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(in: proposal.width ?? 0, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(in: bounds.width, subviews: subviews)
        for (index, origin) in rows.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
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

enum CherryRowWash {
    static let palette: [Color] = [
        Theme.mint.opacity(0.35),
        Theme.mint.opacity(0.45),
        Theme.butter.opacity(0.55),
        Theme.sky.opacity(0.5),
        Theme.peach.opacity(0.45),
        Theme.lavender.opacity(0.45),
    ]

    static func at(_ index: Int) -> Color {
        palette[index % palette.count]
    }
}
