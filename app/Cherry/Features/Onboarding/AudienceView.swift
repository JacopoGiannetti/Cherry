import SwiftUI

// Chi è Cherry: tre persone, una per gruppo, nello stesso mondo
// illustrato dei problemi (stesso stile, stesso crema). Non è più
// una lista da leggere: si tocca quella che ti somiglia, e la scelta
// finisce sull'utente — così si sa a chi stiamo vendendo davvero.
//
// Sta dopo le coppie problema/soluzione e prima delle voci famose:
// hai visto cosa fa l'app, adesso dici chi sei, poi arrivano le
// persone che conosci.
struct AudienceView: View {
    let onDone: (_ audience: String) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = Shot.active ? 3 : 0
    @State private var picked: String?
    @State private var breathe = false

    private struct Audience: Identifiable {
        let id: String
        let title: String
        let detail: String
        let image: String
        let tint: Color
        let fromLeft: Bool
    }

    private let audiences: [Audience] = [
        Audience(
            id: "curious",
            title: "I want to eat better.",
            detail: "Not all at once. Just better food, more often.",
            image: "onb_audience_curious",
            tint: Theme.amber,
            fromLeft: true
        ),
        Audience(
            id: "recipes",
            title: "I want new recipes to cook.",
            detail: "Dinners worth cooking, not the same three on repeat.",
            image: "onb_audience_recipes",
            tint: Theme.brand,
            fromLeft: false
        ),
        Audience(
            id: "already",
            title: "I follow a diet or have allergies.",
            detail: "Make shopping and eating out easier.",
            image: "onb_audience_vegan",
            tint: Theme.soft_red,
            fromLeft: true
        ),
    ]

    /// Il crema delle tre illustrazioni, lo stesso dei problemi.
    static let pageColor = Color(hex: 0xFAE9CB)

    var body: some View {
        ZStack {
            Self.pageColor.ignoresSafeArea()

            GeometryReader { geo in
                // La card cresce con lo spazio: tre tessere piccole in
                // cima lasciano mezzo telefono vuoto. Sotto i 128
                // punti si smette e si lascia scorrere.
                let tall = max(128, (geo.size.height - 150) / 3 - 12)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 8) {
                            Rectangle()
                                .fill(Theme.amber)
                                .frame(width: 22, height: 2)
                            Text("Who is Cherry for")
                                .font(Theme.body(11.5, weight: .bold))
                                .tracking(1.8)
                                .textCase(.uppercase)
                                .foregroundStyle(Theme.amber)
                        }
                        .padding(.top, 18)

                        Text("Which one\nis you?")
                            .font(Theme.display(30))
                            .foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.bottom, 6)

                        ForEach(Array(audiences.enumerated()), id: \.element.id) { index, item in
                            card(item, index: index, height: tall)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 12)
                    .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .top)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        .safeAreaInset(edge: .bottom) { cta }
        .onAppear(perform: reveal)
    }

    private var cta: some View {
        Button(picked == nil ? "Pick one to continue" : "That's me") {
            guard let picked else { return }
            Haptics.light()
            onDone(picked)
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(picked == nil)
        .opacity(picked == nil ? 0.45 : 1)
        .padding(.horizontal, 24)
        .padding(.top, 10)
        .padding(.bottom, 20)
        .background(Self.pageColor)
        .animation(Theme.Motion.quick, value: picked == nil)
    }

    /// Illustrazione da un lato, testo dall'altro, alternati. La
    /// figura sfuma nella card — che ha lo stesso crema — quindi non
    /// c'è un riquadro dentro al riquadro.
    private func card(_ item: Audience, index: Int, height: CGFloat) -> some View {
        let visible = shown > index || reduceMotion
        let isOn = picked == item.id
        let dimmed = picked != nil && !isOn

        return Button {
            Haptics.medium()
            withAnimation(Theme.Motion.signature) { picked = item.id }
        } label: {
            HStack(spacing: 0) {
                if item.fromLeft { figure(item, height: height) }

                VStack(alignment: .leading, spacing: 6) {
                    Text(item.title)
                        .font(Theme.title(18))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(item.detail)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.subtle)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 16)
                .padding(.leading, item.fromLeft ? 4 : 18)
                .padding(.trailing, item.fromLeft ? 18 : 4)

                if !item.fromLeft { figure(item, height: height) }
            }
            .frame(height: height)
            .background(Theme.card.opacity(isOn ? 0.75 : 0.45), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay(alignment: item.fromLeft ? .topTrailing : .topLeading) {
                if isOn {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(.white, item.tint)
                        .padding(12)
                        .transition(.scale(scale: 0.4).combined(with: .opacity))
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .strokeBorder(isOn ? item.tint : Theme.ink.opacity(0.08), lineWidth: isOn ? 2 : 1)
            )
            .scaleEffect(isOn ? 1.015 : 1)
            .opacity(dimmed ? 0.62 : 1)
            .saturation(dimmed ? 0.6 : 1)
        }
        .buttonStyle(.plain)
        .offset(x: visible ? 0 : (item.fromLeft ? -90 : 90))
        .opacity(visible ? 1 : 0)
        .animation(.spring(duration: 0.55, bounce: 0.18), value: visible)
        .animation(Theme.Motion.signature, value: picked)
        .accessibilityLabel(item.title)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private func figure(_ item: Audience, height: CGFloat) -> some View {
        Image(item.image)
            .resizable()
            .scaledToFill()
            .frame(width: height * 0.98, height: height)
            .scaleEffect(breathe ? 1.04 : 1)
            .clipped()
            .mask(
                RadialGradient(
                    stops: [
                        .init(color: .black, location: 0.55),
                        .init(color: .clear, location: 0.98),
                    ],
                    center: .center, startRadius: 0, endRadius: height * 0.62
                )
            )
    }

    private func reveal() {
        guard shown == 0, !reduceMotion else {
            shown = audiences.count
            return
        }
        for index in 0..<audiences.count {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12 + Double(index) * 0.34) {
                shown = index + 1
                Haptics.light()
            }
        }
        withAnimation(.easeInOut(duration: 4.2).repeatForever(autoreverses: true).delay(0.8)) {
            breathe = true
        }
    }
}
