import SwiftUI

// Beat budget: una riga di vetro da trascinare, non un quadrante.
// Il numero resta il protagonista; il gesto è lo stesso di un volume,
// che al carrello si usa con una mano sola.
struct BudgetView: View {
    @EnvironmentObject private var appState: AppState
    let onConfirm: (Double, Int) -> Void

    @State private var budget: Double
    @State private var servings: Int = 2
    @State private var lastTick: Int = 10
    @State private var dragging = false
    @State private var docking = false

    private let minBudget: Double
    private let maxBudget: Double
    private let quickPicks: [Double]
    private let footnote: String?

    init(
        range: ClosedRange<Double> = 15...200,
        initialBudget: Double = 50,
        quickPicks: [Double] = [30, 50, 75],
        footnote: String? = nil,
        onConfirm: @escaping (Double, Int) -> Void
    ) {
        minBudget = range.lowerBound
        maxBudget = range.upperBound
        self.quickPicks = quickPicks
        self.footnote = footnote
        self.onConfirm = onConfirm
        _budget = State(initialValue: min(max(initialBudget, range.lowerBound), range.upperBound))
        _lastTick = State(initialValue: Int(initialBudget / 5))
    }

    var body: some View {
        // Gli Spacer distribuiscono, non riempiono il vuoto: il peso
        // visivo sta nella card hero e nelle file di vetro, così lo
        // spazio fra i blocchi è respiro e non un buco.
        VStack(spacing: 0) {
            VStack(spacing: 2) {
                Text("Set your budget")
                    .font(Theme.display(27))
                    .foregroundStyle(Theme.brandGradient)
                Text("Slide it, or tap an amount")
                    .font(Theme.body(13.5))
                    .foregroundStyle(Theme.subtle)
            }
            .padding(.top, 10)

            Spacer(minLength: 10)

            budgetHero
                .padding(.horizontal, 20)

            Spacer(minLength: 10)

            fineTuneRow
                .padding(.horizontal, 20)

            if let footnote {
                Text(footnote)
                    .font(Theme.body(11.5, weight: .medium))
                    .foregroundStyle(Theme.subtle.opacity(0.9))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 34)
                    .padding(.top, 12)
            }

            Spacer(minLength: 12)

            servingsPicker
                .padding(.horizontal, 20)

            Spacer(minLength: 12)

            Button("Lock it in") {
                Haptics.success()
                withAnimation(.easeIn(duration: 0.35)) { docking = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    onConfirm(budget, servings)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.horizontal, 24)
            .padding(.bottom, 22)
        }
    }

    // MARK: - La card del budget

