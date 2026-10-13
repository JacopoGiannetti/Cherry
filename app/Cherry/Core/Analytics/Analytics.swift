import Foundation
import AppsFlyerLib
import AppTrackingTransparency

// Facciata unica per gli eventi di prodotto. Oggi dietro c'è AppsFlyer;
// il resto dell'app non deve saperlo.
//
// La dev key sta in `Secrets`, così lo SDK parte in `CherryApp.init()`
// senza aspettare la rete: l'install non si può recuperare e capita al
// primo avvio, quando la rete può non esserci.
//
// Se un domani fosse vuota c'è il ripiego su GET /config (Render), che
// accende AppsFlyer dopo un rilascio già fatto senza un update dello
// Store. Finché nessuna delle due c'è, lo SDK resta spento: niente
// crash, ma `log` ritorna false e il chiamante deve saperlo.
//
// @MainActor non è decorativo: `started` e la cache sono stato mutabile
// toccato sia dal ciclo di vita della scena sia dalla fetch di rete.
@MainActor
enum Analytics {
    private static var started = false
    private static var pendingUID: String?
    private static var fetching = false
    private static var warnedOff = false
    private static let defaults = UserDefaults.standard
    private static let cacheDevKey = "config.appsFlyerDevKey"
    private static let cacheAppID = "config.appleAppID"

    /// Lo SDK sta girando davvero. Chi registra eventi "una volta sola"
    /// deve guardare qui prima di segnarli come inviati.
    static var isLive: Bool { started }

    /// Chiamata da `CherryApp.init()` — l'equivalente SwiftUI di
    /// `didFinishLaunchingWithOptions`, l'unico punto che parte sempre —
    /// e di nuovo a ogni ritorno in foreground, come vuole AppsFlyer.
    ///
    /// NON agganciarla a `applicationDidBecomeActive`: in un'app a Scene
    /// quel callback dell'AppDelegate spesso non viene mai invocato e lo
    /// SDK resta spento in silenzio, con la dashboard vuota per mesi.
    /// Anche `onChange(of: scenePhase)` da solo non basta: a freddo può
    /// non scattare, e l'install è l'evento che non puoi recuperare.
    static func start() {
        guard !Secrets.appleAppID.isEmpty else { return }
        if started {
            AppsFlyerLib.shared().start()
            return
        }
        let key = resolvedDevKey
        if !key.isEmpty {
            boot(devKey: key, appleAppID: resolvedAppID)
            return
        }
        if !warnedOff {
            warnedOff = true
            print("[AppsFlyer] spento: nessuna dev key. La chiedo a \(Secrets.backendURL)/config.")
        }
        // Appena la key arriva, questo stesso avvio accende lo SDK
        // senza aspettare il prossimo.
        Task { await refreshFromBackend() }
    }

    /// L'uid Firebase come customerUserID: lega gli eventi alla persona
    /// anche quando cambia dispositivo. Va richiamata quando l'uid
    /// cambia davvero (login utente di ritorno, cancellazione account).
    static func identify(_ uid: String) {
        pendingUID = uid
        guard started else { return }
        AppsFlyerLib.shared().customerUserID = uid
    }

    /// Ritorna false se lo SDK è spento: l'evento NON è stato inviato.
    @discardableResult
    static func log(_ name: String, _ params: [String: Any] = [:]) -> Bool {
        guard started else { return false }
        AppsFlyerLib.shared().logEvent(name, withValues: params.isEmpty ? nil : params)
        return true
    }

    /// Registrazione completata (Sign in with Apple). Evento standard:
    /// le ad platform lo usano come conversione intermedia.
    @discardableResult
    static func logRegistration(method: String = "apple") -> Bool {
        log(AFEventCompleteRegistration, [AFEventParamRegistrationMethod: method])
    }

