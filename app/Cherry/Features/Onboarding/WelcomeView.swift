import SwiftUI

// Beat 3.1 — una scena sola, grammatica liquid-glass (studio Wabi,
// MOTION_SPEC di Appllama), identità Cherry: crema, pastelli, il nostro
// logo. A riposo: marchio in alto, cupola di vetro sul bordo basso,
// "Swipe up to enter" dentro la cupola. Lo swipe la solleva: sale e si
// stringe finché è un "+"; la luce si raccoglie sulla corona quanto più
// forte spingi. Atterrata, dal "+" sgorgano gli sticker, sotto compare
// il claim, in fondo "Let's go". Solo a quel tap sboccia il giardino.
//
// Il vetro non è un materiale: sono due shader Metal (LiquidGlass.metal).
// La lente rifrange davvero il fondale — mesh, orizzonte, marchio e
// sticker — e il corpo disegna bordo, sheen e caustico sopra.
struct WelcomeView: View {
    let onStart: () -> Void

    @EnvironmentObject private var appState: AppState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 0 = cupola a terra, 1 = "+" al centro. Segue il dito 1:1.
    @State private var progress: CGFloat = Shot.welcomeLanded ? 1 : 0 // SHOT
    /// La cupola è arrivata ed è stata lasciata: plume + claim + CTA.
    @State private var landed = Shot.welcomeLanded // SHOT
    @State private var dragX: CGFloat = 0
    @State private var caustic: CGFloat = 0
    /// Verso del caustico: dove sta andando la sfera (di base: la corona).
    @State private var dv: CGVector = CGVector(dx: 0, dy: -1)
    /// Il liquido dentro che resta indietro rispetto al vetro (−1…1).
    @State private var slosh: CGVector = .zero
    @State private var dragging = false
    /// Let's go premuto: via pulsante, "+" e testo; poi i fiori; poi avanti.
    @State private var blooming = false
    /// 1 = sfera intera, 0 = ritirata (prima che il giardino sbocci).
    @State private var presence: CGFloat = 1
    @State private var garden: CGFloat = 0
    @State private var showReturningLogin = false

    @State private var lastSample: (y: CGFloat, t: Date)?
    @State private var velocityY: CGFloat = 0
    @State private var lastPoint: (p: CGPoint, t: Date)?

    /// Il pennacchio di sticker: fisica a ogni frame, sotto la lente.
    @State private var plume = PlumeField()

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let insets = geo.safeAreaInsets
            let dome = DomeLayout(size: size, progress: progress, dragX: dragX)