    /// Cifra e barra nello stesso vetro tinto: prima galleggiavano
    /// separate su mezzo schermo vuoto e non sembravano un comando solo.
    private var budgetHero: some View {
        VStack(spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(appState.tasteProfile.moneySymbol)
                    .font(.system(size: 28, weight: .heavy, design: .rounded))
                Text("\(Int(budget))")
                    .font(.system(size: 66, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
            }
            .foregroundStyle(Theme.brandGradient)
            .animation(Theme.Motion.quick, value: Int(budget))
            .scaleEffect(docking ? 0.4 : 1)
            .opacity(docking ? 0 : 1)
            .offset(y: docking ? -80 : 0)

            HStack(spacing: 6) {
                Image(systemName: "fork.knife")
                    .font(.system(size: 11, weight: .bold))
                Text(dinnersLabel)
                    .font(Theme.body(12.5, weight: .bold))
                    .contentTransition(.numericText())
            }
            .foregroundStyle(Theme.brand)
            .padding(.horizontal, 13)
            .padding(.vertical, 7)
            .glassEffect(.regular.tint(Theme.mint.opacity(0.7)), in: .capsule)
            .animation(Theme.Motion.quick, value: dinnersLabel)

            slider
                .padding(.top, 4)

            HStack {
                Text(appState.money(minBudget))
                Spacer()
                Text(appState.money(maxBudget))
            }
            .font(Theme.body(11, weight: .bold))
            .foregroundStyle(Theme.subtle.opacity(0.8))
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity)
        .glassEffect(.regular.tint(Theme.mint.opacity(0.32)), in: .rect(cornerRadius: 34))
    }

    /// Traccia sottile con le tacche sotto e pomello bianco con anello
    /// verde: la barra alta 44pt riempita di vetro sembrava una
    /// progress bar rotta, e il vetro su 12pt cancella il gradiente.
    private var slider: some View {
        GeometryReader { geo in
            let knob: CGFloat = 30
            let track: CGFloat = 12
            let usable = max(geo.size.width - knob, 1)
            let x = CGFloat(fraction) * usable

            ZStack(alignment: .leading) {
                // Tacche: danno la scala e fanno sentire lo scatto da $5.
                HStack(spacing: 0) {
                    ForEach(0..<9, id: \.self) { i in
                        Capsule()
                            .fill(Theme.ink.opacity(i % 2 == 0 ? 0.16 : 0.09))
                            .frame(width: 2, height: i % 2 == 0 ? 9 : 5)
                        if i < 8 { Spacer(minLength: 0) }
                    }
                }
                .padding(.horizontal, knob / 2 - 1)
                .offset(y: 13)

                Capsule()
                    .fill(Theme.ink.opacity(0.08))
                    .frame(height: track)

                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [Theme.brand.opacity(0.7), Theme.brand],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(track, x + knob / 2), height: track)

                Circle()
                    .fill(.white)
                    .frame(width: knob, height: knob)
                    .overlay {
                        Circle().strokeBorder(Theme.brand, lineWidth: 3.5)
                    }
                    .shadow(color: Theme.brand.opacity(dragging ? 0.4 : 0.2), radius: dragging ? 12 : 5, y: 2)
                    .scaleEffect(dragging ? 1.15 : 1)
                    .offset(x: x)
            }
            .frame(height: 44)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        dragging = true
                        let raw = value.location.x - knob / 2
                        let t = min(max(raw / usable, 0), 1)
                        setBudget(minBudget + Double(t) * (maxBudget - minBudget))
                    }
                    .onEnded { _ in
                        dragging = false
                        withAnimation(Theme.Motion.quick) {
                            budget = (budget / 5).rounded() * 5
                        }
                    }
            )
            .animation(Theme.Motion.quick, value: dragging)
        }
        .frame(height: 44)
        .accessibilityLabel("Budget")
        .accessibilityValue("\(Int(budget)) dollars")
        .accessibilityAdjustableAction { direction in
            let step: Double = direction == .increment ? 5 : -5
            setBudget(min(maxBudget, max(minBudget, budget + step)))
        }
    }

    /// Vetro sul fondo cream, non dentro un'altra card: il vetro sopra
    /// il vetro si spegne e diventa una pillola grigia qualunque.
    private var fineTuneRow: some View {
        GlassEffectContainer(spacing: 14) {
            HStack(spacing: 9) {
                stepButton(systemName: "minus", amount: -5)

                ForEach(quickPicks, id: \.self) { amount in
                    let isOn = Int(budget) == Int(amount)
                    Button {
                        Haptics.medium()
                        withAnimation(Theme.Motion.signature) { budget = amount }
                    } label: {
                        Text(appState.money(amount))
                            .font(Theme.body(15, weight: .bold))
                            .foregroundStyle(isOn ? .white : Theme.brand)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(
                        isOn
                            ? .regular.tint(Theme.brand.opacity(0.92)).interactive()
                            : .regular.interactive(),
                        in: .capsule
                    )
                    .scaleEffect(isOn ? 1.04 : 1)
                    .animation(Theme.Motion.signature, value: isOn)
                }

                stepButton(systemName: "plus", amount: 5)
            }
        }
    }

    private func stepButton(systemName: String, amount: Double) -> some View {
        Button {
            Haptics.selection()
            withAnimation(Theme.Motion.quick) {
                budget = min(maxBudget, max(minBudget, budget + amount))
            }
        } label: {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .heavy))
                .foregroundStyle(Theme.brand)
                .frame(width: 44, height: 44)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
    }

    // MARK: - Coperti

    private var servingsPicker: some View {
        VStack(spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 12, weight: .bold))
                Text("Cooking for")
                    .font(Theme.body(14.5, weight: .bold))
                    .foregroundStyle(Theme.ink)
                Spacer()
                Text(perPersonLabel)
                    .font(Theme.body(12.5, weight: .semibold))
                    .foregroundStyle(Theme.subtle)
                    .contentTransition(.numericText())
                    .animation(Theme.Motion.quick, value: perPersonLabel)
            }
            .foregroundStyle(Theme.brand)
            .padding(.horizontal, 4)

            GlassEffectContainer(spacing: 14) {
                HStack(spacing: 8) {
                    ForEach(1...6, id: \.self) { count in
                        let isOn = servings == count
                        Button {
                            Haptics.selection()
                            withAnimation(Theme.Motion.signature) { servings = count }
                        } label: {
                            Text(count == 6 ? "6+" : "\(count)")
                                .font(Theme.body(16, weight: .bold))
                                .foregroundStyle(isOn ? .white : Theme.brand)
                                .frame(maxWidth: .infinity)
                                .frame(height: 48)
                                .contentShape(.circle)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(
                            isOn
                                ? .regular.tint(Theme.brand.opacity(0.92)).interactive()
                                : .regular.interactive(),
                            in: .circle
                        )
                        .scaleEffect(isOn ? 1.08 : 1)
                        .animation(Theme.Motion.signature, value: isOn)
                    }
                }
            }
        }
    }

    private var fraction: Double {
        (budget - minBudget) / (maxBudget - minBudget)
    }

    private func setBudget(_ value: Double) {
        budget = min(maxBudget, max(minBudget, value))
        let tick = Int(budget / 5)
        if tick != lastTick {
            lastTick = tick
            Haptics.selection()
        }
    }

    private var dinnersLabel: String {
        let dinners = max(1, Int((budget / (5 * Double(servings))).rounded()))
        return dinners == 1 ? "about 1 dinner" : "about \(dinners) dinners"
    }

    private var perPersonLabel: String {
        let each = Int((budget / Double(servings)).rounded())
        return servings == 1 ? "just for you" : "about \(appState.money(Double(each))) per person"
    }
}
