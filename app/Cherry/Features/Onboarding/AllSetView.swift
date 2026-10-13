import SwiftUI

// Beat 3.6: profile reveal. La richiesta di recensione stava qui, ma il
// picco di goodwill si è spostato più avanti: adesso l'utente prova la
// spesa e la recensione si chiede davanti alla lista finita, quando ha
// in mano qualcosa che l'app ha costruito per lui.
//
// Qui si restituisce all'utente TUTTO quello che ha appena detto, per
// esteso: i no-go e le allergie uno per uno, il piccante. Il senso di
// questa schermata è far vedere che siamo stati ad ascoltare.
struct AllSetView: View {
    let profile: TasteProfile
    /// Le cucine che ama, dal quiz: non stanno nel profilo (non vanno
    /// all'AI) ma qui si restituiscono come tutto il resto.
    var cuisines: [String] = []
    let onDone: () -> Void

    @State private var revealed = false

    /// Chi salta il quiz arriva qui senza niente da mostrare: circa un
    /// utente su quattro. Zeri sotto la scritta "il tuo profilo è
    /// pronto" sono peggio del silenzio, quindi in quel caso la
    /// schermata cambia mestiere e promette di imparare strada facendo.
    private var isBlank: Bool {
        profile.exclusions.isEmpty && cuisines.isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    header

                    if isBlank {
                        learnAsYouGoCard
                    } else {
                        statsRow
                    }

                    if !cuisines.isEmpty {
                        section(
                            title: "YOU LOVE",
                            accent: Theme.brand,
                            tint: Theme.mint.opacity(0.55),
                            items: cuisines
                        )
                    }

                    if !profile.exclusions.isEmpty {
                        section(
                            title: "NEVER ON YOUR PLATE",
                            accent: Theme.ink.opacity(0.7),
                            tint: Theme.ink.opacity(0.06),
                            items: profile.exclusions.map { $0.capitalized }
                        )
                    }

                    if !isBlank {
                        spiceCard
                    }

                    Text(isBlank
                         ? "Every recipe you swipe teaches Cherry\na little more about you."
                         : "Every recipe, menu verdict and swap\nwill be built around this.")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.subtle)
                        .multilineTextAlignment(.center)
                        .padding(.top, 4)

                    Spacer(minLength: 20)
                }
                .padding(.horizontal, 22)
                .opacity(revealed ? 1 : 0)
                .offset(y: revealed ? 0 : 24)
            }
        }
        .safeAreaInset(edge: .bottom) {
            // Dopo questa schermata c'è ancora una domanda, quindi non
            // si promette di mostrare niente: "Show me" e poi un'altra
            // domanda è un piccolo tradimento.
            Button("One last thing") { onDone() }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 24)
                .padding(.bottom, 20)
        }
        .onAppear {
            withAnimation(.spring(duration: 0.6, bounce: 0.35).delay(0.15)) {
                revealed = true
            }
        }
    }

    // MARK: - Blocchi

    /// La mascotte piccola, un timbro non un eroe: il contenuto qui è il
    /// profilo. Niente badge della dieta: qui non è ancora stata
    /// scelta, e mostrare il default significherebbe promettere a un
    /// futuro pescetariano una vita senza pesce.
    private var header: some View {
        VStack(spacing: 8) {
            CherryMascotView(size: 66, pose: .cheer, active: revealed)
                .padding(.bottom, 2)

            Text(isBlank ? "You're all set" : "Your taste profile\nis ready")
                .font(Theme.display(30))
                .foregroundStyle(Theme.brandGradient)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 16)
    }

    /// Il posto dei contatori quando non c'è nulla da contare: dice
    /// cosa succede adesso, invece di certificare un profilo vuoto.
    private var learnAsYouGoCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(Self.blankPromises.enumerated()), id: \.offset) { _, promise in
                HStack(spacing: 12) {
                    Text(promise.0)
                        .font(.system(size: 26))
                        .frame(width: 42, height: 42)
                        .background(Theme.mint.opacity(0.5), in: .circle)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(promise.1)
                            .font(Theme.body(15, weight: .bold))
                            .foregroundStyle(Theme.ink)
                        Text(promise.2)
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.subtle)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .vegoCard()
    }

    private static let blankPromises: [(String, String, String)] = [
        ("👋", "We'll learn as you go", "No quiz needed. Cherry picks up your taste from what you swipe."),
        ("🛒", "Your first list is one tap away", "Tell it a meal, get the ingredients and the cost."),
        ("📷", "Scan anything", "Menus, labels and recipes, judged against how you eat."),
    ]

    /// Tre numeri: i no-go, le cucine che ama, il piccante su tre.
    private var statsRow: some View {
        HStack(spacing: 10) {
            stat("\(profile.exclusions.count)", label: profile.exclusions.count == 1 ? "no-go" : "no-gos")
            stat(cuisines.isEmpty ? "All" : "\(cuisines.count)", label: cuisines.count == 1 ? "cuisine" : "cuisines")
            stat("\(spiceLevel)/3", label: "heat")
        }
    }

    private func stat(_ value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(Theme.display(24))
                .foregroundStyle(Theme.brandGradient)
            Text(label)
                .font(Theme.body(11, weight: .semibold))
                .foregroundStyle(Theme.subtle)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
    }

    private func section(title: String, accent: Color, tint: Color, items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(Theme.body(11, weight: .bold))
                .foregroundStyle(accent)
                .tracking(1.2)

            // Adaptive: i nomi lunghi vanno a capo invece di essere tagliati.
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], spacing: 8) {
                ForEach(items, id: \.self) { item in
                    Text(item)
                        .font(Theme.body(13, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .padding(.horizontal, 10)
                        .background(tint, in: .rect(cornerRadius: 14))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var spiceCard: some View {
        HStack(spacing: 12) {
            HStack(spacing: 2) {
                ForEach(0..<3, id: \.self) { index in
                    Text("🌶️")
                        .font(.system(size: 20))
                        .opacity(index < spiceLevel ? 1 : 0.2)
                        .grayscale(index < spiceLevel ? 0 : 1)
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(spiceHeadline)
                    .font(Theme.body(15, weight: .bold))
                    .foregroundStyle(Theme.ink)
                Text(spiceDetail)
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.subtle)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .vegoCard()
    }

    // MARK: - Testi derivati


    private var spiceLevel: Int {
        switch profile.spiceTolerance {
        case "mild": 1
        case "hot": 3
        default: 2
        }
    }

    private var spiceHeadline: String {
        switch profile.spiceTolerance {
        case "mild": "Keep it gentle"
        case "hot": "Bring the heat"
        default: "A little kick"
        }
    }

    private var spiceDetail: String {
        switch profile.spiceTolerance {
        case "mild": "We'll leave the chili on the side."
        case "hot": "Spicy dishes get pushed to the top of your deck."
        default: "Warm, not painful."
        }
    }
}