    /// Acquisto, trial o rinnovo di un abbonamento, con il ricavo vero
    /// preso da StoreKit. Manda gli eventi standard che tutte le ad
    /// platform capiscono: af_start_trial se è una prova, altrimenti
    /// af_purchase (per il ricavo) + af_subscribe (per la conversione).
    ///
    /// Ritorna false se lo SDK era spento: il chiamante deve NON
    /// segnare la transazione come già riportata, così l'evento parte
    /// al primo avvio in cui AppsFlyer è acceso, invece di sparire.
    @discardableResult
    static func logSubscription(
        productId: String,
        revenue: Decimal?,
        currency: String?,
        isTrial: Bool,
        expiresAt: Date?
    ) -> Bool {
        guard started else { return false }

        var params: [String: Any] = [
            AFEventParamContentId: productId,
            AFEventParamQuantity: 1,
        ]
        if let currency { params[AFEventParamCurrency] = currency }
        if let expiresAt {
            params["renewal_date"] = ISO8601DateFormatter().string(from: expiresAt)
        }

        if isTrial {
            // Durante la prova non incassi niente: mandare il prezzo
            // pieno gonfierebbe il ROAS e le campagne ottimizzerebbero
            // su un ricavo che non esiste ancora.
            params[AFEventParamRevenue] = 0
            return log(AFEventStartTrial, params)
        }

        if let revenue {
            params[AFEventParamRevenue] = NSDecimalNumber(decimal: revenue).doubleValue
        }
        log(AFEventPurchase, params)
        return log(AFEventSubscribe, params)
    }

    // MARK: - Chiavi

    /// Compilata vince; altrimenti la cache dell'ultimo /config.
    private static var resolvedDevKey: String {
        if !Secrets.appsFlyerDevKey.isEmpty { return Secrets.appsFlyerDevKey }
        return defaults.string(forKey: cacheDevKey) ?? ""
    }

    private static var resolvedAppID: String {
        if !Secrets.appleAppID.isEmpty { return Secrets.appleAppID }
        return defaults.string(forKey: cacheAppID) ?? ""
    }

    private static func boot(devKey: String, appleAppID: String) {
        guard !started, !devKey.isEmpty else { return }
        started = true
        AppsFlyerLib.shared().appsFlyerDevKey = devKey
        AppsFlyerLib.shared().appleAppID = appleAppID
        #if DEBUG
        // Se in console non vedi questo log all'avvio, lo SDK non è
        // partito: nessun logEvent successivo arriverà in dashboard.
        AppsFlyerLib.shared().isDebug = true
        print("[AppsFlyer] start() — appleAppID \(appleAppID.isEmpty ? "MANCANTE" : appleAppID)")
        #endif
        // Il prompt ATT arriva su TrustView, la settima schermata, a
        // 60-90 secondi dal primo avvio per chi legge. L'SDK trattiene
        // install ed eventi fino alla risposta (o allo scadere del
        // tempo) e li spedisce subito dopo: così l'IDFA di chi accetta
        // viaggia insieme all'install, l'unico momento in cui a Meta
        // serve. Chi chiude prima li perde, e li rimanda alla riapertura.
        //
        // L'attesa si accende solo per chi il prompt lo vedrà davvero.
        // Chi ha già finito l'onboarding su una versione senza prompt
        // resta "not determined" per sempre: se aspettassimo anche per
        // lui, ogni sua apertura terrebbe in memoria due minuti di
        // eventi — un acquisto compreso — pronti a sparire alla chiusura.
        // La chiave è la stessa che AppState scrive a onboarding finito.
        if ATTrackingManager.trackingAuthorizationStatus == .notDetermined,
           !defaults.bool(forKey: "phase.onboardingDone") {
            AppsFlyerLib.shared().waitForATTUserAuthorization(timeoutInterval: 120)
        }
        if let uid = pendingUID {
            AppsFlyerLib.shared().customerUserID = uid
        }
        AppsFlyerLib.shared().start()
    }

    private static func refreshFromBackend() async {
        guard !started, !fetching else { return }
        fetching = true
        defer { fetching = false }

        guard let url = URL(string: Secrets.backendURL + "/config") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }

        let key = (json["appsFlyerDevKey"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let appID = (json["appleAppID"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if !key.isEmpty { defaults.set(key, forKey: cacheDevKey) }
        if !appID.isEmpty { defaults.set(appID, forKey: cacheAppID) }

        guard !key.isEmpty else { return }
        boot(devKey: key, appleAppID: appID.isEmpty ? resolvedAppID : appID)
    }
}
