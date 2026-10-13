import SwiftUI

/// I pain point della slide, con il dato che li giustifica e la funzione
/// che se ne occupa.
///
/// Ogni voce è una frase che l'utente potrebbe dire così, senza giri:
/// "non so mai cosa cucinare", non "trovare cene meat-free". Le prove
/// sotto vengono da Faunalytics (2014), che ha codificato 908 risposte
/// alla domanda "perché hai smesso", e la slide del grafico rilancia
/// quella che l'utente ha appena scelto per primo.
///
/// `cost` e `family` non si toccano più: restano nei documenti vecchi
/// su Firestore, la dashboard li etichetta ancora, ma qui non si
/// possono più scegliere.
enum OnboardingBlocker: String, CaseIterable, Identifiable {
    case inspiration
    case recipes
    case effort
    case grocery
    case eatingOut
    case swaps
    case labels

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .inspiration: "fork.knife"
        case .recipes: "play.rectangle.fill"
        case .effort: "calendar"
        case .grocery: "cart.fill"
        case .eatingOut: "menucard.fill"
        case .swaps: "arrow.triangle.2.circlepath"
        case .labels: "barcode.viewfinder"
        }
    }

    var label: String {
        switch self {
        case .inspiration: "I never know what to cook."
        case .recipes: "I save recipes and never cook them."
        case .effort: "Meal planning is difficult."
        case .grocery: "I never know what to put in the grocery list."
        case .eatingOut: "I never know what to order when I eat out."
        case .swaps: "I never know what to use instead of an ingredient."
        case .labels: "I never know what's really in what I buy."
        }
    }

    /// La risposta di Cherry. Una funzione che esiste davvero nell'app:
    /// niente promesse che poi non si trovano dentro.
    var answer: String {
        switch self {
        case .inspiration:
            "Cherry learns what you actually like and keeps putting dinners in front of you."
        case .recipes:
            "Send Cherry a recipe or a reel. Keep it as it is, or have it adapted to how you eat."
        case .effort:
            "Cherry plans the week with meals you'd actually eat."
        case .grocery:
            "Cherry turns the week into one list, already sorted by aisle."
        case .eatingOut:
            "Point Cherry at any menu and it tells you what fits you."
        case .swaps:
            "Tell Cherry the dish. It comes back with what to use instead, and it holds up."
        case .labels:
            "Scan a barcode and Cherry tells you what's in it, in a second."
        }
    }
}

// La consegna: l'utente riconosce il fastidio, e mentre lo fa
// legge l'elenco dei motivi per cui ha scaricato l'app.
//
// La domanda è "quali di questi ti sono familiari", non una
// confessione e non una lista di feature. Ogni riga è una frase
// che si potrebbe dire così. Il pulsante è l'ordine: Cherry se
// ne occupa.
//
// È l'ultima cosa che chiediamo, e la mettiamo qui apposta: la slide
// successiva è il grafico dell'abbandono, e senza questa risposta
// quel grafico sarebbe un poster valido per chiunque. Con questa
// risposta il grafico nomina il problema di chi lo sta guardando.
//
// Multi-selezione: nessuno molla per un motivo solo — lo dice lo
// studio stesso, e infatti la maggior parte delle persone ne elenca
// più di uno. Il primo tocco è quello che conta per il grafico.
struct BlockersView: View {
    let onDone: ([OnboardingBlocker]) -> Void

    /// In ordine di tocco: il primo è quello che pesa di più per
    /// l'utente, ed è quello che il grafico userà.
    @State private var picked: [OnboardingBlocker] = []
    @State private var shown = false

    var body: some View {
        // Le righe crescono quando vengono scelte, quindi lo scroll
        // serve sui telefoni piccoli; sugli altri i due Spacer si
        // spartiscono l'avanzo e la lista non resta appesa in alto.
        GeometryReader { geo in
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    // `fixedSize` verticale perché sette righe non ci
                    // stanno in una schermata: il VStack va in debito
                    // d'altezza e la prima cosa che comprime è il
                    // titolo, che si mangia la seconda riga e diventa
                    // "Which of these…". Così invece l'altezza la
                    // tiene, e l'avanzo lo assorbe lo scroll.
                    Text("Which of these\nfeel familiar?")
                        .font(Theme.display(28))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 26)

                    // Tetto basso: il titolo e la lista devono restare
                    // legati, l'avanzo va tutto sotto.
                    Spacer(minLength: 24).frame(maxHeight: 52)

                    VStack(spacing: 10) {
                        ForEach(Array(OnboardingBlocker.allCases.enumerated()), id: \.element.id) { index, blocker in
                            row(blocker)
                                .opacity(shown ? 1 : 0)
                                .offset(y: shown ? 0 : 18)
                                .animation(
                                    .spring(duration: 0.5, bounce: 0.2).delay(Double(index) * 0.06),
                                    value: shown
                                )
                        }
                    }

                    Spacer(minLength: 24)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 12)
                .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .safeAreaInset(edge: .bottom) { cta }
        .onAppear { shown = true }
    }

    private func row(_ blocker: OnboardingBlocker) -> some View {
        let isOn = picked.contains(blocker)
        return Button {
            // Corposo quando marca un problema, leggero quando lo
            // ritira: il dito sente la differenza tra le due cose.
            if isOn { Haptics.light() } else { Haptics.medium() }
            withAnimation(Theme.Motion.quick) {
                if let at = picked.firstIndex(of: blocker) {
                    picked.remove(at: at)
                } else {
                    picked.append(blocker)
                }
            }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: blocker.icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(isOn ? Theme.soft_red : Theme.brand)
                    .frame(width: 26)

                Text(blocker.label)
                    .font(Theme.body(15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 8)

                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 18))
                    .foregroundStyle(isOn ? Theme.soft_red : Theme.subtle.opacity(0.45))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect(cornerRadius: 18))
            // Rosso perché quello che sta marcando è un problema, non
            // una preferenza. Tenuto a una velatura e a un bordo
            // acceso: riempirla tutta spegnerebbe il testo e
            // trasformerebbe sette scelte in sette allarmi.
            .glassEffect(
                isOn ? .regular.tint(Theme.soft_red.opacity(0.3)) : .regular,
                in: .rect(cornerRadius: 18)
            )
            .overlay {
                if isOn {
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(Theme.soft_red.opacity(0.9), lineWidth: 1.6)
                }
            }
            // Due aloni sovrapposti: uno stretto che disegna il bordo,
            // uno largo che lo fa respirare sul fondo crema.
            .shadow(color: isOn ? Theme.soft_red.opacity(0.35) : .clear, radius: 5)
            .shadow(color: isOn ? Theme.soft_red.opacity(0.22) : .clear, radius: 16)
        }
        .buttonStyle(.plain)
    }

    private var cta: some View {
        VStack(spacing: 8) {
            Button(picked.isEmpty ? "Pick at least one" : "Let Cherry take care of it") {
                Haptics.light()
                onDone(picked)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(picked.isEmpty)
            .opacity(picked.isEmpty ? 0.55 : 1)
            .padding(.horizontal, 24)

            Text("Pick as many as you want.")
                .font(Theme.body(12, weight: .medium))
                .foregroundStyle(Theme.subtle)
        }
        .padding(.top, 8)
        .padding(.bottom, 20)
        .background(.ultraThinMaterial)
        .animation(Theme.Motion.quick, value: picked.isEmpty)
    }
}
