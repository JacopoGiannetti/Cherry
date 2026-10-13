import Foundation

// L'unico posto dell'app con valori "segreti". La repo resta privata.
// Il grosso delle chiavi vive nel backend (.env): qui solo il minimo
// indispensabile lato client.
enum Secrets {
    /// Metti true per lavorare contro il backend locale: vale solo nel
    /// simulatore, perché l'iPhone non vede il localhost del Mac.
    private static let useLocalBackend = false

    /// URL del backend (senza slash finale).
    static var backendURL: String {
        useLocalBackend ? "http://localhost:3000" : "https://cherry-backend-hqyn.onrender.com"
    }

    /// Stesso valore di HMAC_SECRET nel .env del backend.
    static let hmacSecret = "6abb7df666d610940cf21da74943200bcdc2cef9cf8426148c8938286efceab7"

    /// Public API key di Superwall (dashboard → Settings → Keys).
    static let superwallAPIKey = "pk_kQXfJ25myyxmGMvtfi3NM"

    /// AppsFlyer. Compilata qui, e non presa da GET /config, perché così
    /// l'SDK parte dentro `CherryApp.init()` senza aspettare la rete:
    /// l'install è l'unico evento irrecuperabile, e capita al primo
    /// avvio, cioè quando la rete può benissimo non esserci.
    ///
    /// È una chiave client, non un segreto: AppsFlyer la vuole nel
    /// binario ed è estraibile da qualunque .ipa. Il fallback su
    /// /config (Render: APPSFLYER_DEV_KEY) resta come rete di sicurezza,
    /// ma finché questa stringa è piena non viene mai usato.
    static let appsFlyerDevKey = "TarBKdGEettMmbfcnnwASN"
    /// Numero dell'app su App Store Connect. Vuoto = AppsFlyer spento.
    static let appleAppID = "6822337167"
}
