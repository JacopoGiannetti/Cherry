import SwiftUI

// La missione come poster tipografico: una frase sola che cresce di
// taglia riga per riga, finché la svolta verde prende tutta la
// larghezza. Un margine solo, tutto appeso a sinistra, la firma in
// calce sullo stesso filo. Nessuna immagine: il carattere lo fa il
// ritmo delle taglie.
struct FounderView: View {
    let onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = Shot.active ? 5 : 0

    private let margin: CGFloat = 28

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 0)

            crescendo

            Text("We're building Cherry to make eating well easier for everyone, whatever you like to eat.")
                .font(Theme.body(15))
                .foregroundStyle(Theme.subtle)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 300, alignment: .leading)
                .padding(.top, 26)
                .opacity(shown >= 5 ? 1 : 0)
                .offset(y: shown >= 5 ? 0 : 8)

            Spacer(minLength: 0)

            signature
                .opacity(shown >= 5 ? 1 : 0)
                .offset(y: shown >= 5 ? 0 : 8)
                .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, margin)
        .safeAreaInset(edge: .bottom) {
            Button("Continue") { onDone() }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
                .opacity(shown >= 5 ? 1 : 0)
        }
        .onAppear(perform: reveal)
    }

    /// Quattro righe, quattro taglie. Le prime tre in inchiostro,
    /// l'ultima in rosso ciliegia e larga quanto la colonna: è lì che si arriva.
    private var crescendo: some View {
        VStack(alignment: .leading, spacing: -2) {
            line("Our mission is to make", size: 22, weight: .medium, color: Theme.ink, step: 1)
            line("eating well", size: 32, weight: .bold, color: Theme.ink, step: 2)
            line("a pleasure.", size: 44, weight: .bold, color: Theme.ink, step: 3)

            Text("Not a chore.")
                .font(.system(size: 60, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.brand)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
                .opacity(shown >= 4 ? 1 : 0)
                .offset(y: shown >= 4 ? 0 : 14)
        }
    }

    private func line(_ text: String, size: CGFloat, weight: Font.Weight, color: Color, step: Int) -> some View {
        Text(text)
            .font(.system(size: size, weight: weight, design: .rounded))
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .opacity(shown >= step ? 1 : 0)
            .offset(y: shown >= step ? 0 : 10)
    }

    private var signature: some View {
        HStack(spacing: 12) {
            Image("FounderPhoto")
                .resizable()
                .scaledToFill()
                .frame(width: 44, height: 44)
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 1) {
                Text("Jacopo")
                    .font(Theme.body(15, weight: .bold))
                    .foregroundStyle(Theme.ink)
                Text("Founder, Cherry team")
                    .font(Theme.body(12.5, weight: .medium))
                    .foregroundStyle(Theme.subtle)
            }
        }
    }

    private func reveal() {
        if Shot.active || reduceMotion {
            shown = 5
            return
        }
        shown = 0
        let curve = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.5)
        for step in 1...5 {
            let delay = 0.05 + Double(step - 1) * 0.11
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                withAnimation(curve) { shown = step }
                if step == 4 { Haptics.light() }
            }
        }
    }
}
