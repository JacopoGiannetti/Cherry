import SwiftUI

// La carta del deck (§4.1 beat 4): foto full-bleed, titolo + one-liner
// sul terzo inferiore, stamp costo (alto sx) e tempo (alto dx).
// Nient'altro. Il tap gira la carta per ingredienti e step.
struct RecipeCardFace: View {
    @EnvironmentObject private var appState: AppState
    let recipe: Recipe
    var sharedBadge: String?
    var dragOffset: CGSize = .zero
    var showsTapHint = false

    var body: some View {
        ZStack {
            // Foto (o "developing" mentre fal.ai lavora)
            RecipePhoto(imageUrl: recipe.imageUrl, imageStatus: recipe.imageStatus)

            // Gradiente del terzo inferiore
            VStack {
                Spacer()
                LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
                    .frame(height: 190)
            }

            // Contenuto
            VStack {
                HStack {
                    stamp(appState.money(recipe.costUsd), color: Theme.amber)
                    Spacer()
                    stamp("\(recipe.cookMinutes) min", color: .black.opacity(0.55))
                }
                .padding(14)

                Spacer()

                VStack(alignment: .leading, spacing: 6) {
                    if let sharedBadge {
                        Text(sharedBadge)
                            .font(Theme.body(11, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 6)
                            .background(.ultraThinMaterial, in: Capsule())
                            .background(Theme.brand.opacity(0.65), in: Capsule())
                            .overlay(Capsule().stroke(.white.opacity(0.3), lineWidth: 1))
                    }
                    Text(recipe.title)
                        .font(Theme.display(26))
                        .foregroundStyle(.white)
                    Text(recipe.oneLiner)
                        .font(Theme.body(14))
                        .foregroundStyle(.white.opacity(0.85))
                        .lineLimit(2)

                    if showsTapHint {
                        HStack(spacing: 6) {
                            Image(systemName: "hand.tap.fill")
                                .font(.system(size: 11, weight: .bold))
                            Text("Tap for recipe & ingredients")
                                .font(Theme.body(11, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 6)
                        .background(.ultraThinMaterial, in: Capsule())
                        .background(Theme.ink.opacity(0.28), in: Capsule())
                        .overlay(Capsule().stroke(.white.opacity(0.28), lineWidth: 1))
                        .padding(.top, 4)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
            }

            // Verdetti keep/pass durante il drag
            verdictWash
            keepPassOverlay
        }
        .clipShape(RoundedRectangle(cornerRadius: 26))
        .shadow(color: Theme.ink.opacity(0.18), radius: 16, y: 8)
    }

    private var keepIntent: Double { min(1, max(0, Double(dragOffset.width) / 70)) }
    private var passIntent: Double { min(1, max(0, Double(-dragOffset.width) / 70)) }

    /// Il colore invade la foto man mano che il pollice si sbilancia:
    /// la decisione si legge prima ancora dello stamp.
    private var verdictWash: some View {
        LinearGradient(
            colors: keepIntent > passIntent
                ? [Theme.fit.opacity(0.5), Theme.fit.opacity(0.08)]
                : [Theme.soft_red.opacity(0.5), Theme.soft_red.opacity(0.08)],
            startPoint: keepIntent > passIntent ? .leading : .trailing,
            endPoint: keepIntent > passIntent ? .trailing : .leading
        )
        .opacity(max(keepIntent, passIntent) * 0.75)
    }

    private var keepPassOverlay: some View {
        ZStack {
            stampBadge("KEEP", color: Theme.fit, rotation: -14, intent: keepIntent)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(28)

            stampBadge("PASS", color: Theme.soft_red, rotation: 14, intent: passIntent)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .padding(28)
        }
    }

    private func stampBadge(_ text: String, color: Color, rotation: Double, intent: Double) -> some View {
        Text(text)
            .font(Theme.display(34))
            .foregroundStyle(color)
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(color, lineWidth: 4))
            .rotationEffect(.degrees(rotation))
            .scaleEffect(0.85 + 0.15 * intent)
            .opacity(intent)
    }

    // Vetrini sopra la foto: material traslucido tinto (il glassEffect
    // vero non campiona dentro un contenitore clippato).
    private func stamp(_ text: String, color: Color) -> some View {
        Text(text)
            .font(Theme.body(15, weight: .heavy))
            .foregroundStyle(.white)
            .padding(.horizontal, 13)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial, in: Capsule())
            .background(color.opacity(0.55), in: Capsule())
            .overlay(Capsule().stroke(.white.opacity(0.35), lineWidth: 1))
    }
}

/// Retro della carta: ingredienti e step (girarla non è mai necessario
/// per decidere — è approfondimento).
struct RecipeCardBack: View {
    @EnvironmentObject private var appState: AppState
    let recipe: Recipe

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                Text(recipe.title)
                    .font(Theme.title(22))
                    .foregroundStyle(Theme.ink)

                HStack(spacing: 12) {
                    Label(appState.money(recipe.costUsd), systemImage: "dollarsign.circle.fill")
                        .foregroundStyle(Theme.amber)
                    Label("\(recipe.cookMinutes) min", systemImage: "clock.fill")
                        .foregroundStyle(Theme.subtle)
                    Label("\(recipe.servings) servings", systemImage: "person.2.fill")
                        .foregroundStyle(Theme.subtle)
                }
                .font(Theme.body(13, weight: .semibold))

                Text("INGREDIENTS")
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(Theme.subtle)
                    .tracking(1.2)

                ForEach(recipe.ingredients, id: \.name) { ingredient in
                    HStack {
                        Text(ingredient.name)
                            .font(Theme.body(14, weight: .medium))
                            .foregroundStyle(Theme.ink)
                        Spacer()
                        Text(ingredient.quantity)
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.subtle)
                    }
                }

                Text("STEPS")
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(Theme.subtle)
                    .tracking(1.2)
                    .padding(.top, 4)

                ForEach(Array(recipe.steps.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(index + 1)")
                            .font(Theme.body(13, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 22, height: 22)
                            .background(Circle().fill(Theme.brand))
                        Text(step)
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.ink)
                    }
                }

                AIGeneratedNote(text: "Recipe and photo generated by AI. Check ingredients and cooking times before you cook.")
                    .padding(.top, 6)

                Text("Tap to flip back")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.subtle)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
            }
            .padding(20)
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 26))
        .shadow(color: Theme.ink.opacity(0.18), radius: 16, y: 8)
    }
}

