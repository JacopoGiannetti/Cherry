import StoreKit
import SuperwallKit
import UIKit

// Il ponte fra i bottoni disegnati nel dashboard Superwall e il codice
// dell'app.
//
// Serve perché Superwall non sa riscattare i codici App Store: le sue
// azioni native "Apply Discount" e "Redeem Purchase" valgono per il Web
// Checkout con Stripe, non per gli offer code di Apple. Il paywall può
// solo dire "hanno premuto questo bottone"; il foglio di riscatto lo
// apre l'app. Senza questo delegate il bottone nel footer è muto.
final class SuperwallActions: NSObject, SuperwallDelegate, PurchaseController {
    static let shared = SuperwallActions()
    private override init() { super.init() }

    /// StoreKit è la fonte di verità. Superwall deve chiedere a noi
    /// quando vende e quando chiede lo stato, altrimenti dopo un
    /// acquisto sandbox si tiene l'entitlement anche se Apple lo ha
    /// già fatto scadere — e skippa il paywall (`no_rule_match`).
    weak var subscriptions: SubscriptionStore?

    /// Chiamata a foglio di riscatto chiuso: l'entitlement va riletto da
    /// Apple prima di decidere se l'utente è dentro.
    var onRedeemFinished: (() -> Void)?

    /// Il foglio di Apple aperto e poi chiuso senza pagare. È l'unico
    /// abbandono osservabile su un hard paywall — quello della schermata
    /// non esiste, perché la schermata non si può chiudere. Superwall lo
    /// vende come `transaction_abandon`, ma qui gli acquisti passano dal
    /// PurchaseController, quindi il segnale è già in casa.
    var onCheckoutCancelled: (() -> Void)?

    /// Allinea Superwall a StoreKit. Senza PurchaseController Superwall
    /// gestisce da solo gli entitlement e "Show to unsubscribed" diventa
    /// `size(device.activeEntitlements) == 0` sul *suo* cache, non su Apple.
    func syncSubscriptionStatus(isSubscribed: Bool) {
        guard !Secrets.superwallAPIKey.isEmpty else { return }
        Superwall.shared.subscriptionStatus = isSubscribed
            ? .active([Entitlement(id: "pro")])
            : .inactive
    }

    @MainActor
    func purchase(product: StoreProduct) async -> PurchaseResult {
        guard let sk2 = product.sk2Product else {
            return .failed(StorePurchaseError.unavailable)
        }
        do {
            let result = try await sk2.purchase()
            switch result {
            case .success(.verified(let transaction)):
                await transaction.finish()
                await subscriptions?.refresh()
                syncSubscriptionStatus(isSubscribed: subscriptions?.isSubscribed ?? true)
                return .purchased
            case .success(.unverified(_, let error)):
                return .failed(error)
            case .userCancelled:
                onCheckoutCancelled?()
                return .cancelled
            case .pending:
                return .pending
            @unknown default:
                return .cancelled
            }
        } catch {
            return .failed(error)
        }
    }

    @MainActor
    func restorePurchases() async -> RestorationResult {
        await subscriptions?.restore()
        syncSubscriptionStatus(isSubscribed: subscriptions?.isSubscribed ?? false)
        return .restored
    }

    /// I nomi che il bottone può avere nel template.
    ///
    /// Il nome non è una keyword di Superwall — è una stringa scelta a
    /// mano nel dashboard, e cambia da template a template. Accettarne
    /// più d'una evita che il bottone resti muto per una lettera di
    /// differenza, cosa che dall'app non si vede in nessun modo.
    private static let redeemActions: Set<String> = [
        "redeem_code", "redeemcode", "redeem", "promo_code", "offer_code",
    ]

    // `@MainActor` come nel protocollo: le altre firme del delegate hanno
    // un'implementazione di default vuota, quindi una che non combacia
    // compila in silenzio e non viene mai chiamata.
    @MainActor
    func handleCustomPaywallAction(withName name: String) {
        let action = name.trimmingCharacters(in: .whitespaces).lowercased()
        guard Self.redeemActions.contains(action) else {
            // Non è un errore: il template può avere altri bottoni. Ma a
            // schermo non si distingue da un bottone rotto, quindi vale
            // la pena vederlo in console.
            print("[Paywall] azione custom non gestita: \"\(name)\"")
            return
        }
        Task { await presentRedeemSheet() }
    }

    @MainActor
    private func presentRedeemSheet() async {
        guard let scene = UIWindowScene.active else { return }
        do {
            try await AppStore.presentOfferCodeRedeemSheet(in: scene)
        } catch {
            // Il foglio di sistema non compare sempre: in sandbox spesso
            // non esiste proprio, ed è noto per fallire anche in
            // produzione. L'App Store riscatta lo stesso codice da web.
            print("[Paywall] foglio offer code non disponibile: \(error.localizedDescription)")
            openAppStoreRedeemPage()
            return
        }

        // Un codice riscattato è una transazione StoreKit come le altre,
        // quindi arriverebbe comunque da `Transaction.updates`. Rileggere
        // subito evita che l'utente resti fermo davanti al paywall che ha
        // appena superato.
        onRedeemFinished?()
    }

    @MainActor
    private func openAppStoreRedeemPage() {
        guard !Secrets.appleAppID.isEmpty,
              let url = URL(string: "https://apps.apple.com/redeem?ctx=offercodes&id=\(Secrets.appleAppID)")
        else { return }
        UIApplication.shared.open(url)
    }
}

private enum StorePurchaseError: LocalizedError {
    case unavailable
    var errorDescription: String? { "This plan isn't available right now." }
}
