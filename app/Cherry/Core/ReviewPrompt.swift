import StoreKit
import UIKit

// Richiesta di recensione, agganciata ai due momenti in cui l'app ha
// appena mantenuto la promessa: la prima lista consegnata e la prima
// ricetta dei social riscritta per la sua dieta.
//
// Il popup non lo decide l'app: iOS lo mostra al massimo tre volte
// l'anno e si riserva di ignorare la richiesta senza dirlo. Per questo
// non si chiede "quando capita" — si chiede in un momento in cui la
// risposta sensata è cinque stelle, e una volta sola per traguardo.
@MainActor
enum ReviewPrompt {
    enum Milestone: String {
        /// La prima lista della spesa è comparsa a schermo.
        case listReady = "review.asked.listReady"
        /// La prima ricetta condivisa dai social è tornata riscritta,
        /// dopo "Make it vegan" / "Remove the meat".
        case swapReady = "review.asked.swapReady"
    }

    private static let defaults = UserDefaults.standard
    private static let lastAskedKey = "review.lastAskedAt"

    /// La richiesta sulla slide delle recensioni dell'onboarding.
    /// La accende la dashboard (GET /config); vale solo il valore letto
    /// in questo avvio, quindi senza rete resta spenta.
    private(set) static var onboardingEnabled = false

    static func loadRemoteSwitch() async {
        guard let url = URL(string: Secrets.backendURL + "/config") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        onboardingEnabled = json["onboardingReviewPrompt"] as? Bool == true
    }

    /// Due richieste a poche ore di distanza sono una sola: la seconda
    /// iOS la scarta, e il traguardo si consumerebbe senza che nessuno
    /// veda niente. Meglio tenerlo per la spesa dopo.
    private static let minimumInterval: TimeInterval = 3 * 24 * 60 * 60

    /// Chiede la recensione una volta per traguardo.
    ///
    /// `delay` lascia finire l'animazione che ha appena premiato
    /// l'utente: il popup sopra una schermata in transizione viene
    /// scartato dal sistema, e sarebbe un traguardo bruciato a vuoto.
    static func request(_ milestone: Milestone, after delay: TimeInterval) {
        guard !defaults.bool(forKey: milestone.rawValue) else { return }

        let last = defaults.double(forKey: lastAskedKey)
        guard last == 0 || Date().timeIntervalSince1970 - last > minimumInterval else { return }

        Task {
            try? await Task.sleep(for: .seconds(delay))
            // La scena può essere sparita nel frattempo (app in
            // background, schermo bloccato): in quel caso il traguardo
            // resta da spendere alla prossima occasione.
            guard let scene = UIWindowScene.active else { return }

            defaults.set(true, forKey: milestone.rawValue)
            defaults.set(Date().timeIntervalSince1970, forKey: lastAskedKey)
            AppStore.requestReview(in: scene)
        }
    }
}
