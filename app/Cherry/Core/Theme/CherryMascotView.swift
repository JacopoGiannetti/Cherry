import SwiftUI

// La mascotte di Cherry: le ciliegie dell'icona, con la loro faccia.
// Un asset solo (`CherryMascot` in Assets) e poche pose, così resta lo
// stesso personaggio da un capo all'altro dell'app: saluta (Hello,
// tour), ascolta (quiz), fa capolino (founder), lavora (loading),
// festeggia (profilo pronto). Regola: mai due mascotte sulla stessa
// schermata, e il wordmark resta il marchio — lei è il personaggio.
struct CherryMascotView: View {
    enum Pose: Equatable {
        /// Ferma, respira appena.
        case still
        /// Saluta: si inclina di qua e di là, con la manina.
        case wave
        /// Ascolta: testa inclinata, respiro lento.
        case listen
        /// Festeggia: tre saltelli con schiacciamento all'atterraggio.
        case cheer
    }

    var size: CGFloat = 120
    var pose: Pose = .still
    /// Quando diventa true entra (scala + opacità) e parte la posa.
    /// `true` da subito: parte all'onAppear.
    var active: Bool = true
    /// Ogni cambio di valore è un colpetto (schiaccia e rimbalza): per
    /// reagire a un tasto premuto o a una riga che arriva.
    var nudge: Int = 0

    @State private var shown = false
    @State private var posing = false
    @State private var hand = false
    @State private var tilt = false
    @State private var bob = false
    @State private var hop = false
    @State private var squash = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Image("CherryMascot")
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .shadow(color: Theme.brand.opacity(0.25), radius: size * 0.11, y: size * 0.06)
                .rotationEffect(.degrees(rotation), anchor: .bottom)

            Text("👋")
                .font(.system(size: size * 0.28))
                .rotationEffect(.degrees(tilt ? 18 : -14), anchor: .bottomTrailing)
                .offset(x: size * 0.18, y: -size * 0.02)
                .opacity(hand ? 1 : 0)
                .scaleEffect(hand ? 1 : 0.4, anchor: .bottomLeading)
                .allowsHitTesting(false)
        }
        // Lo schiacciamento parte dai piedi: è un atterraggio, non uno zoom.
        .scaleEffect(x: squash ? 1.08 : 1, y: squash ? 0.92 : 1, anchor: .bottom)
        .offset(y: (bob ? -size * 0.025 : size * 0.025) + (hop ? -size * 0.14 : 0))
        .scaleEffect(shown ? 1 : 0.55)
        .opacity(shown ? 1 : 0)
        .onAppear { if active { enter() } }
        .onChange(of: active) { _, isActive in if isActive { enter() } }
        .onChange(of: pose) { _, _ in perform() }
        .onChange(of: nudge) { _, _ in bump() }
        .accessibilityHidden(true)
    }

    private var rotation: Double {
        switch pose {
        case .still: 0
        case .wave: posing ? (tilt ? 7 : -7) : 0
        case .listen: posing ? (tilt ? -11 : -7) : 0
        case .cheer: posing ? (tilt ? 4 : -4) : 0
        }
    }

    // MARK: - Regia

    private func enter() {
        guard !shown else { return }
        withAnimation(Theme.Motion.celebration) { shown = true }
        // Prima arriva, poi fa la sua cosa: anticipazione, non tutto insieme.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { perform() }
        withAnimation(Theme.Motion.ambient.delay(0.4)) { bob = true }
    }

    private func perform() {
        switch pose {
        case .still:
            withAnimation(Theme.Motion.signature) { posing = false; hand = false; tilt = false }

        case .wave:
            // Cinque oscillazioni di saluto, poi torna dritta e respira.
            withAnimation(Theme.Motion.quick) { posing = true; hand = true }
            withAnimation(.easeInOut(duration: 0.32).repeatCount(5, autoreverses: true)) { tilt = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.75) {
                withAnimation(Theme.Motion.signature) { tilt = false }
            }

        case .listen:
            // Testa inclinata che oscilla piano: sta seguendo il discorso.
            withAnimation(Theme.Motion.signature) { posing = true }
            withAnimation(.easeInOut(duration: 1.9).repeatForever(autoreverses: true).delay(0.2)) { tilt = true }

        case .cheer:
            withAnimation(Theme.Motion.quick) { posing = true }
            for index in 0..<3 {
                let start = 0.05 + Double(index) * 0.38
                DispatchQueue.main.asyncAfter(deadline: .now() + start) {
                    withAnimation(.easeOut(duration: 0.17)) { hop = true; tilt.toggle() }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + start + 0.17) {
                    withAnimation(.easeIn(duration: 0.13)) { hop = false }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + start + 0.30) {
                    withAnimation(Theme.Motion.quick) { squash = true }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + start + 0.40) {
                    withAnimation(.spring(duration: 0.3, bounce: 0.45)) { squash = false }
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
                withAnimation(Theme.Motion.signature) { tilt = false }
            }
        }
    }

    private func bump() {
        guard shown else { return }
        withAnimation(Theme.Motion.quick) { squash = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.11) {
            withAnimation(.spring(duration: 0.3, bounce: 0.45)) { squash = false }
        }
    }
}

// MARK: - Fumetti

/// Il fumetto accanto alla mascotte: parlato (coda a punta) o pensato
/// (due bollicine). Sempre piccolo: è lei che parla, non un dialogo.
struct MascotBubble<Content: View>: View {
    enum Style { case speech, thought }
    /// Da che lato sta la mascotte, cioè dove punta la coda.
    enum Tail { case bottomLeading, bottomTrailing }

    var style: Style = .speech
    var tail: Tail = .bottomTrailing
    var tint: Color = .white
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(tint, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(alignment: tail == .bottomTrailing ? .bottomTrailing : .bottomLeading) {
                tailView
            }
            .shadow(color: Theme.ink.opacity(0.12), radius: 10, y: 4)
    }

    @ViewBuilder
    private var tailView: some View {
        let flip: CGFloat = tail == .bottomTrailing ? 1 : -1
        switch style {
        case .speech:
            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                .fill(tint)
                .frame(width: 12, height: 12)
                .rotationEffect(.degrees(45))
                .offset(x: -8 * flip, y: 5)
        case .thought:
            HStack(spacing: 3) {
                Circle().fill(tint).frame(width: 7, height: 7)
                Circle().fill(tint).frame(width: 4.5, height: 4.5)
            }
            .environment(\.layoutDirection, tail == .bottomTrailing ? .leftToRight : .rightToLeft)
            .offset(x: 4 * flip, y: 11)
        }
    }
}
