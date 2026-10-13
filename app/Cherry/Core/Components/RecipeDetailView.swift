import SwiftUI

// Dettaglio ricetta riusato ovunque (run, salvate, swap finalizzato).
struct RecipeDetailView: View {
    let title: String
    let imageUrl: String?
    let costUsd: Double
    let cookMinutes: Int
    let servings: Int
    let ingredients: [Ingredient]
    let steps: [String]
    var onSave: (() -> Void)?
    /// Quando true mostra toolbar nativa con back (es. ricette salvate).
    var showsNavigationChrome = false
    /// Ricetta già in collezione: la stella parte piena.
    var isSaved = false
    /// Link al post da cui la ricetta è arrivata: mostra "Watch the
    /// original" per rivedere il video sul social.
    var sourceUrl: String?
    /// Presente solo per le ricette importate as-is: la trasformazione
    /// che l'utente aveva rimandato resta a un tap.
    var onVeganize: (() -> Void)?
    /// Ricetta curata da Cherry: il disclaimer sta qui dentro, non
    /// sopra tutta la collezione.
    var isCherryPick = false
    /// Scritta a mano dall'utente: niente etichette "AI-generated",
    /// qui non ha generato nulla nessun modello.
    var isUserAuthored = false
    /// Dalla Collection: si può riscrivere nome, foto, ingredienti, passi.
    var onEdit: (() -> Void)? = nil
    /// Dalla Collection: la ricetta si toglie da qui, dopo conferma.
    /// Chi la passa si occupa di chiudere il dettaglio.
    var onDelete: (() -> Void)? = nil

    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var saved = false
    @State private var confirmingDelete = false

    private var starred: Bool { saved || isSaved }

    private var originalLink: URL? { sourceUrl.flatMap(URL.init) }

