import SwiftUI
import AuthenticationServices

// Bottone Sign in with Apple riusato in login post-acquisto e
// nel flusso "utente di ritorno".
struct AppleSignInButton: View {
    /// Deliberatamente una reference semplice, non @EnvironmentObject:
    /// osservare AppState farebbe ridisegnare il pulsante a ogni
    /// aggiornamento di Firestore o dell'abbonamento, e ogni ridisegno
    /// può far ricostruire a SwiftUI la richiesta di Apple mentre quella
    /// vera è ancora in volo.
    let auth: AuthService
    let onResult: (AppleAuthOutcome) -> Void

    var body: some View {
        SignInWithAppleButton(.continue) { request in
            auth.prepareAppleRequest(request)
        } onCompletion: { result in
            Task {
                let outcome = await auth.handleAppleCompletion(result)
                if case .signedIn = outcome { Haptics.success() }
                onResult(outcome)
            }
        }
        .signInWithAppleButtonStyle(.black)
        .frame(height: 54)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
