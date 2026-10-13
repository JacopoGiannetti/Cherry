import SwiftUI

/// Cosa c'è davvero nella cucina dell'utente. Serve a non proporre una
/// teglia in forno a chi ha due fornelli, o un frullato a chi non ha il
/// frullatore: una ricetta che non puoi cucinare è una ricetta sprecata.
struct KitchenAppliance: Identifiable, Equatable {
    let id: String
    let icon: String
    let label: String
    /// Preselezionato la prima volta: quasi tutte le case ce l'hanno.
    let common: Bool
    /// Pastello della tile, scelto per stare con lo sfondo dell'illustrazione.
    let tint: Color

    var imageName: String { "appliance_\(id)" }

    static let all: [KitchenAppliance] = [
        KitchenAppliance(id: "stovetop", icon: "cooktop.fill", label: "Stovetop", common: true, tint: Theme.peach),
        KitchenAppliance(id: "oven", icon: "oven.fill", label: "Oven", common: true, tint: Theme.butter),
        KitchenAppliance(id: "microwave", icon: "microwave.fill", label: "Microwave", common: true, tint: Theme.sky),
        KitchenAppliance(id: "freezer", icon: "snowflake", label: "Freezer", common: true, tint: Theme.lavender),
        KitchenAppliance(id: "blender", icon: "tornado", label: "Blender", common: false, tint: Theme.mint),
        KitchenAppliance(id: "air_fryer", icon: "wind", label: "Air fryer", common: false, tint: Theme.blush),
        KitchenAppliance(id: "pressure_cooker", icon: "timer", label: "Pressure cooker", common: false, tint: Theme.peach),
        KitchenAppliance(id: "slow_cooker", icon: "hourglass", label: "Slow cooker", common: false, tint: Theme.butter),
        KitchenAppliance(id: "food_processor", icon: "fan.fill", label: "Food processor", common: false, tint: Theme.lavender),
        KitchenAppliance(id: "grill", icon: "flame.fill", label: "Grill", common: false, tint: Theme.mint),
    ]

    /// Cosa mostrare spuntato: le scelte salvate, o i comuni al primo giro.
    static func defaults(for profile: TasteProfile) -> Set<String> {
        if let saved = profile.appliances, !saved.isEmpty { return Set(saved) }
        return Set(all.filter(\.common).map(\.id))
    }

    static func labels(for ids: [String]) -> [String] {
        all.filter { ids.contains($0.id) }.map { $0.label.lowercased() }
    }
}

// Beat 3 del wizard. Si compila una volta sola: dalla spesa successiva
// le scelte arrivano già spuntate dal profilo, e cambiarle è un tap.
struct KitchenSetupView: View {
    let profile: TasteProfile
    let onConfirm: (_ appliances: [String], _ shareIngredients: Bool) -> Void

    @State private var selected: Set<String> = []
    @State private var shareIngredients = true
    @State private var loaded = false

    private var isReturning: Bool {
        profile.appliances?.isEmpty == false
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("What's in your\nkitchen?")
                .font(Theme.display(30))
                .foregroundStyle(Theme.brandGradient)
                .multilineTextAlignment(.center)
                .padding(.top, 20)

            Text(isReturning
                 ? "Same as last time — change it if something moved."
                 : "We'll only suggest recipes you can actually cook.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
                .padding(.horizontal, 30)

            ScrollView(showsIndicators: false) {
                KitchenApplianceGrid(selected: $selected)
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, 10)
            }

            shareRow
                .padding(.horizontal, 16)
                .padding(.bottom, 12)

            Button("Continue") {
                Haptics.success()
                onConfirm(KitchenAppliance.all.map(\.id).filter { selected.contains($0) }, shareIngredients)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(selected.isEmpty)
            .opacity(selected.isEmpty ? 0.45 : 1)
            .padding(.horizontal, 24)
            .padding(.bottom, 26)
        }
        .onAppear {
            // Una sola volta: tornando indietro dal budget non si
            // perdono le spunte appena cambiate.
            guard !loaded else { return }
            loaded = true
            selected = KitchenAppliance.defaults(for: profile)
            shareIngredients = profile.ingredientSharing ?? true
        }
    }

    /// Resta acceso finché non lo si spegne: la lista della spesa
    /// riusa le stesse erbe, scatolette e lo stesso tofu.
    private var shareRow: some View {
        Toggle(isOn: $shareIngredients) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Share ingredients")
                    .font(Theme.body(15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                Text("Recipes in this shop reuse the same herbs, cans and tofu, so the list stays shorter.")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.subtle)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Theme.brand)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
    }
}

/// La griglia degli elettrodomestici, tre per riga. La usano il wizard
/// della spesa e il quiz dell'onboarding: stesse tile, stesse spunte.
struct KitchenApplianceGrid: View {
    @Binding var selected: Set<String>

    var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3),
            spacing: 8
        ) {
            ForEach(KitchenAppliance.all) { appliance in
                tile(appliance)
            }
        }
    }

    private func tile(_ appliance: KitchenAppliance) -> some View {
        let isOn = selected.contains(appliance.id)
        return Button {
            Haptics.selection()
            if isOn { selected.remove(appliance.id) } else { selected.insert(appliance.id) }
        } label: {
            VStack(spacing: 0) {
                Image(appliance.imageName)
                    .resizable()
                    .scaledToFill()
                    .frame(height: 58)
                    .frame(maxWidth: .infinity)
                    .clipped()
                    // Il non selezionato resta presente ma spento.
                    .saturation(isOn ? 1 : 0.35)
                    .opacity(isOn ? 1 : 0.75)

                HStack(alignment: .top, spacing: 4) {
                    Text(appliance.label)
                        .font(Theme.body(11, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                        .minimumScaleFactor(0.75)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 13))
                        .foregroundStyle(isOn ? Theme.brand : Theme.subtle.opacity(0.35))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .frame(minHeight: 34, maxHeight: 34, alignment: .top)
                .frame(maxWidth: .infinity)
                .background(Theme.card.opacity(0.92))
            }
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(isOn ? Theme.brand : Theme.ink.opacity(0.08), lineWidth: isOn ? 2 : 1)
            )
            .shadow(color: isOn ? appliance.tint.opacity(0.9) : .clear, radius: 6, y: 2)
            .scaleEffect(isOn ? 1 : 0.97)
            .animation(.spring(duration: 0.3, bounce: 0.4), value: isOn)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(appliance.label)
        .accessibilityValue(isOn ? "selected" : "not selected")
    }
}