            ZStack {
                // ── Il fondale: tutto ciò che la lente piega ──────────────
                ZStack {
                    Theme.cream
                    CherryBackground(mood: .fresh)
                    horizonGlow(in: size)

                    if blooming || garden > 0 {
                        GardenView(progress: garden)
                            .frame(height: size.height * 0.55)
                            .frame(maxHeight: .infinity, alignment: .bottom)
                            .allowsHitTesting(false)
                    }

                    brand(in: size)

                    // Gli sticker nascono dentro il vetro del "+" e stanno
                    // sotto la lente: il vetro li ingrandisce passando.
                    PlumeCanvas(
                        field: plume,
                        origin: blooming
                            ? CGPoint(x: size.width / 2, y: size.height * 0.29)
                            : dome.center,
                        progress: progress,
                        landed: landed,
                        leaving: blooming
                    )
                        .allowsHitTesting(false)
                }
                .compositingGroup()
                .modifier(GlassScene(
                    progress: progress, dragX: dragX, caustic: caustic, presence: presence,
                    sloshX: slosh.dx, sloshY: slosh.dy, dvX: dv.dx, dvY: dv.dy,
                    size: size
                ))

                gateHint(in: size, bottomInset: insets.bottom)

                openCopy(in: size, bottomInset: insets.bottom)
            }
            .frame(width: size.width, height: size.height)
            .contentShape(Rectangle())
            .accessibilityLabel(landed ? "Cherry. Eating well is easy. Love every bite." : "Swipe up to enter Cherry")
            .simultaneousGesture(dragGesture(in: size))
        }
        .ignoresSafeArea()
        // Primo step del funnel: è il denominatore di tutti gli altri,
        // e vale chiunque abbia aperto l'app almeno una volta.
        .onAppear { appState.trackOnboarding(.welcome) }
        .sheet(isPresented: $showReturningLogin) {
            ReturningUserSheet()
        }
    }

    // MARK: - Gesto

    private func dragGesture(in size: CGSize) -> some Gesture {
        let travel = max(size.height * (1 - DomeLayout.landingY), 1)
        return DragGesture(minimumDistance: 6)
            .onChanged { value in
                guard !blooming else { return }
                dragging = true
                // Il dito spinge gli sticker e li trascina col suo vento.
                plume.touch(at: value.location, on: true)
                sampleWind(at: value.location)
                let base: CGFloat = landed ? 1 : 0
                var next = base - value.translation.height / travel
                // Rubber band oltre le due estremità: il dito conta al 25%.
                if next < 0 { next *= 0.25 }
                if next > 1 { next = 1 + (next - 1) * 0.25 }
                progress = next
                let leash = 150 * (size.width / 402)
                dragX = leash * CGFloat(tanh(Double(value.translation.width / leash)))
                sampleVelocity(y: value.translation.height)

                // La luce risponde alla forza, non alla posizione; e si
                // raccoglie dove la sfera sta andando.
                let vx = plume.wind.dx, vy = velocityY
                let sp = hypot(vx, vy)
                let force = min(1, sp / 1400)
                withAnimation(.easeOut(duration: 0.09)) { caustic = max(force, caustic * 0.88) }
                if sp > 40 {
                    let tx = (vx / sp) * 0.42
                    let ty: CGFloat = (vy / sp > 0.55 ? 1 : -1) * sqrt(max(0, 1 - tx * tx))
                    dv = CGVector(dx: dv.dx + (tx - dv.dx) * 0.16, dy: dv.dy + (ty - dv.dy) * 0.16)
                }
                let sx = max(-1, min(1, vx / 430)), sy = max(-1, min(1, vy / 430))
                slosh = CGVector(dx: slosh.dx + (sx - slosh.dx) * 0.12, dy: slosh.dy + (sy - slosh.dy) * 0.12)

                if landed && progress < 0.80 { unland() }
            }
            .onEnded { _ in
                plume.touch(at: .zero, on: false)
                lastPoint = nil
                guard !blooming else { return }
                dragging = false
                let vHat = -velocityY / travel
                let target: CGFloat = (progress + 0.18 * vHat) > 0.5 ? 1 : 0
                let spring: Animation = reduceMotion
                    ? .interpolatingSpring(stiffness: 160, damping: 30)
                    : .interpolatingSpring(stiffness: 120, damping: 15, initialVelocity: Double(vHat))
                withAnimation(spring) {
                    progress = target
                    dragX = 0
                }
                // Atterrando la luce inonda la corona, poi si spegne; il
                // liquido dentro si riassesta con un po' di rimbalzo.
                withAnimation(.easeOut(duration: 0.18)) { caustic = target == 1 ? 0.9 : 0.4 }
                withAnimation(.easeOut(duration: 0.9).delay(0.2)) { caustic = 0 }
                withAnimation(.interpolatingSpring(stiffness: 90, damping: 9)) { slosh = .zero }
                withAnimation(.easeOut(duration: 0.8)) { dv = CGVector(dx: 0, dy: -1) }
                if target == 1 { land() } else if landed { unland() }
                lastSample = nil
                velocityY = 0
            }
    }

    private func sampleWind(at point: CGPoint) {
        let now = Date()
        if let last = lastPoint {
            let dt = now.timeIntervalSince(last.t)
            if dt > 0.004 {
                plume.wind = CGVector(
                    dx: (point.x - last.p.x) / CGFloat(dt),
                    dy: (point.y - last.p.y) / CGFloat(dt)
                )
            }
        }
        lastPoint = (point, now)
    }

    private func sampleVelocity(y: CGFloat) {
        let now = Date()
        if let sample = lastSample {
            let dt = now.timeIntervalSince(sample.t)
            if dt > 0.004 { velocityY = (y - sample.y) / CGFloat(dt) }
        }
        lastSample = (y, now)
    }

    private func land() {
        guard !landed else { return }
        Haptics.medium()
        landed = true
        // Lo swipe è riuscito: compare il claim con "Let's go". Da qui
        // in poi è una schermata a sé, con il suo drop-off.
        appState.trackOnboarding(.promise)
    }

    private func unland() {
        guard landed else { return }
        Haptics.light()
        landed = false
    }

    /// Via sfera, copy e pulsante. Ricompare il marchio come all'inizio,
    /// gli sticker esplodono intorno, il giardino sboccia; poi si va avanti.
    private func letsGo() {
        guard !blooming else { return }
        blooming = true
        Haptics.light()
        withAnimation(.easeIn(duration: 0.22)) { presence = 0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) {
            Haptics.success()
            withAnimation(reduceMotion ? .easeOut(duration: 0.5) : Theme.Motion.celebration) { garden = 1 }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.05) { onStart() }
    }

    // MARK: - Strati

    /// L'orizzonte che la cupola rifrange: colline di luce menta e
    /// burro sul bordo basso — il nostro "cielo", in chiave Cherry.
    private func horizonGlow(in size: CGSize) -> some View {
        ZStack {
            Ellipse()
                .fill(
                    RadialGradient(
                        colors: [Color.white, Theme.mint.opacity(0.75), Theme.mint.opacity(0.0)],
                        center: .center, startRadius: 4, endRadius: size.width * 0.7
                    )
                )
                .frame(width: size.width * 1.7, height: size.height * 0.36)
                .offset(x: -size.width * 0.18, y: size.height * 0.40)
            Ellipse()
                .fill(
                    RadialGradient(
                        colors: [Theme.butter.opacity(0.9), Theme.peach.opacity(0.35), .clear],
                        center: .center, startRadius: 4, endRadius: size.width * 0.6
                    )
                )
                .frame(width: size.width * 1.4, height: size.height * 0.30)
                .offset(x: size.width * 0.25, y: size.height * 0.44)
            Ellipse()
                .fill(
                    RadialGradient(
                        colors: [Theme.sky.opacity(0.55), .clear],
                        center: .center, startRadius: 2, endRadius: size.width * 0.5
                    )
                )
                .frame(width: size.width * 1.2, height: size.height * 0.22)
                .offset(y: size.height * 0.30)
        }
        .blur(radius: 26)
        .opacity(1 - 0.35 * min(1, progress))
        // Le ellissi sbordano: la cornice resta lo schermo, altrimenti
        // lo ZStack si allarga e sposta tutto ciò che è a layout.
        .frame(width: size.width, height: size.height)
        .clipped()
        .allowsHitTesting(false)
    }

    private func brand(in size: CGSize) -> some View {
        let swipeFade = 1 - WelcomeMotion.range(progress, from: 0.08, to: 0.62)
        let fade = blooming ? garden : swipeFade
        let defocus = blooming ? (1 - garden) * 10 : WelcomeMotion.range(progress, from: 0.05, to: 0.60) * 13
        return GateBrand()
            .frame(maxWidth: .infinity)
            .position(x: size.width / 2, y: size.height * 0.29)
            .opacity(fade)
            .blur(radius: defocus)
            .offset(y: blooming ? 0 : -min(1, progress) * 22)
            .allowsHitTesting(false)
    }

    /// Dentro la cupola, a riposo. Sfuma appena si spinge e si lascia
    /// trascinare dallo slosh.
    private func gateHint(in size: CGSize, bottomInset: CGFloat) -> some View {
        let fade = 1 - WelcomeMotion.range(progress, from: 0.06, to: 0.30)
        return VStack(spacing: 14) {
                Text("Swipe up to enter")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color(hex: 0x38383C).opacity(0.85))
                    .modifier(FloatUpAndDown())
                Button {
                    Haptics.light()
                    showReturningLogin = true
                } label: {
                    Text("Already have an account?")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.subtle.opacity(0.9))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
        }
        .offset(x: dragX * 0.15 + slosh.dx * 10, y: -min(1, progress) * 30 + slosh.dy * 10)
        .opacity(fade)
        .blur(radius: (1 - fade) * 12)
        .padding(.bottom, 24 + bottomInset)
        .frame(width: size.width, height: size.height, alignment: .bottom)
        .allowsHitTesting(progress < 0.12 && !landed)
    }

    /// Claim e CTA sotto il "+": entrano con defocus dopo l'atterraggio
    /// (520 ms), escono in 240 ms. La terza riga ruota con un blur wipe.
    private func openCopy(in size: CGSize, bottomInset: CGFloat) -> some View {
        VStack(spacing: 0) {
            Spacer()
                .frame(height: size.height * (DomeLayout.landingY + 0.15))

            let visible = landed && !blooming

            WelcomeHeadline(shown: landed, width: size.width)
                .modifier(Defocus(amount: visible ? 0 : 14))
                .opacity(visible ? 1 : 0)
                .animation(
                    visible
                        ? .timingCurve(0.23, 1, 0.32, 1, duration: 0.52)
                        : .easeOut(duration: 0.24),
                    value: visible
                )

            Spacer(minLength: 12)

            Button {
                letsGo()
            } label: {
                Text("Let's go")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Theme.brand, in: Capsule())
                    .shadow(color: Theme.brand.opacity(0.28), radius: 16, y: 8)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 28)
            .padding(.bottom, 48 + bottomInset)
            .modifier(Defocus(amount: visible ? 0 : 14))
            .opacity(visible ? 1 : 0)
            .offset(y: visible ? 0 : 16)
            .animation(
                visible
                    ? .timingCurve(0.23, 1, 0.32, 1, duration: 0.52).delay(0.06)
                    : .easeOut(duration: 0.24),
                value: visible
            )
            .disabled(!landed || blooming)
            .accessibilityHidden(!landed)
        }
        .frame(width: size.width, height: size.height)
        .allowsHitTesting(landed && !dragging)
    }
}

