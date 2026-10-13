import SwiftUI

// Beat 2 del wizard: prima il mood (perché si fa la spesa), poi quanto
// osare. Due domande, una schermata: le card alte di prima costringevano
// a scrollare e seppellivano l'occasion, che è la scelta che conta di più.
struct AdventureView: View {
    /// `level` 1–3: solo certezze / equilibrio / spingi verso il nuovo.
    /// `occasion`: l'id della vibe scelta (vedi `ShopOccasion`).
    let onConfirm: (_ level: Int, _ occasion: String) -> Void

    @State private var level: Int = 2
    @State private var occasion: String = ShopOccasion.everyday.rawValue

    var body: some View {
        VStack(spacing: 0) {
            Text("What's this shop for?")
                .font(Theme.display(28))
                .foregroundStyle(Theme.brandGradient)
                .multilineTextAlignment(.center)
                .padding(.top, 8)

            Text("sets the vibe of the recipes you'll see")
                .font(Theme.body(13))
                .foregroundStyle(Theme.subtle)
                .padding(.top, 4)

            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 2),
                spacing: 8
            ) {
                ForEach(ShopOccasion.allCases) { vibe in
                    occasionChip(vibe)
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 16)

            Spacer(minLength: 16)

            Text("How adventurous?")
                .font(Theme.title(17))
                .foregroundStyle(Theme.ink)

            Text("How far from a classic the dishes go. The cuisines stay the ones you just picked.")
                .font(Theme.body(12))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
                .padding(.top, 2)
                .padding(.bottom, 10)

            adventurePills
                .padding(.horizontal, 22)

            Text(adventureOptions.first { $0.id == level }?.blurb ?? "")
                .font(Theme.body(13, weight: .medium))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .frame(minHeight: 36)
                .padding(.horizontal, 28)
                .padding(.top, 10)

            Spacer(minLength: 12)

            Button("Continue") {
                Haptics.success()
                onConfirm(level, occasion)
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.horizontal, 24)
            .padding(.bottom, 26)
        }
    }

    private var adventurePills: some View {
        HStack(spacing: 8) {
            ForEach(adventureOptions) { option in
                let isOn = level == option.id
                Button {
                    Haptics.medium()
                    withAnimation(Theme.Motion.signature) { level = option.id }
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: option.icon)
                            .font(.system(size: 16, weight: .semibold))
                        Text(option.title)
                            .font(Theme.body(12, weight: .bold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(isOn ? .white : Theme.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .contentShape(.rect(cornerRadius: 18))
                    .glassEffect(
                        isOn ? .regular.tint(Theme.brand.opacity(0.9)).interactive() : .regular.interactive(),
                        in: .rect(cornerRadius: 18)
                    )
                    .scaleEffect(isOn ? 1.03 : 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(option.title)
                .accessibilityHint(option.blurb)
            }
        }
    }

    private func occasionChip(_ vibe: ShopOccasion) -> some View {
        let isOn = occasion == vibe.rawValue
        return Button {
            Haptics.selection()
            withAnimation(Theme.Motion.quick) { occasion = vibe.rawValue }
        } label: {
            HStack(spacing: 8) {
                Text(vibe.emoji)
                    .font(.system(size: 22))
                Text(vibe.title)
                    .font(Theme.body(14, weight: .semibold))
                    .foregroundStyle(isOn ? .white : Theme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .contentShape(.rect(cornerRadius: 18))
            .glassEffect(
                isOn ? .regular.tint(Theme.amber.opacity(0.88)).interactive() : .regular.interactive(),
                in: .rect(cornerRadius: 18)
            )
            .scaleEffect(isOn ? 1.02 : 1)
        }
        .buttonStyle(.plain)
    }

    private struct Option: Identifiable {
        let id: Int
        let icon: String
        let title: String
        let blurb: String
    }

    private var adventureOptions: [Option] {
        [
            Option(id: 1, icon: "house.fill", title: "Safe", blurb: "Only well-known dishes from those cuisines. Nothing unusual."),
            Option(id: 2, icon: "scale.3d", title: "Both", blurb: "Mostly those classics, plus one or two less obvious dishes."),
            Option(id: 3, icon: "sparkles", title: "Surprise", blurb: "Lesser-known dishes from the same cuisines. Further from the obvious."),
        ]
    }
}

/// Le occasioni di spesa: l'id viaggia fino al prompt del backend.
enum ShopOccasion: String, CaseIterable, Identifiable {
    case everyday
    case hosting
    case protein
    case fresh
    case quick
    case comfort

    var id: String { rawValue }

    var emoji: String {
        switch self {
        case .everyday: "🏠"
        case .hosting: "🎉"
        case .protein: "💪"
        case .fresh: "🥗"
        case .quick: "⚡️"
        case .comfort: "🛋️"
        }
    }

    var title: String {
        switch self {
        case .everyday: "Everyday meals"
        case .hosting: "Hosting friends"
        case .protein: "High protein"
        case .fresh: "Light & fresh"
        case .quick: "Quick & easy"
        case .comfort: "Comfort food"
        }
    }
}