    private var sourcePlatform: String {
        let host = originalLink?.host?.lowercased() ?? ""
        if host.contains("tiktok") { return "TikTok" }
        if host.contains("instagram") { return "Instagram" }
        if host.contains("youtu") { return "YouTube" }
        if host.contains("pinterest") { return "Pinterest" }
        if host.contains("facebook") { return "Facebook" }
        return "the web"
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                RecipePhoto(imageUrl: imageUrl, imageStatus: imageUrl == nil ? "failed" : "ready")
                    .frame(height: 260)
                    .clipShape(RoundedRectangle(cornerRadius: 24))
                    .overlay(alignment: .bottomTrailing) {
                        if !isUserAuthored {
                            AIGeneratedBadge(surface: .overlay)
                                .padding(10)
                        }
                    }

                HStack {
                    Text(title)
                        .font(Theme.display(28))
                        .foregroundStyle(Theme.ink)
                    Spacer()
                    if let onSave {
                        Button {
                            guard !starred else { return }
                            Haptics.success()
                            saved = true
                            onSave()
                        } label: {
                            Image(systemName: starred ? "star.fill" : "star")
                                .font(.system(size: 24))
                                .foregroundStyle(starred ? Theme.amber : Theme.subtle)
                        }
                    }
                }

                // Costo e tempo li stima l'AI: una ricetta scritta a
                // mano non li ha, e "$0 · 0 min" è peggio di niente.
                HStack(spacing: 14) {
                    if costUsd > 0 {
                        Label(appState.money(costUsd), systemImage: "dollarsign.circle.fill")
                            .foregroundStyle(Theme.amber)
                    }
                    if cookMinutes > 0 {
                        Label("\(cookMinutes) min", systemImage: "clock.fill")
                            .foregroundStyle(Theme.subtle)
                    }
                    Label("\(servings) servings", systemImage: "person.2.fill")
                        .foregroundStyle(Theme.subtle)
                }
                .font(Theme.body(14, weight: .semibold))

                if isCherryPick {
                    CherryPickNotice()
                }

                if onVeganize != nil || originalLink != nil {
                    originActions
                }

                Text("INGREDIENTS")
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(Theme.subtle)
                    .tracking(1.2)

                VStack(spacing: 0) {
                    ForEach(ingredients, id: \.name) { ingredient in
                        HStack {
                            Text(ingredient.name)
                                .font(Theme.body(15, weight: .medium))
                                .foregroundStyle(Theme.ink)
                            Spacer()
                            Text(ingredient.quantity)
                                .font(Theme.body(14))
                                .foregroundStyle(Theme.subtle)
                        }
                        .padding(.vertical, 10)
                        if ingredient.name != ingredients.last?.name {
                            Divider()
                        }
                    }
                }
                .padding(.horizontal, 16)
                .vegoCard()

                if !steps.isEmpty {
                    Text("STEPS")
                        .font(Theme.body(11, weight: .bold))
                        .foregroundStyle(Theme.subtle)
                        .tracking(1.2)

                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                            HStack(alignment: .top, spacing: 12) {
                                Text("\(index + 1)")
                                    .font(Theme.body(14, weight: .bold))
                                    .foregroundStyle(.white)
                                    .frame(width: 26, height: 26)
                                    .background(Circle().fill(Theme.brand))
                                Text(step)
                                    .font(Theme.body(15))
                                    .foregroundStyle(Theme.ink)
                            }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .vegoCard()
                }

                if !isUserAuthored {
                    AIGeneratedNote(text: "This recipe, its photo and the cost estimate were generated by AI. Double-check ingredients, quantities and allergens before cooking.")
                }

                Spacer(minLength: 40)
            }
            .padding(20)
        }
        .background(CherryBackground(mood: .warm))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(showsNavigationChrome)
        .toolbar { navigationToolbar }
        .alert("Delete this recipe?", isPresented: $confirmingDelete) {
            Button("Delete", role: .destructive) {
                Haptics.medium()
                onDelete?()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It leaves your collection for good. Lists you already built from it keep their items.")
        }
    }

    /// Azioni legate all'origine: veganizzare (se era stata salvata
    /// as-is) e rivedere il post da cui la ricetta è arrivata.
    private var originActions: some View {
        VStack(spacing: 10) {
            if let onVeganize {
                Button {
                    Haptics.medium()
                    onVeganize()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "wand.and.stars")
                            .font(.system(size: 15, weight: .semibold))
                        Text(SwapGoal.entryVerb(for: appState.tasteProfile.dietaryIdentity))
                            .font(Theme.body(16, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Theme.brandGradient, in: .capsule)
                }
                .buttonStyle(.plain)
            }

            if let originalLink {
                Link(destination: originalLink) {
                    HStack(spacing: 8) {
                        Image(systemName: "play.rectangle.fill")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Watch the original on \(sourcePlatform)")
                            .font(Theme.body(14, weight: .semibold))
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 12, weight: .bold))
                    }
                    .foregroundStyle(Theme.brand)
                    .padding(.horizontal, 16)
                    .frame(height: 46)
                    .frame(maxWidth: .infinity)
                    .glassEffect(.regular, in: .capsule)
                }
            }
        }
    }

    @ToolbarContentBuilder
    private var navigationToolbar: some ToolbarContent {
        if showsNavigationChrome {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    Haptics.light()
                    dismiss()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                        Text("Collection")
                            .font(Theme.body(16, weight: .semibold))
                    }
                    .foregroundStyle(Theme.brand)
                }
            }
        }
        // Solo "Edit" a vista: la cancellazione sta nel menu, dietro
        // una conferma. Se c'è solo il delete, il menu è tutto ciò che c'è.
        if let onEdit, onDelete == nil {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Edit") {
                    Haptics.light()
                    onEdit()
                }
                .font(Theme.body(16, weight: .semibold))
                .foregroundStyle(Theme.brand)
            }
        } else if onEdit != nil || onDelete != nil {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let onEdit {
                        Button {
                            Haptics.light()
                            onEdit()
                        } label: {
                            Label("Edit recipe", systemImage: "pencil")
                        }
                    }
                    if onDelete != nil {
                        Button(role: .destructive) {
                            confirmingDelete = true
                        } label: {
                            Label("Delete recipe", systemImage: "trash")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Theme.brand)
                }
                .accessibilityLabel("Recipe options")
            }
        }
    }
}
