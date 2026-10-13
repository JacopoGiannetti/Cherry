import SwiftUI

// Beat 1 del wizard (§4.1): foto, non parole. Tile full-bleed a 2
// colonne. Si possono scegliere PIÙ stili: una settimana di spesa
// raramente è monocucina. L'ordine segue il Taste Profile.
// (Emoji + gradiente finché non c'è fotografia proprietaria.)
struct CravingView: View {
    let profile: TasteProfile

    /// Solo nella prova guidata: le cucine per cui esiste un deck di
    /// esempio. Le altre restano in griglia ma chiuse — l'utente vede
    /// quanto c'è oltre l'assaggio senza che gli venga promesso in
    /// anticipo qualcosa che la demo non può servire.
    var unlockedIds: Set<String>?

    let onConfirm: ([String]) -> Void

    @State private var selected: [String] = []
    @State private var lockedNotice: String?

    private struct CravingTile: Identifiable {
        let id: String
        let emoji: String
        let label: String
        let colors: [Color]
    }

    private var tiles: [CravingTile] {
        let all: [CravingTile] = [
            CravingTile(id: "Italian", emoji: "🍝", label: "Italian", colors: [Color(hex: 0xD96C47), Color(hex: 0xF2A65A)]),
            CravingTile(id: "Mexican", emoji: "🌮", label: "Mexican", colors: [Color(hex: 0xC0533E), Color(hex: 0xE8A33D)]),
            CravingTile(id: "Japanese", emoji: "🍜", label: "Japanese", colors: [Color(hex: 0x4A6B8A), Color(hex: 0x8FB3C9)]),
            CravingTile(id: "Greek", emoji: "🥙", label: "Greek", colors: [Color(hex: 0x3E6B8A), Color(hex: 0x9CC9D9)]),
            CravingTile(id: "Thai", emoji: "🥥", label: "Thai", colors: [Color(hex: 0x3E8A6B), Color(hex: 0x8AC9A8)]),
            CravingTile(id: "Indian", emoji: "🍛", label: "Indian", colors: [Color(hex: 0xB8641F), Color(hex: 0xE8A33D)]),
            CravingTile(id: "American", emoji: "🍔", label: "American", colors: [Color(hex: 0x8A5A3E), Color(hex: 0xC98F5A)]),
            CravingTile(id: "Chinese", emoji: "🥡", label: "Chinese", colors: [Color(hex: 0xA83E3E), Color(hex: 0xD97C6C)]),
            CravingTile(id: "Middle Eastern", emoji: "🧆", label: "Middle Eastern", colors: [Color(hex: 0x7A8A3E), Color(hex: 0xB8C95A)]),
            CravingTile(id: "Korean", emoji: "🍚", label: "Korean", colors: [Color(hex: 0x8A3E5A), Color(hex: 0xC96C8F)]),
        ]
        // Le cucine affini al profilo salgono in cima; nella prova
        // guidata quelle chiuse scendono comunque in fondo.
        let affinities = Set(profile.cuisineAffinities)
        return all.sorted { a, b in
            let aOpen = isUnlocked(a.id)
            let bOpen = isUnlocked(b.id)
            if aOpen != bOpen { return aOpen }
            let aAffine = affinities.contains(a.id)
            let bAffine = affinities.contains(b.id)
            if aAffine != bAffine { return aAffine }
            return false
        }
    }

    private func isUnlocked(_ id: String) -> Bool {
        unlockedIds?.contains(id) ?? true
    }

    private var subtitle: String {
        guard let unlockedIds else { return "pick as many as you like" }
        return "\(unlockedIds.count) kitchens in this taster — the full app cooks them all"
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("What are you\ncraving this week?")
                .font(Theme.display(30))
                .foregroundStyle(Theme.brandGradient)
                .multilineTextAlignment(.center)
                .padding(.top, 20)

            Text(subtitle)
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 6)
                .padding(.bottom, 14)

