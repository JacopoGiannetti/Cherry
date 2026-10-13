import SwiftUI

// La mascotte (le ciliegie del logo) in versione viva: resta sul
// posto, ma respira, si guarda intorno e ogni tanto salta. Playful
// contenuto (skill motion): overshoot ~15%, un solo eroe in movimento.
struct CherryGlassIcon: View {
    var size: CGFloat = 128
    var animated: Bool = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let shadowTint = Color(red: 0.62, green: 0.08, blue: 0.16)

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion || !animated)) { context in
            artwork(at: context.date.timeIntervalSinceReferenceDate)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func artwork(at t: TimeInterval) -> some View {
        let live = animated && !reduceMotion
        let pose = live ? Self.pose(at: t) : .idle
        let cycle = live ? t.truncatingRemainder(dividingBy: 6.4) : 0
        let sheen = CGFloat(-0.3 + 1.6 * min(1, max(0, (cycle - 3.1) / 1.35)))

        return Image("CherryMascot")
            .resizable()
            .scaledToFit()
            .offset(x: pose.glance * size * 0.018)
            .overlay { specular(sheen: sheen) }
            .scaleEffect(x: pose.squashX, y: pose.squashY, anchor: .bottom)
            .rotationEffect(.degrees(pose.lean), anchor: .bottom)
            .offset(y: pose.bob + pose.hop)
            .shadow(
                color: Self.shadowTint.opacity(0.26),
                radius: size * (0.10 + 0.04 * pose.squashX),
                y: size * 0.055 + pose.hop * 0.15
            )
    }

    // MARK: - Regia (ciclo 8 s)

    /// Un giro: ozio → guarda a destra → a sinistra → ammicca → saltello.
    private struct Pose {
        var lean: Double
        var bob: CGFloat
        var hop: CGFloat
        var look: CGFloat
        var nod: CGFloat
        var glance: CGFloat
        var blink: CGFloat
        var squashX: CGFloat
        var squashY: CGFloat
        static let idle = Pose(lean: 0, bob: 0, hop: 0, look: 0, nod: 0, glance: 0, blink: 1, squashX: 1, squashY: 1)
    }

    private static func pose(at time: TimeInterval) -> Pose {
        let t = time.truncatingRemainder(dividingBy: 8.0)
        let bob = CGFloat(4.8 * sin(time * 1.35))
        let breathe = 1 + 0.018 * sin(time * 1.2)

        // Guarda: due cenni, come se seguisse qualcosa.
        let lookRight = bump(t, from: 1.7, dur: 0.85)
        let lookLeft = bump(t, from: 2.85, dur: 0.9)
        let look = CGFloat(lookRight - lookLeft)
        let lean = 9.5 * lookRight - 8.5 * lookLeft + 2.2 * sin(time * 0.7)
        let glance = look
        let nod = CGFloat(0.35 * sin(time * 0.9) - 0.25 * lookRight)

        // Ammiccata secca (due frame).
        let blink = CGFloat(1 - 0.92 * bump(t, from: 4.55, dur: 0.16))

        // Saltello: anticipa (schiaccia), sale, atterra (schiaccia di nuovo).
        let hopWind = bump(t, from: 6.15, dur: 0.16)
        let hopAir = bump(t, from: 6.28, dur: 0.38)
        let hopLand = bump(t, from: 6.62, dur: 0.22)
        let hop = CGFloat(-sizeHop * hopAir)
        let squashX = CGFloat(breathe + 0.07 * hopWind + 0.10 * hopLand)
        let squashY = CGFloat(breathe - 0.08 * hopWind - 0.11 * hopLand + 0.06 * hopAir)

        return Pose(
            lean: lean,
            bob: bob,
            hop: hop,
            look: look + CGFloat(0.45 * sin(time * 0.48)),
            nod: nod,
            glance: glance,
            blink: max(0.08, blink),
            squashX: squashX,
            squashY: squashY
        )
    }

    /// Altezza del saltello, in punti: piccola, resta “lì”.
    private static let sizeHop: CGFloat = 11

    /// 0→1→0 in `dur` secondi, a partire da `from`.
    private static func bump(_ t: Double, from: Double, dur: Double) -> Double {
        let u = (t - from) / dur
        guard u > 0, u < 1 else { return 0 }
        return sin(u * .pi)
    }

    private func specular(sheen: CGFloat) -> some View {
        LinearGradient(
            colors: [.clear, .white.opacity(0.38), .clear],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .frame(width: size * 0.38, height: size * 1.6)
        .rotationEffect(.degrees(22))
        .offset(x: (sheen - 0.5) * size * 1.15)
        .mask(
            Image("CherryMascot")
                .resizable()
                .scaledToFit()
        )
        .opacity(sheen > 0 && sheen < 1 ? 1 : 0)
        .allowsHitTesting(false)
    }
}
