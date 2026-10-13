import SwiftUI

// L'ultima schermata prima del paywall: come mangia.
//
// Attenzione se si tocca il flusso: questa è l'unica sorgente della
// dieta nel profilo. Finché non viene scelta il profilo vale il suo
// default (mangio tutto), quindi nessuna schermata prima di questa può
// permettersi di annunciare la dieta all'utente.
struct DietChoiceView: View {
    let onDone: (DietaryIdentity) -> Void

    @State private var choice: DietaryIdentity?

    var body: some View {
        VStack(spacing: 16) {
            header

            Spacer(minLength: 12)

            // Le tre scelte al centro dello schermo: sono l'unica cosa
            // da fare qui, e in cima sembravano una lista da sbrigare.
            VStack(spacing: 12) {
                ForEach(DietaryIdentity.choices) { candidate in
                    option(candidate)
                }
            }
            .padding(.horizontal, 24)

            Spacer(minLength: 12)

            cta
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Text("How do you\nlike to eat?")
                .font(Theme.display(30))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 24)

            Text("Every recipe, menu and scan follows this.\nYou can change it anytime in Settings.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 24)
    }

    private func option(_ candidate: DietaryIdentity) -> some View {
        let isOn = choice == candidate
        return Button {
            Haptics.medium()
            choice = candidate
        } label: {
            HStack(spacing: 14) {
                Text(Self.emoji(candidate))
                    .font(.system(size: 36))

                VStack(alignment: .leading, spacing: 3) {
                    Text(candidate.title)
                        .font(Theme.title(18))
                        .foregroundStyle(isOn ? .white : Theme.ink)
                    Text(Self.goal(candidate))
                        .font(Theme.body(13))
                        .foregroundStyle(isOn ? .white.opacity(0.85) : Theme.subtle)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 0)

                if isOn {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(.white)
                }
            }
            .padding(18)
            .contentShape(.rect(cornerRadius: Theme.cornerRadius))
            .glassEffect(
                isOn ? .regular.tint(Theme.brand.opacity(0.9)) : .regular,
                in: .rect(cornerRadius: Theme.cornerRadius)
            )
            .animation(Theme.Motion.quick, value: isOn)
        }
        .buttonStyle(.plain)
    }

    private var ctaLabel: String {
        switch choice {
        case .none: "Choose one to continue"
        case .some: "Continue"
        }
    }

    private var cta: some View {
        Button(ctaLabel) {
            Haptics.light()
            guard let choice else { return }
            onDone(choice)
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(choice == nil)
        .opacity(choice == nil ? 0.45 : 1)
        .animation(Theme.Motion.quick, value: choice)
        .padding(.horizontal, 24)
        .padding(.bottom, 20)
    }

    // MARK: - Testi

    static func emoji(_ identity: DietaryIdentity) -> String {
        switch identity {
        case .omnivore: "🍽️"
        case .vegan: "🌱"
        case .vegetarian: "🥚"
        case .pescatarian: "🐟"
        case .reducer: "⚖️"
        }
    }

    static func goal(_ identity: DietaryIdentity) -> String {
        switch identity {
        case .omnivore: "A bit of everything."
        case .vegan: "Fully plant-based."
        case .vegetarian: "No meat or fish. Eggs and dairy stay."
        case .pescatarian: "No meat, fish is fine."
        case .reducer: "Mostly plants, meat now and then."
        }
    }
}
