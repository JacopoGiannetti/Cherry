import Foundation

enum AppConfig {
    static let appGroupID = "group.com.cherry.jacopogiannetti.app"
    static let urlScheme = "cherry"

    /// Nome del database Firestore in console. Deve combaciare con
    /// FIREBASE_DATABASE_ID nel .env del backend, altrimenti app e
    /// backend leggerebbero e scriverebbero su database diversi.
    static let firestoreDatabaseID = "cherry"

    /// Chiave nel UserDefaults dell'App Group dove la share extension
    /// deposita l'URL condiviso (fallback se il deep link non parte).
    static let sharedURLDefaultsKey = "pendingSharedURL"

    /// Coda dei link condivisi in attesa: l'utente può mandarne diversi
    /// di fila restando sul social e trovarli tutti al prossimo accesso.
    static let sharedInboxDefaultsKey = "sharedInbox"

    /// Token Firebase scritto dall'app per la share extension: senza,
    /// l'extension può solo accodare il link, non avviare l'analisi.
    static let sharedAuthTokenKey = "firebaseIdToken"

    /// Limite di carte del deck per una run (§11: auto-completamento).
    static let deckAutoCompleteBudgetRatio = 1.0

    /// Documenti legali e contatti. Apple li vuole raggiungibili sia dai
    /// metadati su App Store Connect sia da dentro l'app, in un punto
    /// facile da trovare (linea guida 5.1.1(i)).
    enum Legal {
        static let privacyURL = URL(string: "https://hellovego.com/cherry/privacy")!
        static let termsURL = URL(string: "https://hellovego.com/cherry/terms")!
        static let supportEmail = "support@hellovego.com"
        static let privacyEmail = "privacy@hellovego.com"

        /// mailto con oggetto già compilato: chi scrive non deve spiegare
        /// da dove arriva.
        static func mail(to address: String, subject: String) -> URL? {
            var components = URLComponents(string: "mailto:\(address)")
            components?.queryItems = [URLQueryItem(name: "subject", value: subject)]
            return components?.url
        }
    }
}
