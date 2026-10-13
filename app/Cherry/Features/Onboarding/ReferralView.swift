import SwiftUI

// La seconda delle due domande introduttive: da dove arrivi.
//
// Stava sotto al campo del nome, sulla stessa schermata: con la
// tastiera aperta finiva sotto la piega e si premeva "avanti" senza
// averla mai vista. È l'unica fonte che abbiamo su quali canali
// portano gente vera, quindi merita lo schermo tutto per sé.
//
// Non è obbligatoria e non cambia niente nell'app: se non risponde si
// prosegue uguale.
struct ReferralView: View {
    let onDone: (_ referral: String?) -> Void

    @State private var referral: String?

    private enum Mark {
        /// Logo ufficiale dal catalogo (`Brands/`), nel colore del marchio.
        case brand(String, Color)
        case symbol(String, Color)
    }

    private struct Source {
        let id: String
        let mark: Mark
        let label: String
    }

    private let sources: [Source] = [
        Source(id: "tiktok", mark: .brand("brand_tiktok", .black), label: "TikTok"),
        Source(id: "instagram", mark: .brand("brand_instagram", Color(hex: 0xFF0069)), label: "Instagram"),
        Source(id: "facebook", mark: .brand("brand_facebook", Color(hex: 0x0866FF)), label: "Facebook"),
        Source(id: "youtube", mark: .brand("brand_youtube", Color(hex: 0xFF0000)), label: "YouTube"),
        Source(id: "appstore", mark: .brand("brand_appstore", Color(hex: 0x0D96F6)), label: "App Store"),
        Source(id: "friend", mark: .symbol("person.2.fill", Theme.brand), label: "A friend"),
        Source(id: "other", mark: .symbol("ellipsis.circle.fill", Theme.subtle), label: "Somewhere else"),
    ]

    var body: some View {
        // Niente ScrollView: sei chip entrano ovunque, e dentro uno
        // scroll restavano appiccicate in alto con mezzo schermo vuoto
        // sotto.
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                CherryMascotView(size: 92, pose: .listen)
                    .padding(.top, 24)

                Text("And how did\nyou find us?")
                    .font(Theme.display(28))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                    .padding(.top, 20)

                Text("Knowing this tells us\nwhere to show up next.")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.subtle)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
            }
            .frame(maxWidth: .infinity)

            Spacer(minLength: 16)

            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2),
                spacing: 10
            ) {
                ForEach(sources, id: \.id) { source in
                    sourceChip(source)
                }
            }
            .padding(.horizontal, 28)

            Spacer(minLength: 16)
        }
        .safeAreaInset(edge: .bottom) { cta }
    }

    @ViewBuilder
    private func markView(_ mark: Mark, isOn: Bool) -> some View {
        switch mark {
        case let .brand(asset, color):
            Image(asset)
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 18, height: 18)
                .foregroundStyle(isOn ? .white : color)
        case let .symbol(name, color):
            Image(systemName: name)
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 18, height: 18)
                .foregroundStyle(isOn ? .white : color)
        }
    }

    private func sourceChip(_ source: Source) -> some View {
        let isOn = referral == source.id
        return Button {
            Haptics.selection()
            referral = isOn ? nil : source.id
        } label: {
            HStack(spacing: 10) {
                markView(source.mark, isOn: isOn)
                Text(source.label)
                    .font(Theme.body(14, weight: .semibold))
                    .foregroundStyle(isOn ? .white : Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity)
            .contentShape(.rect(cornerRadius: 16))
            .glassEffect(
                isOn ? .regular.tint(Theme.brand.opacity(0.9)) : .regular,
                in: .rect(cornerRadius: 16)
            )
            .animation(Theme.Motion.quick, value: isOn)
        }
        .buttonStyle(.plain)
    }

    private var cta: some View {
        Button(referral == nil ? "Skip for now" : "Continue") {
            Haptics.light()
            onDone(referral)
        }
        .buttonStyle(PrimaryButtonStyle())
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 20)
        .background(.ultraThinMaterial)
        .animation(Theme.Motion.quick, value: referral == nil)
    }
}
