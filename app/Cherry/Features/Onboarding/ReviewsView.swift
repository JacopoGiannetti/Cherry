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
        Review(
            id: "priya",
            stars: 5,
            title: "Finally stopped wasting groceries",
            body: "Half a bag of spinach used to die in my fridge every week. Cherry plans meals that use up what I buy, so nothing gets thrown out anymore.",
            author: "Priya S."
        ),
        Review(
            id: "marco",
            stars: 5,
            title: "Dinner decisions in 30 seconds",
            body: "Swiping through recipes is weirdly fun. I pick the week's dinners on the bus and the grocery list builds itself.",
            author: "Marco T."
        ),
        Review(
            id: "hannah",
            stars: 5,
            title: "Perfect for a busy student",
            body: "Cheap, simple recipes that don't need ten fancy ingredients. My weekly shop got smaller and I actually cook now.",
            author: "Hannah L."
        ),
        Review(
            id: "daniel",
            stars: 5,
            title: "Our whole family uses it",
            body: "Everyone swipes on what they'd like to eat, and we cook the matches. No more 'I don't know, what do you want?'",
            author: "Daniel R."
        ),
        Review(
            id: "sofia",
            stars: 5,
            title: "The grocery list is a game changer",
            body: "Ingredients are grouped by aisle, so I'm in and out of the store in 15 minutes. Can't go back to paper lists.",
            author: "Sofia G."
        ),
        Review(
            id: "tom",
            stars: 5,
            title: "Great for trying new things",
            body: "I discovered dishes I'd never have searched for. Swiping makes it easy to take a chance on something new.",
            author: "Tom B."
        ),
        Review(
            id: "chloe",
            stars: 5,
            title: "Meal prep made simple",
            body: "I prep on Sundays and Cherry tells me exactly what to buy. Lunches sorted for the whole week.",
            author: "Chloe W."
        ),
        Review(
            id: "ben",
            stars: 5,
            title: "Clean and easy to use",
            body: "No clutter, no endless scrolling through blog posts. Just the recipe, the ingredients and the steps.",
            author: "Ben K."
        ),
        Review(
            id: "elena",
            stars: 5,
            title: "Saves me money every month",
            body: "Because recipes share ingredients, I buy less and use everything. My grocery bill dropped noticeably.",
            author: "Elena V."
        ),
        Review(
            id: "sam",
            stars: 5,
            title: "Flexible for every diet",
            body: "I eat meat, my roommate doesn't. We both find recipes we like and shop together without any hassle.",
            author: "Sam J."
        ),
    ]

    /// Due file, alternate: chi legge una fila non ritrova la stessa
    /// recensione accanto nell'altra.
    private static var rows: [[Review]] {
        [
            reviews.enumerated().filter { $0.offset.isMultiple(of: 2) }.map(\.element),
            reviews.enumerated().filter { !$0.offset.isMultiple(of: 2) }.map(\.element),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("What people\nthink of us")
                .font(Theme.display(28))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 24)
                .padding(.top, 22)
                .opacity(shown ? 1 : 0)
                .offset(y: shown ? 0 : 12)
                .animation(.spring(duration: 0.5, bounce: 0.1), value: shown)

            Spacer(minLength: 16)

            // Le due file vanno in versi opposti e a velocità diverse:
            // nessuna delle due sembra un nastro trasportatore, e
            // insieme danno profondità. Entrano dal lato da cui
            // scorrono, la seconda un attimo dopo.
            VStack(spacing: 14) {
                ForEach(Array(Self.rows.enumerated()), id: \.offset) { index, row in
                    let leftward = index == 0
                    ReviewMarquee(speed: leftward ? 26 : -20) {
                        ForEach(row) { card($0) }
                    }
                    .opacity(shown ? 1 : 0)
                    .offset(x: shown ? 0 : (leftward ? 90 : -90))
                    .animation(
                        .spring(duration: 0.8, bounce: 0.18).delay(0.12 + Double(index) * 0.12),
                        value: shown
                    )
                }
            }

            Spacer(minLength: 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

            Spacer(minLength: 0)

            Text(review.author)
                .font(Theme.body(12.5, weight: .semibold))
                .foregroundStyle(Theme.brand)
        }
        .padding(16)
        .frame(width: 264, alignment: .leading)
        .frame(maxHeight: .infinity, alignment: .topLeading)
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

/// Una fila di card che scorre senza fine. Velocità costante: è un
/// nastro che si legge, e un'accelerazione lo renderebbe illeggibile.
/// `speed` in punti al secondo; positiva verso sinistra.
///
/// Il contenuto è disegnato due volte di fila e l'offset riparte dopo
/// una copia intera, così il giro non ha cuciture. Tenendo il dito
/// sopra la fila si ferma, per finire di leggere una card.
private struct ReviewMarquee<Content: View>: View {
    let speed: Double
    @ViewBuilder let content: () -> Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var copyWidth: CGFloat = 0
    @State private var start = Date()
    @State private var pausedAt: Date?
    @State private var pausedTotal: TimeInterval = 0

    private let spacing: CGFloat = 12

    var body: some View {
        if reduceMotion {
            ScrollView(.horizontal, showsIndicators: false) {
                strip.padding(.horizontal, 24)
            }
        } else {
            TimelineView(.animation(paused: pausedAt != nil)) { context in
                HStack(alignment: .top, spacing: spacing) {
                    strip.onGeometryChange(for: CGFloat.self) { $0.size.width } action: { copyWidth = $0 + spacing }
                    strip
                }
                .offset(x: offset(at: pausedAt ?? context.date))
                // Larga quanto lo schermo: il nastro vero è lungo migliaia
                // di punti e allargherebbe tutta la schermata.
                .containerRelativeFrame(.horizontal, alignment: .leading)
            }
            // Niente maschera ai bordi: il vetro delle card dentro una
            // maschera disegna una fascia rettangolare dietro la fila.
            .contentShape(.rect)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        if pausedAt == nil { pausedAt = Date() }
                    }
                    .onEnded { _ in
                        guard let pausedAt else { return }
                        pausedTotal += Date().timeIntervalSince(pausedAt)
                        self.pausedAt = nil
                    }
            )
        }
    }

    /// Card tutte alte come la più alta: una fila a gradini sembra un
    /// errore di impaginazione, non un nastro.
    private var strip: some View {
        HStack(alignment: .top, spacing: spacing) { content() }
            .fixedSize()
    }

    private func offset(at date: Date) -> CGFloat {
        guard copyWidth > 0 else { return 0 }
        let elapsed = max(0, date.timeIntervalSince(start) - pausedTotal)
        let travelled = CGFloat(elapsed * abs(speed)).truncatingRemainder(dividingBy: copyWidth)
        return speed > 0 ? -travelled : travelled - copyWidth
    }
}
