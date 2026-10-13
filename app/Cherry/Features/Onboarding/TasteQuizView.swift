import SwiftUI

// Il taste quiz (§3.4). Cinque domande veloci, una schermata ciascuna:
// i no-go a griglia, quello che proprio non puoi mangiare scritto a
// mano, il piccante, le cucine che ami, cosa c'è in cucina.
//
// Solo le prime tre entrano nel profilo che condiziona le ricette
// (no-go e intolleranze come esclusioni, il piccante). Cucine e
// cucina si chiedono e si salvano sull'utente, ma non vanno all'AI:
// le cucine si scelgono a ogni spesa nel ricettario, gli
// elettrodomestici li chiede il wizard quando servono. La dieta ha
// una schermata sua prima del paywall.
struct TasteQuizView: View {
    let onDone: (TasteProfile) -> Void

    private enum Stage: Int, CaseIterable {
        case noGo, cantEat, spice, cuisines, kitchen
        case tried, household, nights, nightsOk, time, why, apps
    }

    @EnvironmentObject private var appState: AppState
    @State private var stage: Stage = Stage(rawValue: Shot.quizStage ?? 0) ?? .noGo // SHOT
    @State private var noGo: Set<String> = []
    @State private var cantEatText = ""
    @State private var spiceChoice: String?
    @State private var cuisines: [String] = []
    @State private var appliances: Set<String> = Set(KitchenAppliance.all.filter(\.common).map(\.id))
    @State private var tried: String?
    @State private var household: String?
    @State private var nights = 3
    @State private var dinnerTime: String?
    @State private var reasons: Set<String> = []
    @State private var otherApps: String?
    @FocusState private var cantEatFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            meter
                .padding(.horizontal, 24)
                .padding(.top, 18)

            switch stage {
            case .noGo:
                ingredientGrid
            case .cantEat:
                cantEatStage
            case .spice:
                spiceStage
            case .cuisines:
                cuisinesStage
            case .kitchen:
                kitchenStage
            case .tried:
                triedStage
            case .household:
                householdStage
            case .nights:
                nightsStage
            case .nightsOk:
                nightsOkStage
            case .time:
                timeStage
            case .why:
                whyStage
            case .apps:
                appsStage
            }

