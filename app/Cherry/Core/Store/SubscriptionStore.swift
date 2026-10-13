import Foundation
import StoreKit

// Fonte di verità sull'abbonamento: StoreKit 2, direttamente da Apple.
// Superwall presenta il paywall e vende, ma chi ha accesso lo decide
// questo store: funziona offline, sopravvive alla reinstallazione e
// si accorge da solo quando un abbonamento scade o viene rimborsato.
@MainActor
final class SubscriptionStore: ObservableObject {
    @Published private(set) var isSubscribed = false
    /// Falso finché non si è letto l'entitlement almeno una volta:
    /// evita di mandare al paywall un abbonato durante l'avvio.
    @Published private(set) var hasChecked = false
    @Published private(set) var expiresAt: Date?
    /// nil quando Apple non risponde (offline, sandbox): in dubbio non
    /// si afferma né che rinnova né che scade.
    @Published private(set) var willAutoRenew: Bool?

    private var updatesTask: Task<Void, Never>?

    func start() async {
        await refresh()
        observeTransactions()
        #if DEBUG
        await Self.probeProducts()
        #endif
    }

    #if DEBUG
    /// Interroga StoreKit con gli stessi id configurati su Superwall.
    /// Superwall riporta solo "could not load products": qui si vede la
    /// risposta grezza di Apple, che è l'unica a distinguere fra id
    /// sbagliato, prodotto non ancora pronto e contratto non firmato.
    static func probeProducts() async {
        let ids = ["yearly_3999", "weekly_999"]
        print("[StoreKit] bundle id: \(Bundle.main.bundleIdentifier ?? "nil")")
        print("[StoreKit] storefront: \(await Storefront.current?.countryCode ?? "nessuno")")
        do {
            let products = try await Product.products(for: ids)
            if products.isEmpty {
                print("[StoreKit] NESSUN prodotto restituito per \(ids), e senza errore.")
                print("[StoreKit] → gli id non esistono per questo bundle, oppure i prodotti non sono 'Ready to Submit', oppure il contratto Paid Applications non è attivo.")
            }
            for product in products {
                print("[StoreKit] ok: \(product.id) — \(product.displayPrice)")
            }
            let missing = Set(ids).subtracting(products.map(\.id))
            if !missing.isEmpty { print("[StoreKit] mancanti: \(missing.sorted())") }
        } catch {
            print("[StoreKit] richiesta fallita: \(error)")
        }
    }
    #endif

    func refresh() async {
        var active = false
        var expiry: Date?
        var renewing: Bool?

        for await result in Transaction.currentEntitlements {
            // Le transazioni non verificate da Apple non contano.
            guard case .verified(let transaction) = result else { continue }
            guard transaction.revocationDate == nil else { continue }
            if let expiration = transaction.expirationDate, expiration <= Date() { continue }

            active = true
            if let expiration = transaction.expirationDate {
                expiry = max(expiry ?? expiration, expiration)
            }
            if let autoRenew = await autoRenewState(for: transaction) { renewing = autoRenew }
            report(transaction)
        }

        isSubscribed = active
        expiresAt = expiry
        willAutoRenew = active ? renewing : nil
        hasChecked = true
    }

    /// La transazione dice fino a quando l'abbonamento vale, non se si
    /// rinnoverà: quello sta nel renewal info del gruppo, ed è una
    /// chiamata a parte che può fallire senza rete.
    private func autoRenewState(for transaction: Transaction) async -> Bool? {
        guard let groupID = transaction.subscriptionGroupID,
              let statuses = try? await Product.SubscriptionInfo.status(for: groupID)
        else { return nil }

        let infos = statuses.compactMap { status -> RenewalInfo? in
            guard case .verified(let info) = status.renewalInfo else { return nil }
            return info
        }
        // Nel gruppo può esserci anche il piano che sta per subentrare:
        // conta quello che sta pagando adesso.
        let current = infos.first { $0.currentProductID == transaction.productID }
        return (current ?? infos.first)?.willAutoRenew
    }

    private typealias RenewalInfo = Product.SubscriptionInfo.RenewalInfo

    // MARK: - Attribuzione dei ricavi

    private static let reportedKey = "analytics.reportedTransactions"

    /// Un evento per transazione, mai due volte: il rinnovo ha un id
    /// nuovo, quindi viene contato come ricavo nuovo (giusto), mentre
    /// riaprire l'app sulla stessa transazione non conta niente.
    ///
    /// Se AppsFlyer è ancora spento (dev key non ancora sul backend)
    /// non si segna nulla: l'evento riparte al primo avvio in cui lo
    /// SDK è acceso, invece di perdersi.
    private func report(_ transaction: Transaction) {
        let id = String(transaction.id)
        var reported = Set(UserDefaults.standard.stringArray(forKey: Self.reportedKey) ?? [])
        guard !reported.contains(id) else { return }

        let sent = Analytics.logSubscription(
            productId: transaction.productID,
            revenue: transaction.price,
            currency: transaction.currency?.identifier,
            isTrial: transaction.offer?.type == .introductory,
            expiresAt: transaction.expirationDate
        )
        guard sent else { return }

        reported.insert(id)
        UserDefaults.standard.set(Array(reported), forKey: Self.reportedKey)
    }

    /// "Restore purchases": Apple risincronizza le transazioni dell'Apple ID.
    func restore() async {
        try? await AppStore.sync()
        await refresh()
    }

    /// Rinnovi, scadenze e rimborsi arrivano qui anche ad app aperta.
    private func observeTransactions() {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                guard case .verified(let transaction) = update else { continue }
                await transaction.finish()
                await self?.refresh()
            }
        }
    }
}