// MARK: - La sfera di vetro (shader)

/// Applica la lente al fondale e ci disegna sopra il corpo del vetro e
/// il "+". È `Animatable` perché gli uniform degli shader non vengono
/// interpolati da SwiftUI: passando da qui, la molla dell'atterraggio, il
/// caustico che si spegne e lo slosh che si riassesta arrivano allo
/// shader frame per frame.
private struct GlassScene: ViewModifier, Animatable {
    var progress: CGFloat
    var dragX: CGFloat
    var caustic: CGFloat
    var presence: CGFloat
    var sloshX: CGFloat
    var sloshY: CGFloat
    var dvX: CGFloat
    var dvY: CGFloat
    let size: CGSize

    typealias Pair = AnimatablePair<CGFloat, CGFloat>
    typealias Quad = AnimatablePair<Pair, Pair>

    var animatableData: AnimatablePair<Quad, Quad> {
        get {
            AnimatablePair(
                AnimatablePair(AnimatablePair(progress, dragX), AnimatablePair(caustic, presence)),
                AnimatablePair(AnimatablePair(sloshX, sloshY), AnimatablePair(dvX, dvY))
            )
        }
        set {
            progress = newValue.first.first.first
            dragX = newValue.first.first.second
            caustic = newValue.first.second.first
            presence = newValue.first.second.second
            sloshX = newValue.second.first.first
            sloshY = newValue.second.first.second
            dvX = newValue.second.second.first
            dvY = newValue.second.second.second
        }
    }

    func body(content: Content) -> some View {
        let dome = DomeLayout(size: size, progress: progress, dragX: dragX)
        let sx = size.width / 402
        let r0 = 245 * sx, r1 = 44 * sx
        // Ritirandosi (Let's go) la sfera si stringe e svanisce.
        let r = max(0.5, dome.radius * (0.3 + 0.7 * presence))
        let c = dome.center
        let t = WelcomeMotion.range(dome.radius, from: r1, to: r0)   // 0 = pulsante, 1 = cupola
        let amount = 0.62 + (0.42 - 0.62) * t
        let bezel = 0.42 + (0.25 - 0.42) * t
        let disp = 0.12 + (0.05 - 0.12) * t
        let slosh = CGSize(width: sloshX * r * 0.10, height: sloshY * r * 0.10)
        let small = 1 - t
        // Il caustico appartiene al vetro grande: sparisce fra 190 e 100 pt.
        let caus = WelcomeMotion.range(dome.radius, from: 100 * sx, to: 190 * sx)
        let reach = r * 0.7 + 30 * sx
        let plus = 1 - WelcomeMotion.range(dome.radius, from: 1.2 * r1, to: 1.7 * r1)

        content
            .layerEffect(
                ShaderLibrary.liquidLens(
                    .float2(c), .float(r),
                    .float(amount), .float(bezel), .float(disp),
                    .float2(slosh)
                ),
                maxSampleOffset: CGSize(width: reach, height: reach),
                isEnabled: presence > 0.02
            )
            .overlay {
                Rectangle()
                    .fill(.white)
                    .colorEffect(
                        ShaderLibrary.liquidGlass(
                            .float2(c), .float(r),
                            .float(caustic), .float2(CGPoint(x: dvX, y: dvY)),
                            .float(small), .float(caus)
                        )
                    )
                    .opacity(Double(presence))
                    .allowsHitTesting(false)
            }
            .overlay {
                // Il "+" compare sull'ultimo tratto della stretta (1.7R1→1.2R1).
                Image(systemName: "plus")
                    .font(.system(size: 26 * sx, weight: .medium))
                    .foregroundStyle(Color(hex: 0x1D1D1F).opacity(0.9))
                    .opacity(Double(plus * presence))
                    .scaleEffect((0.7 + 0.3 * plus) * (0.3 + 0.7 * presence))
                    .position(c)
                    .allowsHitTesting(false)
            }
    }
}

