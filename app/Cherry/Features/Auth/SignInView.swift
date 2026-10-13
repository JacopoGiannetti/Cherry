import SwiftUI
import AuthenticationServices

// Sign in with Apple obbligatorio post-acquisto (§9.2): linka
// l'account anonimo, così quiz e acquisti sopravvivono.
struct SignInView: View {
    @EnvironmentObject private var appState: AppState
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 24) {
            CherryWordmark(height: CherryWordmarkSize.signIn)
                .padding(.top, 16)

            Spacer()

            Image(systemName: "person.crop.circle.badge.checkmark")
                .font(.system(size: 56))
                .foregroundStyle(Theme.brand)

            Text("Save your account")
                .font(Theme.display(32))
                .foregroundStyle(Theme.ink)

            Text("So your recipes and subscription\nare never lost.")
                .font(Theme.body())
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)

            Spacer()

            if let errorMessage {
                Text(errorMessage)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.soft_red)
            }

            // Qui l'onboarding è già stato fatto e l'acquisto pure: che
            // l'Apple ID sia nuovo o di ritorno non cambia niente.
            AppleSignInButton(auth: appState.auth) { outcome in
                switch outcome {
                case .signedIn:
                    errorMessage = nil
                    appState.completeSignIn()
                case .cancelled:
                    errorMessage = nil
                case .failed(let message):
                    errorMessage = message
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
        .background(CherryBackground(mood: .warm))
    }
}
