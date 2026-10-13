import SwiftUI
import StoreKit

// Le parole dei primi utenti, e il posto dove chiediamo una stella.
//
// Sono messaggi veri di persone che hanno provato Cherry, non recensioni
// pubbliche dell'App Store: per questo la schermata non imita l'App
// Store — niente voto medio, niente "100K+ ratings", niente conteggio.
// Le stelle sono quelle che hanno dato loro e il nome è il loro.
// Il titolo resta volutamente neutro: non dichiara una fonte che non
// possiamo dimostrare, e non chiede scusa per quante sono. Un
// aggregato gonfiato sarebbe metadato ingannevole per Apple e
// pubblicità ingannevole per la FTC.
//
// Qui sta anche la richiesta di recensione (§3.6), spostata dal
// movimento: il foglio di Apple arriva mentre si leggono le parole di
// altri, che è l'unico momento in cui chiedere una stella non è una
// domanda a freddo. Ed è anche l'unico punto dell'onboarding in cui la
// slide stessa spiega perché serve: recensioni pubbliche non ne
// abbiamo ancora.
struct ReviewsView: View {
    let onDone: () -> Void

    @Environment(\.requestReview) private var requestReview
    @State private var shown = false
    @State private var askedForReview = false
    @State private var canContinue = false

    private struct Review: Identifiable {
        let id: String
        let stars: Int
        let title: String
        let body: String
        let author: String
    }

    private static let reviews: [Review] = [
        Review(
            id: "alex",
            stars: 5,
            title: "Very practical for weekly meal prep",
            body: "I was stuck making the same three tofu stir-fries every week. The swiping interface makes picking dinners quick, and what I appreciate most is that the recipes actually share ingredients. Solid app.",
            author: "Alex M."
        ),
        Review(
            id: "jess",
            stars: 5,
            title: "Great for couples sharing groceries",
            body: "My partner and I share the grocery list. He can tick off the produce while I grab the pantry items, and it updates instantly without lag.",
            author: "Jess"
        ),
    ]

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Text("What people\nthink of us")
                    .font(Theme.display(28))
                    .foregroundStyle(Theme.ink)
                    .padding(.top, 22)

                VStack(spacing: 12) {
                    ForEach(Array(Self.reviews.enumerated()), id: \.element.id) { index, review in
                        card(review)
                            .opacity(shown ? 1 : 0)
                            .offset(y: shown ? 0 : 20)
                            .animation(
                                .spring(duration: 0.55, bounce: 0.2).delay(Double(index) * 0.08),
                                value: shown
                            )
                    }
                }
                .padding(.top, 24)
                .padding(.bottom, 20)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom) { cta }
        .onAppear {
            shown = true
            // Rete di sicurezza: se il task che chiede la recensione
            // non arrivasse mai (cancellato, o Apple che non mostra
            // niente), il pulsante si sblocca comunque. Lasciare
            // l'unica uscita dell'onboarding spenta per sempre sarebbe
            // molto peggio di una stella persa.
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) {
                withAnimation(Theme.Motion.quick) { canContinue = true }
            }
        }
        .task { await askForReview() }
    }

    private func card(_ review: Review) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 3) {
                ForEach(0..<5, id: \.self) { i in
                    Image(systemName: i < review.stars ? "star.fill" : "star")
                        .font(.system(size: 11))
                        .foregroundStyle(i < review.stars ? Theme.amber : Theme.subtle.opacity(0.35))
                }
            }

            Text(review.title)
                .font(Theme.body(15, weight: .bold))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text(review.body)
                .font(Theme.body(13.5))
                .foregroundStyle(Theme.subtle)
                .fixedSize(horizontal: false, vertical: true)

            Text(review.author)
                .font(Theme.body(12.5, weight: .semibold))
                .foregroundStyle(Theme.brand)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .vegoCard(cornerRadius: 20)
    }

    /// Spento fino a quando la richiesta non è partita. Se si potesse
    /// premere prima, il foglio di Apple avrebbe due destini e sono
    /// entrambi sbagliati: o non arriva mai, perché uscendo dalla
    /// schermata il task viene cancellato, o arriva addosso alla slide
    /// dopo, perché la view resta viva per l'animazione di uscita.
    private var cta: some View {
        Button("Keep going") {
            Haptics.light()
            onDone()
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(!canContinue)
        .opacity(canContinue ? 1 : 0.5)
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 20)
        .background(.ultraThinMaterial)
        .animation(Theme.Motion.quick, value: canContinue)
    }

    /// Il tempo di leggere la prima recensione prima che arrivi il
    /// foglio di Apple: piazzato subito sembra un popup pubblicitario,
    /// e il primo gesto della persona diventa "chiudi".
    private func askForReview() async {
        guard !askedForReview else { return }
        askedForReview = true
        guard ReviewPrompt.onboardingEnabled else {
            canContinue = true
            return
        }
        try? await Task.sleep(for: .seconds(2.4))
        guard !Task.isCancelled else { return }
        requestReview()
        // Da qui si può proseguire: la stella è stata chiesta, e se
        // Apple ha deciso di non mostrare niente non se ne accorge
        // nessuno.
        withAnimation(Theme.Motion.quick) { canContinue = true }
    }
}