            continueButton
        }
        .onAppear { track(stage) }
        .onChange(of: stage) { _, new in
            cantEatFocused = false
            track(new)
        }
    }

    /// Una schermata, uno step del funnel: ognuna chiede un gesto.
    /// `quizDone` lo manda il bottone finale.
    private func track(_ stage: Stage) {
        switch stage {
        case .noGo: appState.trackOnboarding(.quizIngredients)
        case .cantEat: appState.trackOnboarding(.quizCantEat)
        case .spice: appState.trackOnboarding(.quizSpice)
        case .cuisines: appState.trackOnboarding(.quizCuisines)
        case .kitchen: appState.trackOnboarding(.quizKitchen)
        case .tried: appState.trackOnboarding(.quizTried)
        case .household: appState.trackOnboarding(.quizHousehold)
        case .nights: appState.trackOnboarding(.quizNights)
        case .nightsOk: appState.trackOnboarding(.quizNightsOk)
        case .time: appState.trackOnboarding(.quizTime)
        case .why: appState.trackOnboarding(.quizWhy)
        case .apps: appState.trackOnboarding(.quizApps)
        }
    }

    // MARK: - Meter "profile X% built"

    private var percent: Int {
        // Una schermata, un pezzo. Sull'ultima risposta il meter
        // arriva a 100, così il profilo non sembra monco.
        let last = Double(Stage.apps.rawValue)
        var value = Double(stage.rawValue) / last * 100
        if stage == .noGo { value = Double(min(noGo.count, 4)) * 2 }
        if stage == .apps, otherApps != nil { value = 100 }
        return min(100, Int(value))
    }

    private var meter: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Your taste profile")
                    .font(Theme.body(13, weight: .semibold))
                    .foregroundStyle(Theme.subtle)
                Spacer()
                Text("\(percent)% built")
                    .font(Theme.body(13, weight: .bold))
                    .foregroundStyle(Theme.brand)
                    .contentTransition(.numericText())
                    .animation(Theme.Motion.signature, value: percent)
            }
            // Traccia piena e riempimento sopra: il vetro su una barra
            // di 10pt cancellava il gradiente e sbordava dalla card.
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Theme.ink.opacity(0.08))
                    Capsule()
                        .fill(Theme.brandGradient)
                        .frame(width: max(10, geo.size.width * CGFloat(percent) / 100))
                }
            }
            .frame(height: 10)
            .animation(Theme.Motion.slow, value: percent)
        }
        .padding(14)
        .vegoCard(cornerRadius: 20)
    }

    // MARK: - Round 1: ingredienti divisivi

    private var ingredientGrid: some View {
        VStack(spacing: 10) {
            Text("Tap what you'd\n\(Text("never eat").foregroundStyle(Theme.soft_red))")
                .font(Theme.display(26))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 14)

            Text("These never show up in your recipes again.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)

            ScrollView(showsIndicators: false) {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 2),
                    spacing: 12
                ) {
                    ForEach(Array(QuizContent.dividingIngredients.enumerated()), id: \.element.id) { index, tile in
                        let isOn = noGo.contains(tile.id)
                        Button {
                            Haptics.selection()
                            withAnimation(Theme.Motion.signature) {
                                if isOn { noGo.remove(tile.id) } else { noGo.insert(tile.id) }
                            }
                        } label: {
                            HStack(spacing: 12) {
                                Text(tile.emoji)
                                    .font(.system(size: 34))
                                    .grayscale(isOn ? 1 : 0)
                                    .scaleEffect(isOn ? 0.9 : 1)
                                Text(tile.label)
                                    .font(Theme.body(16, weight: .semibold))
                                    .foregroundStyle(isOn ? .white : Theme.ink)
                                    .lineLimit(2)
                                    .minimumScaleFactor(0.8)
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                                if isOn {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 18))
                                        .foregroundStyle(.white)
                                }
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 16)
                            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
                            .contentShape(.rect(cornerRadius: 22))
                            .glassEffect(
                                isOn ? .regular.tint(Theme.soft_red.opacity(0.85)).interactive() : .regular.interactive(),
                                in: .rect(cornerRadius: 22)
                            )
                            .scaleEffect(isOn ? 0.98 : 1)
                        }
                        .buttonStyle(.plain)
                        .vegoEntrance(index)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 8)
            }
        }
    }

    // MARK: - Quello che proprio non puoi mangiare

    /// Un box di testo, non una lista di spunte: allergie,
    /// intolleranze e le cose che proprio non vanno giù si scrivono
    /// come le diresti a un amico. Le chip sotto sono scorciatoie che
    /// finiscono nel testo, così resta una cosa sola da leggere.
    private var cantEatStage: some View {
        VStack(spacing: 14) {
            Text("Anything you really\ncan't eat?")
                .font(Theme.display(28))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 22)

            Text("Allergies, intolerances, or just things you hate.\nWe'll never put them in your food.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .lineSpacing(2)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 12) {
                    ZStack(alignment: .topLeading) {
                        if cantEatText.isEmpty {
                            Text("peanuts, lactose, mushrooms, cilantro…")
                                .font(Theme.body(16))
                                .foregroundStyle(Theme.subtle.opacity(0.6))
                                .padding(.horizontal, 18)
                                .padding(.vertical, 16)
                                .allowsHitTesting(false)
                        }
                        TextEditor(text: $cantEatText)
                            .font(Theme.body(16))
                            .foregroundStyle(Theme.ink)
                            .scrollContentBackground(.hidden)
                            .focused($cantEatFocused)
                            .submitLabel(.done)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 8)
                            .frame(minHeight: 132)
                    }
                    .background(Theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .strokeBorder(cantEatFocused ? Theme.brand : Theme.ink.opacity(0.08), lineWidth: cantEatFocused ? 2 : 1)
                    )
                    .animation(Theme.Motion.quick, value: cantEatFocused)
                    .onTapGesture { cantEatFocused = true }

                    FlowChips(all: QuizContent.exclusionSuggestions, selected: selectedChips) { chip in
                        Haptics.selection()
                        toggleCantEat(chip)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 4)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    /// Le scorciatoie già presenti nel testo, da mostrare accese.
    private var selectedChips: Set<String> {
        let lower = Set(cantEatItems.map { $0.lowercased() })
        return Set(QuizContent.exclusionSuggestions.filter { lower.contains($0.lowercased()) })
    }

    /// Il testo spezzato su virgole e a capo, pulito.
    private var cantEatItems: [String] {
        cantEatText
            .split(whereSeparator: { $0 == "," || $0.isNewline || $0 == ";" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private func toggleCantEat(_ chip: String) {
        var items = cantEatItems
        if let index = items.firstIndex(where: { $0.caseInsensitiveCompare(chip) == .orderedSame }) {
            items.remove(at: index)
        } else {
            items.append(chip.lowercased())
        }
        cantEatText = items.joined(separator: ", ")
    }

    // MARK: - Piccante

    /// Prima si deduceva in silenzio dai piatti scelti; ora si chiede,
    /// pre-compilando la risposta con quella deduzione come ipotesi.
    private var spiceStage: some View {
        VStack(spacing: 14) {
            Text("How spicy do\nyou like it?")
                .font(Theme.display(28))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 22)

            Text("Every recipe gets seasoned to match.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 12) {
                    ForEach(spiceOptions, id: \.id) { option in
                        let isOn = spiceChoice == option.id
                        Button {
                            Haptics.medium()
                            spiceChoice = option.id
                        } label: {
                            HStack(spacing: 14) {
                                Text(option.emoji)
                                    .font(.system(size: 34))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(option.title)
                                        .font(Theme.title(18))
                                        .foregroundStyle(isOn ? .white : Theme.ink)
                                    Text(option.blurb)
                                        .font(Theme.body(13))
                                        .foregroundStyle(isOn ? .white.opacity(0.85) : Theme.subtle)
                                }
                                Spacer()
                                if isOn {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 24))
                                        .foregroundStyle(.white)
                                }
                            }
                            .padding(18)
                            .contentShape(.rect(cornerRadius: Theme.cornerRadius))
                            .glassEffect(
                                isOn ? .regular.tint(Theme.amber.opacity(0.9)) : .regular,
                                in: .rect(cornerRadius: Theme.cornerRadius)
                            )
                            .animation(Theme.Motion.quick, value: isOn)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 6)
            }
        }
        .onAppear {
            if spiceChoice == nil {
                spiceChoice = inferredSpiceTolerance
            }
        }
    }

    private var spiceOptions: [(id: String, emoji: String, title: String, blurb: String)] {
        [
            ("mild", "🌿", "Keep it mild", "No heat. Flavor comes from herbs and spices."),
            ("medium", "🌶️", "Some kick", "A little warmth is welcome, nothing extreme."),
            ("hot", "🔥", "Bring the fire", "The spicier, the better."),
        ]
    }

    // MARK: - Cucine preferite

    private struct Cuisine: Identifiable {
        let id: String
        let emoji: String
    }

    private static let cuisineOptions: [Cuisine] = [
        Cuisine(id: "Italian", emoji: "🍝"),
        Cuisine(id: "Mexican", emoji: "🌮"),
        Cuisine(id: "Japanese", emoji: "🍜"),
        Cuisine(id: "Greek", emoji: "🥙"),
        Cuisine(id: "Thai", emoji: "🥥"),
        Cuisine(id: "Indian", emoji: "🍛"),
        Cuisine(id: "American", emoji: "🍔"),
        Cuisine(id: "Chinese", emoji: "🥡"),
        Cuisine(id: "Middle Eastern", emoji: "🧆"),
        Cuisine(id: "Korean", emoji: "🍚"),
    ]

    private var cuisinesStage: some View {
        VStack(spacing: 10) {
            Text("Which cuisines\ndo you love?")
                .font(Theme.display(28))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 22)

            Text("Pick as many as you like.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)

            ScrollView(showsIndicators: false) {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 2),
                    spacing: 12
                ) {
                    ForEach(Array(Self.cuisineOptions.enumerated()), id: \.element.id) { index, cuisine in
                        let isOn = cuisines.contains(cuisine.id)
                        Button {
                            Haptics.selection()
                            withAnimation(Theme.Motion.signature) {
                                if isOn { cuisines.removeAll { $0 == cuisine.id } } else { cuisines.append(cuisine.id) }
                            }
                        } label: {
                            HStack(spacing: 12) {
                                Text(cuisine.emoji)
                                    .font(.system(size: 30))
                                    .scaleEffect(isOn ? 1.1 : 1)
                                Text(cuisine.id)
                                    .font(Theme.body(16, weight: .semibold))
                                    .foregroundStyle(isOn ? .white : Theme.ink)
                                    .lineLimit(2)
                                    .minimumScaleFactor(0.8)
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                                if isOn {
                                    Image(systemName: "heart.fill")
                                        .font(.system(size: 16))
                                        .foregroundStyle(.white)
                                        .transition(.scale.combined(with: .opacity))
                                }
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 16)
                            .frame(maxWidth: .infinity, minHeight: 66, alignment: .leading)
                            .contentShape(.rect(cornerRadius: 22))
                            .glassEffect(
                                isOn ? .regular.tint(Theme.brand.opacity(0.9)).interactive() : .regular.interactive(),
                                in: .rect(cornerRadius: 22)
                            )
                        }
                        .buttonStyle(.plain)
                        .vegoEntrance(index)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 8)
            }
        }
    }

    // MARK: - Cosa c'è in cucina

    private var kitchenStage: some View {
        VStack(spacing: 10) {
            Text("What's in your\nkitchen?")
                .font(Theme.display(28))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 22)

            Text("Tap what you actually have.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)

            ScrollView(showsIndicators: false) {
                KitchenApplianceGrid(selected: $appliances)
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 8)
            }
        }
    }

    // MARK: - Hai già provato

    private var triedStage: some View {
        pickStage(
            title: "Have you tried\nplanning your meals?",
            subtitle: "Just so we know where you're starting.",
            options: [
                ("never", "📝", "Not yet", "This would be my first real go."),
                ("bounced", "↩️", "I tried, then stopped", "It got hard to keep up."),
                ("already", "🗓️", "I already do", "I want the day to day to get easier."),
            ],
            selected: tried
        ) { tried = $0 }
    }

    // MARK: - Per chi cucini

    private var householdStage: some View {
        pickStage(
            title: "Who do you\ncook for?",
            subtitle: "Dinners change a lot with who's at the table.",
            options: [
                ("me", "👤", "Just me", "I cook for one."),
                ("couple", "💛", "Two of us", "Me and someone else."),
                ("family", "👨‍👩‍👧", "A family", "Kids, parents, a full table."),
                ("mixed", "🍽️", "A mixed table", "Everyone at dinner eats a bit differently."),
            ],
            selected: household
        ) { household = $0 }
    }

    // MARK: - Quante sere

    private var nightsStage: some View {
        VStack(spacing: 14) {
            Text("How many nights a week\ndo you want to cook?")
                .font(Theme.display(28))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 22)

            Text("A number you can actually keep.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)

            Spacer()

            Text("\(nights)")
                .font(Theme.display(88))
                .foregroundStyle(Theme.brandGradient)
                .contentTransition(.numericText())
                .animation(Theme.Motion.signature, value: nights)

            Text(nights == 1 ? "night a week" : "nights a week")
                .font(Theme.body(16, weight: .semibold))
                .foregroundStyle(Theme.subtle)

            HStack(spacing: 10) {
                ForEach(1...7, id: \.self) { n in
                    let isOn = nights == n
                    Button {
                        Haptics.selection()
                        nights = n
                    } label: {
                        Text("\(n)")
                            .font(Theme.body(16, weight: .bold))
                            .foregroundStyle(isOn ? .white : Theme.ink)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(isOn ? Theme.brand : Theme.card.opacity(0.7), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 18)

            Spacer()
        }
    }

    private var nightsOkStage: some View {
        VStack(spacing: 18) {
            Spacer()
            Text("\(nights)")
                .font(Theme.display(88))
                .foregroundStyle(Theme.brandGradient)
            Text(nightsOkTitle)
                .font(Theme.display(28))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
            Text(nightsOkLine)
                .font(Theme.body(16))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 36)
            Spacer()
        }
    }

    private var nightsOkTitle: String {
        switch nights {
        case 1, 2: "That's a realistic start."
        case 6, 7: "That's a real rhythm."
        default: "That's a solid week."
        }
    }

    private var nightsOkLine: String {
        switch nights {
        case 1: "One night you can keep beats seven you drop."
        case 7: "Every night is a lot. Cherry is there for the nights it gets messy."
        default: "Keep \(nights) nights, and the rest of the week gets easier too."
        }
    }

    // MARK: - Tempo a cena

    private var timeStage: some View {
        pickStage(
            title: "How long do you\nwant dinner to take?",
            subtitle: "On a normal weeknight.",
            options: [
                ("15", "⚡️", "About 15 minutes", "In, out, done."),
                ("30", "⏱️", "About 30 minutes", "A proper cook, not a project."),
                ("cook", "👩‍🍳", "I like to cook", "Give me a recipe worth the time."),
            ],
            selected: dinnerTime
        ) { dinnerTime = $0 }
    }

    // MARK: - Perché

    private var whyStage: some View {
        VStack(spacing: 14) {
            Text("What matters\nmost to you?")
                .font(Theme.display(28))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 22)

            Text("Pick every reason that counts.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 12) {
                    ForEach(whyOptions, id: \.id) { option in
                        let isOn = reasons.contains(option.id)
                        Button {
                            Haptics.selection()
                            if isOn { reasons.remove(option.id) } else { reasons.insert(option.id) }
                        } label: {
                            pickRow(option.emoji, option.title, option.blurb, isOn: isOn, tint: Theme.brand)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 6)
            }
        }
    }

    private var whyOptions: [(id: String, emoji: String, title: String, blurb: String)] {
        [
            ("health", "💪", "How I feel", "Energy, body, the long run."),
            ("money", "💸", "Spending less", "Fewer takeaways, less food in the bin."),
            ("time", "⏱️", "Saving time", "Less thinking about what's for dinner."),
            ("taste", "😋", "Eating better", "Food I actually look forward to."),
        ]
    }

    // MARK: - Altre app

    private var appsStage: some View {
        pickStage(
            title: "Have you used another\napp for this?",
            subtitle: "Recipe apps, scanners, anything like Cherry.",
            options: [
                ("no", "✨", "No, this is the first", "We're starting from scratch."),
                ("yes", "📱", "Yes, I've tried others", "They didn't quite stick."),
            ],
            selected: otherApps
        ) { otherApps = $0 }
    }

    private func pickStage(
        title: String,
        subtitle: String,
        options: [(id: String, emoji: String, title: String, blurb: String)],
        selected: String?,
        onPick: @escaping (String) -> Void
    ) -> some View {
        VStack(spacing: 14) {
            Text(title)
                .font(Theme.display(28))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 22)

            Text(subtitle)
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 12) {
                    ForEach(options, id: \.id) { option in
                        let isOn = selected == option.id
                        Button {
                            Haptics.medium()
                            onPick(option.id)
                        } label: {
                            pickRow(option.emoji, option.title, option.blurb, isOn: isOn, tint: Theme.brand)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 6)
            }
        }
    }

    private func pickRow(_ emoji: String, _ title: String, _ blurb: String, isOn: Bool, tint: Color) -> some View {
        HStack(spacing: 14) {
            Text(emoji)
                .font(.system(size: 34))
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.title(18))
                    .foregroundStyle(isOn ? .white : Theme.ink)
                Text(blurb)
                    .font(Theme.body(13))
                    .foregroundStyle(isOn ? .white.opacity(0.85) : Theme.subtle)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            if isOn {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(.white)
            }
        }
        .padding(18)
        .contentShape(.rect(cornerRadius: Theme.cornerRadius))
        .glassEffect(
            isOn ? .regular.tint(tint.opacity(0.9)) : .regular,
            in: .rect(cornerRadius: Theme.cornerRadius)
        )
        .animation(Theme.Motion.quick, value: isOn)
    }

    // MARK: - Avanzamento

    private var canContinue: Bool {
        switch stage {
        case .spice: spiceChoice != nil
        case .kitchen: !appliances.isEmpty
        case .tried: tried != nil
        case .household: household != nil
        case .time: dinnerTime != nil
        case .why: !reasons.isEmpty
        case .apps: otherApps != nil
        default: true
        }
    }

    private var continueLabel: String {
        switch stage {
        case .apps: "Build my profile"
        case .nightsOk: "Sounds right"
        case .cantEat where cantEatText.isEmpty: "Nothing, I eat it all"
        case .cuisines where cuisines.isEmpty: "I like them all"
        default: "Continue"
        }
    }

    private var continueButton: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                if stage != .noGo {
                    Button("Back") {
                        Haptics.light()
                        guard let previous = Stage(rawValue: stage.rawValue - 1) else { return }
                        withAnimation(Theme.Motion.signature) { stage = previous }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(width: 110)
                }

                Button(continueLabel) {
                    Haptics.light()
                    if let next = Stage(rawValue: stage.rawValue + 1) {
                        withAnimation(Theme.Motion.signature) { stage = next }
                    } else {
                        finish()
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canContinue)
                .opacity(canContinue ? 1 : 0.45)
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 16)
        }
        .animation(Theme.Motion.quick, value: stage)
        .animation(Theme.Motion.quick, value: continueLabel)
    }

    private func finish() {
        appState.trackOnboarding(.quizDone)
        // Cucine, cucina e il resto delle domande restano sull'utente,
        // fuori dal profilo che va all'AI.
        appState.saveQuizPreferences(
            cuisines: cuisines,
            appliances: KitchenAppliance.all.map(\.id).filter { appliances.contains($0) },
            tried: tried,
            household: household,
            nights: nights,
            dinnerTime: dinnerTime,
            reasons: Array(reasons),
            otherApps: otherApps
        )
        onDone(buildProfile())
    }

    // MARK: - Costruzione del profilo

    private func buildProfile() -> TasteProfile {
        let noGoLabels = QuizContent.dividingIngredients
            .filter { noGo.contains($0.id) }
            .map { $0.label.lowercased() }

        return TasteProfile(
            // La dieta si scieglie dopo, nella sua schermata prima
            // del paywall: qui resta il default, che quella
            // sovrascrive prima che il profilo venga salvato.
            dietaryIdentity: .omnivore,
            exclusions: noGoLabels + cantEatItems.map { $0.lowercased() },
            cuisineAffinities: [],
            spiceTolerance: spiceChoice ?? inferredSpiceTolerance,
            effortTolerance: "balanced",
            likedDishes: [],
            lovedDishes: [],
            dislikedDishes: [],
            neutralDishes: []
        )
    }

    /// Senza piatti votati resta un segnale solo: il chili tra i no-go.
    private var inferredSpiceTolerance: String {
        noGo.contains("chili") ? "mild" : "medium"
    }
}

// MARK: - Chips a flusso

struct FlowChips: View {
    let all: [String]
    let selected: Set<String>
    let onTap: (String) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8)], spacing: 8) {
            ForEach(all, id: \.self) { chip in
                let isOn = selected.contains(chip)
                Button {
                    onTap(chip)
                } label: {
                    Text(chip)
                        .font(Theme.body(14, weight: .semibold))
                        .foregroundStyle(isOn ? .white : Theme.ink)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity)
                        .contentShape(.capsule)
                        .glassEffect(
                            isOn ? .regular.tint(Theme.soft_red.opacity(0.85)) : .regular,
                            in: .capsule
                        )
                        .animation(Theme.Motion.quick, value: isOn)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
