import SwiftUI
import SuperwallKit

// Beat 3.7 + §8: hard paywall subito dopo l'onboarding.
//
// Qui non c'è una schermata nostra: solo il modale di Superwall, sopra
// il mesh di RootView. La pagina "Your profile is ready" con il bottone
// "Unlock Cherry" era un secondo pannello da chiudere, e soprattutto
// diceva la cosa sbagliata — che il paywall si potesse mettere da parte.
//
// Rifiutare non apre l'app: si passa all'offerta di abbandono e, se
// anche quella viene rifiutata, si torna all'offerta principale. L'unica
// via dentro è un abbonamento attivo o il ripristino di uno vecchio.
// La matrice prezzi e il design vivono nel dashboard Superwall; l'app
// registra i placement:
//   - "onboarding_paywall"  → paywall principale (annual pre-selezionato)
//   - "paywall_abandon"     → offerta di recupero, come schermata
//                             distinta (un evento, non un mercanteggio)
//
// Su un hard paywall l'abbandono non è la chiusura della schermata —
// quella non si può chiudere — ma il foglio di pagamento di Apple
// aperto e poi annullato: l'unico "no" che l'utente può dire. È lì che
// si innesca il recupero, una volta sola per sessione.
struct PaywallGateView: View {
    @EnvironmentObject private var appState: AppState
    @State private var blocked = false
    @State private var restoring = false
    /// L'offerta di abbandono è un di più: se la campagna non esiste o
    /// non prende questo utente, si smette di chiederla invece di
    /// riprovarci a ogni rifiuto.
    @State private var abandonUnavailable = false
    @State private var loadAttempts = 0

    /// Il recupero si offre una volta e basta: chi annulla il pagamento
    /// anche sull'offerta scontata resta lì, non viene rispedito al
    /// prezzo pieno né fatto girare in tondo fra due paywall.
    @State private var discountOffered = false
    /// Alza la mano mentre siamo noi a chiudere il paywall principale,
    /// così il `.declined` che ne consegue non fa partire un secondo
    /// tentativo in parallelo al nostro.
    @State private var swappingToDiscount = false

    /// Quanti colpi prima di arrendersi: il primo fallisce spesso
    /// perché la transizione non è finita o Superwall non ha ancora
    /// scaricato la campagna.
    private let maxAttempts = 4

    private var superwallConfigured: Bool { !Secrets.superwallAPIKey.isEmpty }

    var body: some View {
        Group {
            if blocked {
                // L'unico caso in cui l'utente vede qualcosa di nostro:
                // il paywall non è arrivato. Senza questa via d'uscita
                // resterebbe davanti a uno sfondo muto.
                fallback
            } else {
                ProgressView()
                    .controlSize(.large)
                    .tint(Theme.brand)
            }
        }
        .task { await presentWhenReady() }
        // La closure vive nel singleton: lasciarla attaccata a una view
        // sparita significa scrivere su stato che non esiste più.
        .onDisappear { SuperwallActions.shared.onCheckoutCancelled = nil }
    }

    /// Superwall presenta un UIKit modale. Se lo si chiama mentre
    /// RootView sta ancora animando, o prima che la campagna sia
    /// arrivata, `onError` / `noAudienceMatch` scattano e compariva
    /// questa schermata. Si aspetta una finestra stabile, poi si tenta.
    private func presentWhenReady() async {
        loadAttempts = 0
        blocked = false
        await waitUntilPresentable()
        guard !Task.isCancelled else { return }
        presentMainPaywall()
    }

    /// La transizione di fase dura `leisurely` (0,4s). Superwall vuole
    /// un root view controller già a schermo, non a metà animazione.
    private func waitUntilPresentable() async {
        try? await Task.sleep(for: .milliseconds(650))
        for _ in 0..<10 {
            if Superwall.shared.isPaywallPresented { return }
            if hasStablePresenter { return }
            try? await Task.sleep(for: .milliseconds(200))
        }
    }

    private var hasStablePresenter: Bool {
        guard let scene = UIWindowScene.active,
              let window = scene.keyWindow ?? scene.windows.first,
              let root = window.rootViewController,
              root.viewIfLoaded?.window != nil
        else { return false }
        return !root.isBeingPresented && !root.isBeingDismissed
    }

    private func retryMainPaywall() {
        loadAttempts += 1
        guard loadAttempts < maxAttempts else {
            blocked = true
            return
        }
        Task {
            try? await Task.sleep(for: .milliseconds(500 * loadAttempts))
            await waitUntilPresentable()
            guard !Task.isCancelled else { return }
            presentMainPaywall()
        }
    }