/// Foto della ricetta con stato "developing" (§4.1 beat 3: le foto
/// si sviluppano come polaroid mentre fal.ai lavora).
struct RecipePhoto: View {
    let imageUrl: String?
    let imageStatus: String?

    @State private var loaded: UIImage?

    var body: some View {
        GeometryReader { geo in
            if let image = loaded ?? bundled {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
            } else {
                developing(size: geo.size)
            }
        }
        .task(id: imageUrl) {
            loaded = await ImageCache.loadAny(imageUrl)
        }
    }

    private var bundled: UIImage? {
        guard let imageUrl, let url = URL(string: imageUrl) else { return nil }
        return BundledImages.image(for: url)
    }

    // Placeholder OPACO: la base cream impedisce di vedere in trasparenza
    // la carta sotto nel deck (le foto ora arrivano già pronte, questo
    // copre solo il caricamento di rete o le rare foto fallite).
    private func developing(size: CGSize) -> some View {
        ZStack {
            Theme.cream
            LinearGradient(
                colors: [Theme.brand.opacity(0.25), Theme.amber.opacity(0.2)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            Image(systemName: "fork.knife")
                .font(.system(size: 38))
                .foregroundStyle(Theme.brand.opacity(0.5))
        }
        .frame(width: size.width, height: size.height)
    }
}