// MARK: - Marchio animato

/// Icona Liquid Glass + wordmark. Resta lì: non cade, non saluta
/// con la manina. Il vetro si accende sul posto (come l'icona
/// home), il nome si mette a fuoco sotto.
private struct GateBrand: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var settled = false
    @State private var wordmarkShown = false
    @State private var birth = Date().timeIntervalSinceReferenceDate

    private let iconSize: CGFloat = 118

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 40.0, paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            let floatY = reduceMotion ? 0 : 2.2 * sin(t * 0.7)
            let breathe = reduceMotion ? 1 : 1 + 0.008 * sin(t * 1.35)
            let phase = (t - birth).truncatingRemainder(dividingBy: 6.4)
            let sheen: CGFloat = reduceMotion ? -1 : CGFloat(-1 + 3 * min(1, max(0, (phase - 3.1) / 1.35)))

            VStack(spacing: 16) {
                CherryGlassIcon(size: iconSize)
                    .opacity(settled ? 1 : 0)
                    .scaleEffect(settled ? 1 : 0.86)
                    .blur(radius: settled ? 0 : 6)

                CherryWordmark(height: CherryWordmarkSize.welcomeHero)
                    .overlay {
                        GeometryReader { geo in
                            LinearGradient(
                                colors: [.clear, .white.opacity(0.72), .clear],
                                startPoint: .leading, endPoint: .trailing
                            )
                            .frame(width: geo.size.width * 0.42, height: geo.size.height * 2.2)
                            .rotationEffect(.degrees(16))
                            .position(x: geo.size.width * sheen, y: geo.size.height / 2)
                        }
                        .mask(CherryWordmark(height: CherryWordmarkSize.welcomeHero))
                        .allowsHitTesting(false)
                    }
                    .scaleEffect(breathe)
                    .offset(y: floatY * 0.4)
                    .opacity(wordmarkShown ? 1 : 0)
                    .scaleEffect(wordmarkShown ? 1 : 0.94)
                    .blur(radius: wordmarkShown ? 0 : 8)
            }
        }
        .onAppear {
            birth = Date().timeIntervalSinceReferenceDate
            withAnimation(.spring(duration: 0.72, bounce: 0.18).delay(0.08)) { settled = true }
            withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.7).delay(0.28)) { wordmarkShown = true }
        }
    }
}

// MARK: - Geometria della cupola

/// Raggio e centro sono funzione pura di `p` (MOTION_SPEC): salire e
/// scendere si leggono identici. Riferimento 402 pt di larghezza.
private struct DomeLayout {
    /// Quota d'arrivo del "+" (frazione dell'altezza).
    static let landingY: CGFloat = 0.469

    let center: CGPoint
    let radius: CGFloat

    init(size: CGSize, progress: CGFloat, dragX: CGFloat) {
        let sx = size.width / 402
        let sy = size.height / 874
        let r0 = 245 * sx
        let r1 = 44 * sx
        let p = progress
        let clamped = min(1, max(0, p))
        // Oltre il pulsante il raggio scende appena, verso un pavimento.
        let overshoot = max(0, p - 1) * size.height * (1 - Self.landingY)
        let floor = 32 * sx
        let radiusAtP = r0 + (r1 - r0) * clamped
        radius = overshoot > 0 ? floor + (r1 - floor) * CGFloat(exp(-Double(overshoot / (40 * sy)))) : radiusAtP
        let cy0 = size.height
        let cy1 = size.height * Self.landingY
        center = CGPoint(x: size.width / 2 + dragX, y: cy0 + (cy1 - cy0) * p)
    }
}

private enum WelcomeMotion {
    static func range(_ value: CGFloat, from: CGFloat, to: CGFloat) -> CGFloat {
        min(1, max(0, (value - from) / max(to - from, 0.001)))
    }
}

// MARK: - Giardino disegnato, legato al progresso

private struct GardenView: View {
    let progress: CGFloat

    private struct Plant {
        let x: CGFloat        // posizione orizzontale 0-1
        let height: CGFloat   // altezza relativa 0-1
        let sway: CGFloat     // curvatura dello stelo
        let bloom: String     // emoji del fiore/foglia
        let start: CGFloat    // soglia di progresso a cui inizia a crescere
    }

    private let plants: [Plant] = [
        Plant(x: 0.12, height: 0.55, sway: 18, bloom: "🌷", start: 0.05),
        Plant(x: 0.28, height: 0.80, sway: -24, bloom: "🌻", start: 0.0),
        Plant(x: 0.44, height: 0.45, sway: 12, bloom: "🌿", start: 0.18),
        Plant(x: 0.58, height: 0.90, sway: -14, bloom: "🌱", start: 0.10),
        Plant(x: 0.72, height: 0.60, sway: 22, bloom: "🌸", start: 0.22),
        Plant(x: 0.88, height: 0.72, sway: -18, bloom: "🌼", start: 0.14),
    ]

