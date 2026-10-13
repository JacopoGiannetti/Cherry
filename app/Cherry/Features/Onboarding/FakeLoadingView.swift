import SwiftUI

// Beat 3.5: fake loading reso credibile — i nodi attorno alla pianta
// sono le RISPOSTE VERE dell'utente ("no mushrooms", "Thai", "loves
// ramen"). Uno alla volta si collegano al centro: l'algoritmo che
// impara chi sei, visto succedere. Costo: zero.
struct FakeLoadingView: View {
    let profile: TasteProfile
    let onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Quanti nodi sono già collegati alla pianta.
    @State private var connected = 0
    /// Tutti collegati: la pianta "prende".
    @State private var bloomed = false
    @State private var drift = false

    /// Un segnale del profilo: cosa dice, dove sta in orbita.
    private struct Signal: Identifiable {
        let id: Int
        let emoji: String
        let label: String
        let log: String
        let angle: Double      // gradi, 0 in cima, orario
        let radius: CGFloat
    }

    /// Nodi di riserva quando il quiz è stato saltato (o quasi):
    /// senza questi l'orbita resta un solo "vegan" e sembra rotta.
    private static let defaultSignals: [(String, String, String)] = [
        ("🍽️", "weeknight meals", "Planning weeknight dinners…"),
        ("🛒", "grocery lists", "Shaping your grocery lists…"),
        ("🌍", "mixed kitchens", "Calibrating cuisines…"),
        ("📖", "real recipes", "Opening recipes from every cuisine…"),
        ("⏱️", "balanced cooking", "Matching cooking effort…"),
        ("🥬", "fresh produce", "Prioritizing fresh produce…"),
    ]

    private var signals: [Signal] {
        var raw: [(String, String, String)] = []
        for exclusion in profile.exclusions.prefix(3) {
            raw.append(("🚫", "no \(exclusion)", "Excluding \(exclusion)…"))
        }
        switch profile.spiceTolerance {
        case "mild": raw.append(("🌿", "mild heat", "Keeping the chili on the side…"))
        case "hot": raw.append(("🔥", "bring the fire", "Turning the heat up…"))
        default: raw.append(("🌶️", "some kick", "Adding a little warmth…"))
        }
        // Niente riga sulla dieta: la si scieglie più tardi, e qui
        // annuncerebbe il default invece di una scelta dell'utente.
        raw.append(("🥗", "your taste", "Matching swaps to your taste…"))

        // Pochi no-go o quiz saltato: si riempie l'orbita senza
        // inventare gusti che l'utente non ha dichiarato.
        if raw.count < 6 {
            for fallback in Self.defaultSignals where raw.count < 6 {
                let taken = raw.contains { $0.1.compare(fallback.1, options: .caseInsensitive) == .orderedSame }
                if !taken { raw.append(fallback) }
            }
        }
        raw = Array(raw.prefix(7))

        // Distribuiti sull'orbita partendo da in alto a destra, raggi
        // alternati così le etichette vicine non si toccano.
        let count = raw.count
        return raw.enumerated().map { index, item in
            let angle = -60 + (300.0 / Double(max(count - 1, 1))) * Double(index)
            let radius: CGFloat = index.isMultiple(of: 2) ? 132 : 156
            return Signal(id: index, emoji: item.0, label: item.1, log: item.2, angle: angle, radius: radius)
        }
    }

    private var totalSteps: Int { signals.count + 1 }

    private var currentLog: String {
        if bloomed { return "Your perfect experience is ready ✓" }
        if connected == 0 { return "Waking up the kitchen…" }
        return signals[min(connected, signals.count) - 1].log
    }

    var body: some View {
        VStack(spacing: 26) {
            Spacer()

            orbit

            VStack(spacing: 14) {
                Text("Building Cherry around you")
                    .font(Theme.display(26))
                    .foregroundStyle(Theme.brandGradient)

                progressBar
                    .padding(.horizontal, 64)

                Text(currentLog)
                    .font(Theme.body(14, weight: .medium))
                    .foregroundStyle(bloomed ? Theme.brand : Theme.subtle)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .id(currentLog)
                    .transition(.push(from: .bottom).combined(with: .opacity))
                    .frame(height: 20)
                    .padding(.horizontal, 32)
            }
            .animation(Theme.Motion.signature, value: currentLog)

            Spacer()
        }
        .onAppear(perform: run)
    }

    // MARK: - Orbita

