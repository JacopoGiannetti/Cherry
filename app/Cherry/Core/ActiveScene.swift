import UIKit

extension UIWindowScene {
    /// La scena su cui presentare qualcosa adesso.
    ///
    /// I fogli di sistema (recensione, gestione abbonamento, riscatto
    /// codici) vogliono una scena, e non una qualsiasi: quella davanti
    /// all'utente. Con l'app in background non ce n'è nessuna, ed è
    /// giusto che chi chiama lo sappia invece di presentare nel vuoto.
    @MainActor
    static var active: UIWindowScene? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
    }
}