    /// Un messaggio umano, sempre lo stesso. Il motivo tecnico (campagna
    /// mancante, audience che non combacia, rete giù) va in console: a
    /// chi ha appena finito l'onboarding non si nominano i placement.
    private var fallback: some View {
        VStack(spacing: 20) {
            Spacer()

            CherryWordmark(height: CherryWordmarkSize.hero)

            Text("We couldn't load the plans right now.\nCheck your connection and try again.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Spacer()

            Button("Try again") {
                Task { await presentWhenReady() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.horizontal, 24)

            // Apple richiede che il ripristino sia raggiungibile: se il
            // paywall non carica, questo resta l'unico modo per un
            // abbonato di rientrare.
            Button {
                restoring = true
                Task {
                    await appState.subscriptions.restore()
                    restoring = false
                    if appState.hasAccess { appState.completePurchase() }
                }
            } label: {
                Text(restoring ? "Restoring…" : "Restore purchases")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.subtle)
            }
            .disabled(restoring)

            Spacer().frame(height: 40)
        }
    }

    // MARK: - Superwall

    private func presentMainPaywall() {
        guard superwallConfigured else {
            print("[Paywall] Secrets.superwallAPIKey è vuota: nessun paywall da mostrare.")
            blocked = true
            return
        }
        if Superwall.shared.isPaywallPresented { return }
        // Prima di registrare il placement: Superwall deve vedere lo
        // stesso stato di StoreKit, non il cache dei test sandbox.
        SuperwallActions.shared.syncSubscriptionStatus(
            isSubscribed: appState.subscriptions.isSubscribed
        )
        SuperwallActions.shared.onCheckoutCancelled = {
            Task { @MainActor in offerDiscountAfterCancel() }
        }
        blocked = false

        let handler = PaywallPresentationHandler()
        handler.onDismiss { _, result in
            Task { @MainActor in
                switch result {
                case .purchased, .restored:
                    appState.completePurchase()
                case .declined:
                    // §8: offerta di abbandono, presentata come evento distinto.
                    if swappingToDiscount {
                        return
                    } else if abandonUnavailable || discountOffered {
                        reopenMainPaywall()
                    } else {
                        presentAbandonOffer()
                    }
                }
            }
        }
        handler.onError { error in
            Task { @MainActor in
                print("[Paywall] onboarding_paywall non caricato: \(error.localizedDescription)")
                retryMainPaywall()
            }
        }
        handler.onSkip { reason in
            Task { @MainActor in handleMainSkip(reason) }
        }
        Superwall.shared.register(placement: "onboarding_paywall", handler: handler)
    }

    /// Foglio di Apple annullato: si scambia il prezzo pieno con
    /// l'offerta di recupero. Superwall tiene un paywall alla volta, e
    /// anche la loro funzione a pagamento fa così — chiude e riapre, non
    /// impila. A schermo è una dissolvenza.
    private func offerDiscountAfterCancel() {
        guard !discountOffered, !abandonUnavailable, superwallConfigured else { return }
        discountOffered = true
        swappingToDiscount = true
        Task { @MainActor in
            // Superwall deve prima finire di digerire il `.cancelled`
            // che gli ha restituito il PurchaseController: chiudergli il
            // paywall sotto i piedi a metà transazione lo confonde.
            try? await Task.sleep(for: .milliseconds(400))
            await Superwall.shared.dismiss()
            try? await Task.sleep(for: .milliseconds(350))
            presentAbandonOffer()
            swappingToDiscount = false
        }
    }

    private func presentAbandonOffer() {
        // Il `.declined` della chiusura programmatica e questa chiamata
        // arrivano dalla stessa mossa: senza guardia si finirebbe a
        // registrare il placement due volte.
        if Superwall.shared.isPaywallPresented { return }
        let handler = PaywallPresentationHandler()
        handler.onDismiss { _, result in
            Task { @MainActor in
                switch result {
                case .purchased, .restored:
                    appState.completePurchase()
                case .declined:
                    reopenMainPaywall()
                }
            }
        }
        handler.onError { error in
            Task { @MainActor in
                print("[Paywall] paywall_abandon non caricato: \(error.localizedDescription)")
                skipAbandonForGood()
            }
        }
        // Campagna assente, audience che non combacia, holdout: qualunque
        // sia il motivo, l'offerta di abbandono semplicemente non c'è.
        // Non è un errore da mostrare — e nemmeno un lasciapassare: si
        // torna al paywall principale. L'holdout vale solo sul placement
        // principale, dove significa "questo utente non deve vedere
        // paywall"; qui il paywall l'ha già visto e rifiutato.
        handler.onSkip { reason in
            Task { @MainActor in
                print("[Paywall] paywall_abandon saltato (\(reason)); si torna all'offerta principale.")
                skipAbandonForGood()
            }
        }
        Superwall.shared.register(placement: "paywall_abandon", handler: handler)
    }

    private func skipAbandonForGood() {
        abandonUnavailable = true
        reopenMainPaywall()
    }

    /// Un respiro prima di ripresentare: incollare un modale all'altro
    /// sembra un glitch, e iOS non gradisce due presentazioni sovrapposte.
    private func reopenMainPaywall() {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(450))
            presentMainPaywall()
        }
    }

    /// Superwall può decidere di non mostrare nulla. Senza gestirlo, la
    /// schermata resterebbe muta e sembrerebbe un bug dell'app.
    private func handleMainSkip(_ reason: PaywallSkippedReason) {
        switch reason {
        case .holdout:
            // Gruppo di controllo: per definizione non deve vedere un
            // paywall, quindi non può nemmeno restarne fuori.
            appState.grantPaywallBypass()
        case .placementNotFound, .noAudienceMatch:
            // Spesso è la config che non è ancora arrivata, non una
            // campagna davvero assente. Si ritenta; se persiste, fallback.
            print("[Paywall] onboarding_paywall saltato: \(reason). Controlla la campagna sul dashboard Superwall.")
            retryMainPaywall()
        }
    }
}
