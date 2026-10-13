import SwiftUI

// Il logotipo "Cherry": presente in ogni schermata, con taglie diverse.
// Un solo asset (CherryWordmark in Assets), scalato per altezza così le
// proporzioni restano sempre quelle del file originale.
enum CherryWordmarkSize {
    /// Header tab Grocery / Recipes e flussi feature.
    static let header: CGFloat = 26
    /// Impostazioni, barre secondarie.
    static let compact: CGFloat = 24
    /// Sign in.
    static let signIn: CGFloat = 32
    /// Paywall.
    static let hero: CGFloat = 68
    /// Welcome onboarding (piccolo).
    static let welcome: CGFloat = 40
    /// Welcome onboarding (hero centrale).
    static let welcomeHero: CGFloat = 72
}

struct CherryWordmark: View {
    var height: CGFloat = CherryWordmarkSize.header

    var body: some View {
        Text("Cherry")
            .font(.system(size: height * 0.92, weight: .black, design: .rounded))
            .foregroundStyle(Theme.cherry)
            .lineLimit(1)
            .fixedSize()
            .frame(height: height)
            .accessibilityLabel("Cherry")
    }
}

/// Barra superiore dei tre flussi feature (meal plan, scan, swap):
/// Cherry sempre in cima; sotto, azioni ai lati — mai sulla stessa riga.
struct FeatureFlowHeader<Leading: View, Trailing: View>: View {
    var wordmarkHeight: CGFloat = CherryWordmarkSize.header
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var trailing: () -> Trailing

    /// Spazio da riservare in cima al contenuto quando l'header è
    /// sovrapposto invece che impilato.
    static var reservedHeight: CGFloat { 88 }

    var body: some View {
        VStack(spacing: 8) {
            CherryWordmark(height: wordmarkHeight)

            HStack {
                leading()
                Spacer(minLength: 0)
                trailing()
            }
            .frame(minHeight: 40)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }
}

extension FeatureFlowHeader where Leading == EmptyView, Trailing == EmptyView {
    init(wordmarkHeight: CGFloat = CherryWordmarkSize.header) {
        self.wordmarkHeight = wordmarkHeight
        self.leading = { EmptyView() }
        self.trailing = { EmptyView() }
    }
}

extension FeatureFlowHeader where Leading == EmptyView {
    init(wordmarkHeight: CGFloat = CherryWordmarkSize.header, @ViewBuilder trailing: @escaping () -> Trailing) {
        self.wordmarkHeight = wordmarkHeight
        self.leading = { EmptyView() }
        self.trailing = trailing
    }
}

extension FeatureFlowHeader where Trailing == EmptyView {
    init(wordmarkHeight: CGFloat = CherryWordmarkSize.header, @ViewBuilder leading: @escaping () -> Leading) {
        self.wordmarkHeight = wordmarkHeight
        self.leading = leading
        self.trailing = { EmptyView() }
    }
}

extension View {
    /// Velo sotto un header sovrapposto: il contenuto che scorre non
    /// finisce contro una riga netta, si dissolve gradualmente sotto
    /// il logo. Stesso trattamento dell'header delle tab.
    func featureFlowHeaderVeil() -> some View {
        background {
            ZStack {
                Rectangle().fill(.thinMaterial)
                LinearGradient(
                    colors: [Theme.cream.opacity(0.85), Theme.cream.opacity(0)],
                    startPoint: .top, endPoint: .bottom
                )
            }
            .mask {
                LinearGradient(
                    stops: [
                        .init(color: .black, location: 0),
                        .init(color: .black, location: 0.45),
                        .init(color: .clear, location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom
                )
            }
            .padding(.bottom, -56)
            .ignoresSafeArea(edges: .top)
            .allowsHitTesting(false)
        }
    }
}

/// Pulsante chiudi testuale per i flussi feature.
struct FeatureFlowCloseButton: View {
    let action: () -> Void

    var body: some View {
        Button("Close", action: action)
            .font(Theme.body(15, weight: .semibold))
            .foregroundStyle(Theme.subtle)
    }
}

/// Pulsante chiudi a X per i flussi feature.
struct FeatureFlowDismissButton: View {
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.light()
            action()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.subtle)
                .frame(width: 40, height: 40)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
    }
}