            ScrollView(showsIndicators: false) {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(tiles) { tile in
                        Button {
                            toggle(tile.id)
                        } label: {
                            tileLabel(tile)
                        }
                        .buttonStyle(.plain)
                    }

                    // La tile "Surprise me", discreta, chiude la griglia.
                    Button {
                        Haptics.medium()
                        onConfirm([])
                    } label: {
                        VStack(spacing: 8) {
                            Text("🎲").font(.system(size: 40))
                            Text("Surprise me")
                                .font(Theme.body(14, weight: .semibold))
                                .foregroundStyle(Theme.ink)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 150)
                        .contentShape(.rect(cornerRadius: 22))
                        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                // Spazio per non far finire l'ultima riga sotto la CTA.
                .padding(.bottom, selected.isEmpty ? 24 : 96)
            }
        }
        .overlay(alignment: .bottom) { continueBar }
        .overlay(alignment: .top) { lockedToast }
    }

    /// Il messaggio che spiega perché una cucina non si può scegliere
    /// adesso. Dura poco e non blocca: è un'informazione, non un muro.
    @ViewBuilder
    private var lockedToast: some View {
        if let lockedNotice {
            HStack(spacing: 8) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 12, weight: .bold))
                Text("\(lockedNotice) is waiting in the full app — this taster covers a few kitchens")
                    .font(Theme.body(13, weight: .medium))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .glassEffect(.regular, in: .rect(cornerRadius: 16))
            .padding(.horizontal, 24)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private func tileLabel(_ tile: CravingTile) -> some View {
        let isOn = selected.contains(tile.id)
        let isOpen = isUnlocked(tile.id)
        return ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: tile.colors.map { $0.mix(with: .white, by: isOn ? 0.06 : 0.28) },
                startPoint: .topLeading, endPoint: .bottomTrailing
            )

            Text(tile.emoji)
                .font(.system(size: isOn ? 72 : 64))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .shadow(color: .black.opacity(0.12), radius: 8, y: 4)

            // Etichetta in vetro che galleggia sul colore
            Text(tile.label)
                .font(Theme.body(13, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .glassEffect(.regular.tint(.black.opacity(0.25)), in: .capsule)
                .padding(10)

            if !isOpen { lockedBadge }

            if isOn {
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .glassEffect(.regular.tint(Theme.brand.opacity(0.95)), in: .circle)
                    .padding(10)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .frame(height: 150)
        .clipShape(RoundedRectangle(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22)
                .strokeBorder(.white.opacity(isOn ? 0.95 : 0), lineWidth: 3)
        }
        .saturation(isOpen ? 1 : 0.15)
        .opacity(isOpen ? 1 : 0.55)
        .scaleEffect(isOn ? 1.03 : 1)
        .shadow(color: .black.opacity(isOn ? 0.18 : 0), radius: 14, y: 6)
    }

    /// Lucchetto d'angolo: si legge come "c'è, ma non adesso".
    private var lockedBadge: some View {
        VStack(spacing: 3) {
            Image(systemName: "lock.fill")
                .font(.system(size: 12, weight: .bold))
            Text("Full app")
                .font(Theme.body(10, weight: .bold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .glassEffect(.regular.tint(.black.opacity(0.35)), in: .rect(cornerRadius: 12))
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
    }

    @ViewBuilder
    private var continueBar: some View {
        if !selected.isEmpty {
            Button {
                Haptics.success()
                onConfirm(selected)
            } label: {
                HStack(spacing: 10) {
                    Text(selected.count == 1 ? "Continue" : "Continue with \(selected.count)")
                    Image(systemName: "arrow.right")
                        .font(.system(size: 15, weight: .bold))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.horizontal, 24)
            .padding(.bottom, 18)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func toggle(_ id: String) {
        guard isUnlocked(id) else {
            Haptics.light()
            withAnimation(Theme.Motion.signature) { lockedNotice = id }
            // Il messaggio si ritira da solo: se nel frattempo ne è
            // arrivato un altro, quello resta.
            let shown = id
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) {
                guard lockedNotice == shown else { return }
                withAnimation(.easeOut(duration: 0.25)) { lockedNotice = nil }
            }
            return
        }

        Haptics.selection()
        withAnimation(.spring(duration: 0.3, bounce: 0.35)) {
            lockedNotice = nil
            if let index = selected.firstIndex(of: id) {
                selected.remove(at: index)
            } else {
                selected.append(id)
            }
        }
    }
}