    private let stemGradient = LinearGradient(
        colors: [Theme.brand, Theme.orange],
        startPoint: .bottom, endPoint: .top
    )

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                // Colline pastello sul fondo
                Ellipse()
                    .fill(Theme.mint.opacity(0.55))
                    .frame(width: geo.size.width * 1.6, height: 130)
                    .offset(x: -60, y: 70)
                Ellipse()
                    .fill(Theme.butter.opacity(0.6))
                    .frame(width: geo.size.width * 1.4, height: 110)
                    .offset(x: 80, y: 75)

                ForEach(plants.indices, id: \.self) { index in
                    let plant = plants[index]
                    let local = plantProgress(plant)
                    PlantShape(sway: plant.sway)
                        .trim(from: 0, to: local)
                        .stroke(stemGradient, style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
                        .frame(width: 60, height: geo.size.height * plant.height)
                        .overlay(alignment: .top) {
                            Text(plant.bloom)
                                .font(.system(size: 36))
                                .scaleEffect(local > 0.95 ? 1 : 0.01)
                                .opacity(local > 0.95 ? 1 : 0)
                                .animation(.spring(duration: 0.45, bounce: 0.55), value: local > 0.95)
                                .offset(x: plant.sway * 0.6, y: -18)
                        }
                        .position(
                            x: geo.size.width * plant.x,
                            y: geo.size.height - (geo.size.height * plant.height * 0.5)
                        )
                }
            }
        }
    }

    private func plantProgress(_ plant: Plant) -> CGFloat {
        let span: CGFloat = 0.55
        return min(1, max(0, (progress - plant.start) / span))
    }
}

/// Stelo curvo che cresce dal basso.
private struct PlantShape: Shape {
    let sway: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let baseX = rect.midX
        path.move(to: CGPoint(x: baseX, y: rect.maxY))
        path.addCurve(
            to: CGPoint(x: baseX + sway * 0.6, y: rect.minY),
            control1: CGPoint(x: baseX - sway, y: rect.maxY * 0.65),
            control2: CGPoint(x: baseX + sway, y: rect.maxY * 0.3)
        )
        return path
    }
}

private struct FloatUpAndDown: ViewModifier {
    @State private var up = false

    func body(content: Content) -> some View {
        content
            .offset(y: up ? -5 : 2)
            .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: up)
            .onAppear { up = true }
    }
}

// MARK: - Utente di ritorno (§9)