    private var orbit: some View {
        ZStack {
            // Le due orbite, appena accennate: la struttura su cui
            // i segnali si dispongono.
            ForEach([132, 156] as [CGFloat], id: \.self) { radius in
                Ellipse()
                    .strokeBorder(Theme.brand.opacity(0.12), style: StrokeStyle(lineWidth: 1, dash: [3, 6]))
                    .frame(width: radius * 2 * Self.squeezeX, height: radius * 2 * Self.squeezeY)
            }

            // Fili: dal nodo al centro, si disegnano quando si collega.
            ForEach(signals) { signal in
                Connection(to: point(for: signal))
                    .trim(from: 0, to: signal.id < connected ? 1 : 0)
                    .stroke(
                        LinearGradient(
                            colors: [Theme.brand.opacity(0.65), Theme.brand.opacity(0.15)],
                            startPoint: .center, endPoint: .bottom
                        ),
                        style: StrokeStyle(lineWidth: 1.5, lineCap: .round)
                    )
                    .animation(Theme.Motion.slow, value: connected)
            }

            // Bagliore finale dietro la pianta.
            Circle()
                .fill(
                    RadialGradient(
                        colors: [Theme.mint.opacity(0.75), Theme.mint.opacity(0)],
                        center: .center, startRadius: 10, endRadius: 110
                    )
                )
                .frame(width: 220, height: 220)
                .scaleEffect(bloomed ? 1.15 : 0.7)
                .opacity(bloomed ? 1 : 0.35)
                .animation(Theme.Motion.celebration, value: bloomed)

            // Onda che parte dal centro a ogni collegamento.
            if connected > 0 && !bloomed {
                Circle()
                    .strokeBorder(Theme.brand.opacity(0.35), lineWidth: 1.5)
                    .frame(width: 90, height: 90)
                    .modifier(Ripple())
                    .id(connected)
            }

            CherryLottieView(animation: .tomatoPlant, size: 210)
                .scaleEffect(bloomed ? 1.06 : 1)
                .animation(Theme.Motion.celebration, value: bloomed)

            ForEach(signals) { signal in
                node(signal)
                    .position(point(for: signal, in: Self.orbitSize))
            }
        }
        .frame(width: Self.orbitSize.width, height: Self.orbitSize.height)
    }

    /// L'orbita è un'ellisse alta: sullo schermo di un telefono lo
    /// spazio è in verticale, e le etichette larghe stanno ai lati.
    private static let orbitSize = CGSize(width: 360, height: 380)
    private static let squeezeX: CGFloat = 0.78
    private static let squeezeY: CGFloat = 1.0

    private func node(_ signal: Signal) -> some View {
        let isConnected = signal.id < connected
        let isNext = signal.id == connected && !bloomed
        return HStack(spacing: 5) {
            Text(signal.emoji)
                .font(.system(size: 12))
            Text(signal.label)
                .font(Theme.body(12, weight: .semibold))
                .foregroundStyle(isConnected ? Theme.ink : Theme.subtle.opacity(0.85))
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(maxWidth: 160)
        .glassEffect(
            isConnected ? .regular.tint(Theme.mint.opacity(0.55)) : .regular,
            in: .capsule
        )
        .overlay {
            Capsule().strokeBorder(
                isConnected ? Theme.brand.opacity(0.45) : Theme.ink.opacity(0.05),
                lineWidth: 1
            )
        }
        .scaleEffect(isConnected ? 1 : (isNext ? 0.97 : 0.9))
        .opacity(isConnected ? 1 : (isNext ? 0.9 : 0.6))
        // Respiro d'orbita: ognuno con la sua fase, mai in blocco.
        .offset(y: reduceMotion ? 0 : (drift ? 3 : -3) * (signal.id.isMultiple(of: 2) ? 1 : -1))
        .animation(
            reduceMotion ? nil : Theme.Motion.ambient.delay(Double(signal.id) * 0.3),
            value: drift
        )
        .animation(Theme.Motion.signature, value: connected)
    }

    /// Punto sull'ellisse, relativo al centro.
    private func point(for signal: Signal) -> CGPoint {
        let radians = (signal.angle - 90) * .pi / 180
        return CGPoint(
            x: signal.radius * Self.squeezeX * cos(radians),
            y: signal.radius * Self.squeezeY * sin(radians)
        )
    }

    private func point(for signal: Signal, in size: CGSize) -> CGPoint {
        let p = point(for: signal)
        return CGPoint(x: size.width / 2 + p.x, y: size.height / 2 + p.y)
    }

    // MARK: - Barra

    private var progressBar: some View {
        GeometryReader { geo in
            let fraction = bloomed ? 1 : CGFloat(connected) / CGFloat(totalSteps)
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.ink.opacity(0.07))
                Capsule()
                    .fill(Theme.brandGradient)
                    .frame(width: max(8, geo.size.width * fraction))
            }
        }
        .frame(height: 5)
        .animation(Theme.Motion.slow, value: connected)
        .animation(Theme.Motion.slow, value: bloomed)
    }

    // MARK: - Sequenza

    private func run() {
        drift = true
        let count = signals.count
        for step in 1...count {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5 + Double(step) * 0.6) {
                withAnimation(Theme.Motion.signature) { connected = step }
                Haptics.light()
            }
        }
        let finale = 0.5 + Double(count) * 0.6 + 0.7
        DispatchQueue.main.asyncAfter(deadline: .now() + finale) {
            withAnimation(Theme.Motion.celebration) { bloomed = true }
            Haptics.success()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + finale + 1.3) {
            onDone()
        }
    }
}

/// Segmento dal centro del frame a un punto relativo al centro.
private struct Connection: Shape {
    let to: CGPoint

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        path.move(to: center)
        path.addLine(to: CGPoint(x: center.x + to.x, y: center.y + to.y))
        return path
    }
}

/// Un'onda sola: parte piccola e piena, si allarga e svanisce.
private struct Ripple: ViewModifier {
    @State private var expanded = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(expanded ? 2.6 : 0.8)
            .opacity(expanded ? 0 : 0.9)
            .onAppear {
                withAnimation(.easeOut(duration: 0.9)) { expanded = true }
            }
    }
}
