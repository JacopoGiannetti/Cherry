import SwiftUI

// Header fisso condiviso da Grocery e Recipes: stessa posizione,
// due voci diverse. Grocery è un saluto (come "Hi, Sarah").
// Recipes è un titolo di pagina, più grande (come "From Basics
// to Breakthroughs") — non si ripete il nome.
struct TabScreenHeader: View {
    enum Style {
        case greeting
        case headline
    }

    var style: Style = .greeting
    let title: String
    var subtitle: String? = nil
    let onSettings: () -> Void

    static let greetingHeight: CGFloat = 108
    static let headlineHeight: CGFloat = 124
    static var reservedHeight: CGFloat { greetingHeight }

    var body: some View {
        VStack(spacing: 10) {
            CherryWordmark(height: CherryWordmarkSize.header)
                .frame(maxWidth: .infinity)

            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: style == .headline ? 4 : 2) {
                    Text(title)
                        .font(style == .headline ? Theme.display(30) : Theme.title(20))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(style == .headline ? 2 : 1)
                        .fixedSize(horizontal: false, vertical: true)

                    if let subtitle {
                        Text(subtitle)
                            .font(Theme.body(12, weight: .medium))
                            .foregroundStyle(Theme.subtle)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 0)

                Button(action: onSettings) {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .frame(width: 40, height: 40)
                        .contentShape(.circle)
                        .glassEffect(.regular.interactive(), in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Settings")
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 6)
        .padding(.bottom, 4)
        .frame(height: style == .headline ? Self.headlineHeight : Self.greetingHeight, alignment: .top)
    }
}