private struct ReturningUserSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?
    @State private var restoring = false
    @State private var noAccountFound = false

    var body: some View {
        ZStack {
            CherryBackground(mood: .calm)

            VStack(spacing: 20) {
                Text("Welcome back")
                    .font(Theme.display(30))
                    .foregroundStyle(Theme.brandGradient)
                    .padding(.top, 36)

                Text("Sign in to restore your account\nand subscription.")
                    .font(Theme.body())
                    .foregroundStyle(Theme.subtle)
                    .multilineTextAlignment(.center)

                Spacer()

                if let errorMessage {
                    Text(errorMessage)
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.soft_red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 28)
                }

                // Il ripristino con Apple può metterci qualche secondo:
                // chiudere il foglio subito lascerebbe l'utente davanti
                // al welcome, convinto che non sia successo niente.
                if restoring {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Restoring your account…")
                            .font(Theme.body(15, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                    }
                    .frame(height: 54)
                } else if noAccountFound {
                    Button("Set up my account") { dismiss() }
                        .buttonStyle(PrimaryButtonStyle())
                } else {
                    AppleSignInButton(auth: appState.auth, onResult: handle)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
        .interactiveDismissDisabled(restoring)
        .presentationDetents([.height(360)])
        .presentationCornerRadius(32)
    }

    private func handle(_ outcome: AppleAuthOutcome) {
        switch outcome {
        case .cancelled:
            errorMessage = nil
        case .failed(let message):
            errorMessage = message

        case .signedIn(let isReturning) where !isReturning:
            // Questo Apple ID non aveva nessun account Cherry: chi è
            // arrivato qui ha premuto il pulsante sbagliato. Marcare
            // l'onboarding come fatto lo scaricherebbe sul paywall
            // senza profilo gusti, e senza modo di rifarlo.
            // L'Apple ID resta legato all'account: è già suo, e a fine
            // onboarding si ritroverà semplicemente di aver saltato
            // la schermata di login.
            errorMessage = "No Cherry account for this Apple ID yet. Let's build your profile first. It takes a minute."
            noAccountFound = true
            Analytics.logRegistration()

        case .signedIn:
            errorMessage = nil
            restoring = true
            Task {
                // Senza abbonamento attivo si atterra sul paywall: è la
                // fase giusta, e `completeReturningUser` l'ha già scelta.
                await appState.completeReturningUser()
                restoring = false
                dismiss()
            }
        }
    }
}

// MARK: - Il pennacchio di sticker

/// Quaranta slot con taglie volutamente disuguali (pt a 402 di larghezza):
/// i grandi sono il soggetto, i piccoli i confetti intorno.
private let plumeSizes: [CGFloat] = [
    104, 82, 76, 93, 87,
    68, 46, 58, 52, 55,
    98, 49, 43, 54, 36,
    91, 47, 41, 35, 62,
    85, 32, 50, 30,
    39, 27, 44, 24,
    71, 40, 33, 64,
    29, 57, 45, 26,
    79, 31, 22, 37,
]

/// I nostri sticker riempiono il loro riquadro più dei die-cut del
/// riferimento: stessa gerarchia di taglie, un filo più piccoli.
private let plumeFit: CGFloat = 0.8

/// Che sticker va in ogni slot: i piatti sulle taglie grandi, stelle e
/// scritte come coriandoli. Il mazzo è più largo dei sei di partenza,
/// così nello stesso pennacchio non si ripete quasi nessuno.
private let plumeAssets: [String] = {
    let dishes = [
        "sticker_cupcake", "sticker_smoothie", "sticker_fruit_plate",
        "sticker_salad", "sticker_fruit_bowl", "sticker_winter_bowl",
        "sticker_healthy_food", "sticker_pancakes", "sticker_noodles",
        "sticker_avocados", "sticker_ramen", "sticker_donut", "sticker_boba",
        "sticker_watermelon", "sticker_banana", "sticker_cheesecake",
        "sticker_pancake_stack", "sticker_sprinkle_donut", "sticker_pears",
        "sticker_strawberry", "sticker_peach",
    ]
    let extras = [
        "sticker_star", "sticker_rainbow_cloud", "sticker_shooting_star",
        "sticker_awesome", "sticker_cool",
        "sticker_heart_hands", "sticker_planet", "sticker_rainbow",
        "sticker_rock_on", "sticker_love", "sticker_cute", "sticker_gift",
        "sticker_glitter_star", "sticker_flame", "sticker_cat", "sticker_moth",
        "sticker_flower", "sticker_octopus", "sticker_foodie", "sticker_lets_eat",
    ]
    var out: [String] = []
    var d = 0, e = 0
    for (i, size) in plumeSizes.enumerated() {
        if size < 48 && i % 2 == 0 {
            out.append(extras[e % extras.count]); e += 1
        } else {
            out.append(dishes[d % dishes.count]); d += 1
        }
    }
    return out
}()

/// Gli sticker, liberi: niente bolla, niente cerchio. Affiorano dal vetro
/// del pulsante, ruzzolano, e si sistemano in un pennacchio che continua a
/// respirare sopra di lui. Rimandata giù la sfera, cadono un poco e poi
/// risalgono sfumando. La fisica gira a ogni frame; il dito li spinge.
private final class PlumeField {
    struct Sticker {
        var x: CGFloat = 0, y: CGFloat = 0
        var vx: CGFloat = 0, vy: CGFloat = 0
        var scale: CGFloat = 0, alive: CGFloat = 0
        var phase: CGFloat
        var homeX: CGFloat = 0, homeY: CGFloat = 0
        var rot: CGFloat = 0, vrot: CGFloat
        var born = false
    }

    enum Mode { case idle, emit, leave, burst }

    private(set) var stickers: [Sticker]
    private(set) var mode: Mode = .idle
    private var lastMode: Mode = .idle
    private var emitT: Double = -1
    private var clock: Double = 0
    private var lastDate: Date?

    var touchPoint: CGPoint = .zero
    var touchOn = false
    var wind: CGVector = .zero

    let count = plumeSizes.count

    init() {
        stickers = (0..<plumeSizes.count).map { _ in
            Sticker(phase: .random(in: 0..<(2 * .pi)), vrot: .random(in: -0.5...0.5))
        }
    }

    func touch(at point: CGPoint, on: Bool) {
        touchPoint = point
        touchOn = on
        if !on { wind = .zero }
    }

    /// Atterrata → emette. Sotto p = 0.35 lascia andare; a casa (p ≤ 0.02)
    /// torna in quiete e quel che resta risale sfumando.
    func decide(landed: Bool, progress: CGFloat, leaving: Bool = false) {
        if leaving { mode = .burst; return }
        if landed { mode = .emit }
        else if mode == .emit && progress < 0.35 { mode = .leave }
        else if (mode == .leave || mode == .burst) && progress <= 0.02 { mode = .idle }
    }

    /// Dove ogni sticker vuole stare: un pennacchio stretto alla base che
    /// si apre salendo, con qualche disperso più largo.
    private func seedHomes(sx: CGFloat, sy: CGFloat) {
        for i in 0..<count {
            let big = plumeSizes[i] / 104
            let t = CGFloat.random(in: 0..<1)
            let spread = 34 + t * 178
            let stray = i % 7 == 3
            stickers[i].homeX = CGFloat.random(in: -1...1) * spread * (stray ? 1.8 : 1 - 0.3 * big) * sx
            stickers[i].homeY = (-40 - t * 545 - (stray ? 90 : 0)) * sy
            // qualche piccolo resta attorno al pulsante: c'è sempre qualcosa
            // che passa nel vetro da piegare
            if i % 6 == 4 && plumeSizes[i] < 82 {
                stickers[i].homeX = CGFloat.random(in: -1...1) * 40 * sx
                stickers[i].homeY = (-14 + CGFloat.random(in: -1...1) * 30) * sy
            }
        }
    }

    func step(now: Date, origin: CGPoint, size: CGSize) {
        let dt = min(0.05, lastDate.map { now.timeIntervalSince($0) } ?? 1.0 / 60.0)
        lastDate = now
        clock += dt
        let fdt = CGFloat(dt)
        let sx = size.width / 402, sy = size.height / 874
        let ox = origin.x, oy = origin.y

        if mode != lastMode {
            switch mode {
            case .emit:
                emitT = 0
                seedHomes(sx: sx, sy: sy)
                for i in 0..<count {
                    stickers[i].x = ox; stickers[i].y = oy
                    stickers[i].vx = 0; stickers[i].vy = 0
                    stickers[i].scale = 0; stickers[i].alive = 0; stickers[i].born = false
                }
            case .leave:
                // Rimandata giù la sfera: una spinta a separarli e poi
                // la gravità li fa cadere.
                for i in 0..<count where stickers[i].alive > 0 {
                    stickers[i].vx += CGFloat.random(in: -45...45) * sx
                    stickers[i].vy += CGFloat.random(in: 40...200) * sy
                    stickers[i].vrot += CGFloat.random(in: -1.5...1.5)
                }
            case .burst:
                // Let's go: gli sticker si raccolgono sul marchio e
                // esplodono a raggiera, come all'apertura.
                for i in 0..<count {
                    let ang = CGFloat.random(in: 0..<(2 * .pi))
                    let sp = CGFloat.random(in: 220...680)
                    stickers[i].x = ox + CGFloat.random(in: -18...18) * sx
                    stickers[i].y = oy + CGFloat.random(in: -10...10) * sy
                    stickers[i].vx = cos(ang) * sp
                    stickers[i].vy = sin(ang) * sp
                    stickers[i].scale = max(stickers[i].scale, 0.55)
                    stickers[i].alive = 1
                    stickers[i].born = true
                    stickers[i].vrot = CGFloat.random(in: -3.2...3.2)
                }
            case .idle:
                break
            }
            lastMode = mode
        }

        if emitT >= 0 { emitT += dt * 1000 }
        let t = clock
        let falling = mode == .leave
        let bursting = mode == .burst
        let out = falling || bursting

        for i in 0..<count {
            var s = stickers[i]
            let r = plumeSizes[i] * plumeFit * sx * 0.5

            // Nascita: 350 ms dopo l'atterraggio, uno ogni 30 ms. Quattro su
            // cinque salgono attraverso il vetro del pulsante già abbastanza
            // grandi da vedersi, così la lente li ingrandisce e li sdoppia
            // uscendo; il quinto affiora come un puntino appena sopra.
            if mode == .emit, emitT >= 0, !s.born, emitT > 350 + Double(i) * 30 {
                let ang = -CGFloat.pi / 2 + CGFloat.random(in: -0.6...0.6)
                let sp = CGFloat.random(in: 90...290) * sy
                if i % 5 != 2 {
                    let a2 = CGFloat.random(in: 0..<(2 * .pi))
                    let rr = sqrt(CGFloat.random(in: 0..<1)) * 26 * sx
                    s.x = ox + cos(a2) * rr
                    s.y = oy + 8 * sy + sin(a2) * rr * 0.6
                    s.scale = 0.34
                } else {
                    s.x = ox + CGFloat.random(in: -60...60) * sx
                    s.y = oy - (50 + CGFloat.random(in: 0..<70)) * sy
                    s.scale = 0.16
                }
                s.vx = cos(ang) * sp; s.vy = sin(ang) * sp
                s.alive = 1; s.born = true
                s.vrot = CGFloat.random(in: -1.6...1.6)
            }
            if s.alive <= 0 { stickers[i] = s; continue }

            var vx = s.vx, vy = s.vy
            if s.scale < 1 { s.scale = min(1, s.scale + fdt * 3.6) }

            if bursting {
                vx += CGFloat(sin(t * 1.3 + Double(s.phase))) * 18 * fdt
                vy += CGFloat(cos(t * 0.9 + Double(s.phase))) * 12 * fdt
                s.alive = max(0, s.alive - fdt * 0.22)
            } else if falling {
                vy += 1500 * sy * fdt
                vx += CGFloat(sin(t * 1.3 + Double(s.phase))) * 30 * fdt
            } else {
                vy -= 16 * fdt                                                     // galleggiamento
                vx += CGFloat(sin(t * 0.85 + Double(s.phase))) * 11 * fdt          // vagare
                vy += CGFloat(cos(t * 0.65 + Double(s.phase) * 1.3)) * 7 * fdt
                let hx = ox + s.homeX, hy = oy + s.homeY
                vx += (hx - s.x) * 2.0 * fdt
                vy += (hy - s.y) * 2.0 * fdt
            }

            if touchOn {
                let dx = s.x - touchPoint.x, dy = s.y - touchPoint.y
                let dd = hypot(dx, dy)
                let reach = 170 * sx
                if dd < reach && dd > 0.5 {
                    let f = (1 - dd / reach) * 2600 * fdt
                    vx += dx / dd * f; vy += dy / dd * f
                    s.vrot += dx / dd * 0.9 * fdt * 12
                }
                vx += wind.dx * 0.09; vy += wind.dy * 0.09
            }

            // repulsione fra vicini
            for j in 0..<count where j != i {
                let o = stickers[j]
                if o.alive <= 0 { continue }
                let dx = s.x - o.x, dy = s.y - o.y
                let dd = hypot(dx, dy)
                let minD = (r + plumeSizes[j] * plumeFit * sx * 0.5) * 0.86
                if dd < minD && dd > 0.1 {
                    let f = (minD - dd) * 13 * fdt
                    vx += dx / dd * f; vy += dy / dd * f
                }
            }

            let pad = -r * 0.5
            if s.x < pad { vx += (pad - s.x) * 6 * fdt }
            if s.x > size.width - pad { vx -= (s.x - (size.width - pad)) * 6 * fdt }
            if !out {
                if s.y < -r * 1.3 { vy += (-r * 1.3 - s.y) * 8 * fdt }
                let floor = (i % 6 == 4 && plumeSizes[i] < 82) ? oy + r : oy - r * 0.8
                if s.y > floor { vy -= (s.y - floor) * 10 * fdt }
            }

            let drag = CGFloat(pow(bursting ? 0.16 : (falling ? 0.55 : 0.07), dt))
            vx *= drag; vy *= drag
            s.vx = vx; s.vy = vy
            s.x += vx * fdt; s.y += vy * fdt

            // capitombolo: la rotazione si smorza e si assesta in un dondolio
            s.vrot *= CGFloat(pow(out ? 0.6 : 0.25, dt))
            s.rot += s.vrot * fdt + CGFloat(sin(t * 0.7 + Double(s.phase))) * 0.09 * fdt

            if bursting && hypot(s.x - ox, s.y - oy) > size.height * 0.85 { s.alive = 0 }
            if falling && s.y > size.height + r * 1.5 { s.alive = 0 }
            if mode == .idle { s.alive = max(0, s.alive - fdt * 0.65) }
            stickers[i] = s
        }
    }
}

/// Disegna il campo in un Canvas, un frame per tick. Sta sotto la lente:
/// il vetro piega quel che gli passa dentro.
private struct PlumeCanvas: View {
    let field: PlumeField
    let origin: CGPoint
    let progress: CGFloat
    let landed: Bool
    /// Let's go premuto: gli sticker volano via verso l'alto.
    let leaving: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { context in
            Canvas(rendersAsynchronously: false) { ctx, size in
                field.decide(landed: landed, progress: progress, leaving: leaving)
                field.step(now: context.date, origin: origin, size: size)

                let sx = size.width / 402
                var cache: [String: GraphicsContext.ResolvedImage] = [:]
                for (i, s) in field.stickers.enumerated() where s.alive > 0.002 && s.scale > 0.002 {
                    let name = plumeAssets[i]
                    let image = cache[name] ?? ctx.resolve(Image(name))
                    cache[name] = image
                    let d = plumeSizes[i] * plumeFit * sx
                    var c = ctx
                    c.opacity = Double(s.alive)
                    c.translateBy(x: s.x, y: s.y)
                    c.rotate(by: .radians(Double(s.rot)))
                    c.scaleBy(x: s.scale, y: s.scale)
                    c.draw(image, in: CGRect(x: -d / 2, y: -d / 2, width: d, height: d))
                }
            }
        }
    }
}

// MARK: - Il copy

/// Titolo in nero con "hard" cancellato, "easy" verde, e una terza
/// riga che ruota con un blur wipe.
private struct WelcomeHeadline: View {
    let shown: Bool
    let width: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let phrases = [
        "from any TikTok recipe",
        "at any restaurant",
        "with what's in your fridge",
        "on a busy weeknight",
    ]

    @State private var index = 0
    @State private var wipe: CGFloat = 0
    @State private var soften: CGFloat = 0
    @State private var fade: Double = 0
    @State private var generation = 0

    var body: some View {
        VStack(spacing: 2) {
            (Text("Eating well is ")
                + Text("hard")
                    .strikethrough(true, color: .black)
                    .foregroundStyle(.black)
                + Text(" easy.")
                    .foregroundStyle(Theme.brand))
                .font(.system(size: 30, weight: .medium))

            Text("Love every bite")
                .font(.system(size: 30, weight: .medium))

            WipeLine(text: Self.phrases[index], wipe: wipe, soften: soften)
                .font(.system(size: 30, weight: .medium))
                .foregroundStyle(.black)
                .opacity(fade)
                .frame(height: 40)
                .id(index)
        }
        .foregroundStyle(.black)
        .multilineTextAlignment(.center)
        .frame(width: width)
        .onAppear { if shown { start() } }
        .onChange(of: shown) { _, isShown in isShown ? start() : stop() }
    }

    private func start() {
        generation += 1
        index = 0
        showLine(generation)
    }

    private func stop() {
        generation += 1
        fade = 0
    }

    private func showLine(_ g: Int) {
        guard g == generation else { return }
        var reset = Transaction(); reset.disablesAnimations = true
        withTransaction(reset) { wipe = 0; soften = 0; fade = 1 }
        if reduceMotion {
            withAnimation(.easeOut(duration: 0.3)) { wipe = 1 }
        } else {
            withAnimation(.timingCurve(0.16, 0.42, 0.40, 1, duration: 0.56)) { wipe = 1 }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.56 + 1.95) {
            guard g == generation else { return }
            withAnimation(.easeOut(duration: 0.4)) { soften = 19 }
            withAnimation(.easeIn(duration: 0.4)) { fade = 0 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4 + 0.46) {
                guard g == generation else { return }
                withTransaction(reset) { index = (index + 1) % Self.phrases.count }
                showLine(g)
            }
        }
    }
}

/// Una riga il cui fuoco arriva da sinistra a destra: ogni parola ha la
/// sua posizione nella riga (dal suo span di caratteri) e si mette a
/// fuoco quando il fronte la supera.
private struct WipeLine: View {
    let text: String
    let wipe: CGFloat
    let soften: CGFloat

    private var parts: [(word: String, at: CGFloat)] {
        let words = text.split(separator: " ").map(String.init)
        let total = CGFloat(max(1, text.count))
        var out: [(String, CGFloat)] = []
        var start: CGFloat = 0
        for (i, w) in words.enumerated() {
            out.append((i == 0 ? w : " " + w, (start + CGFloat(w.count) * 0.5) / total))
            start += CGFloat(w.count) + 1
        }
        return out
    }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                Text(part.word)
                    .modifier(WipeWord(wipe: wipe, soften: soften, at: part.at))
            }
        }
        .fixedSize()
    }
}

private struct WipeWord: ViewModifier, Animatable {
    var wipe: CGFloat
    var soften: CGFloat
    let at: CGFloat

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(wipe, soften) }
        set { wipe = newValue.first; soften = newValue.second }
    }

    func body(content: Content) -> some View {
        let ramp: CGFloat = 0.34      // larghezza del fronte fuori fuoco
        let soft: CGFloat = 26        // quanto è sfocata una parola prima del fronte
        let front = -ramp + wipe * (1 + ramp * 2)
        let t = min(1, max(0, (front - at) / ramp + 0.5))
        content
            .opacity(Double(t))
            .blur(radius: ((1 - t) * soft + soften) * 0.45)
    }
}

/// Un blocco che va fuori fuoco senza muoversi.
private struct Defocus: ViewModifier, Animatable {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func body(content: Content) -> some View {
        content.blur(radius: amount * 0.7)
    }
}
