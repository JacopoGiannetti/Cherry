import Foundation
import FirebaseAuth
import AuthenticationServices
import CryptoKit

// Autenticazione: anonima e invisibile al primo avvio (§9.2),
// poi Sign in with Apple OBBLIGATORIO dopo l'acquisto, che LINKA
// l'account anonimo così i dati dell'onboarding sopravvivono.
@MainActor
final class AuthService: ObservableObject {
    @Published private(set) var uid: String?
    @Published private(set) var isAppleLinked = false

    /// Gli ultimi nonce generati, non solo l'ultimo.
    ///
    /// SwiftUI può ricostruire la richiesta più di una volta per un
    /// singolo tap — basta un ridisegno mentre il foglio di Apple è già
    /// aperto, e su iPad in compatibilità succede quasi sempre. Con un
    /// solo slot il nonce buono veniva sovrascritto e Firebase rifiutava
    /// il token ("nonce does not match the SHA256 hash of the raw
    /// nonce"). Tenendoli tutti si può ritrovare quello giusto.
    private var issuedNonces: [String] = []

    /// In modalità demo (senza Firebase) si usa un uid fittizio locale.
    static let demoUID = "demo-user"

    func start() async {
        guard FirebaseBootstrap.isConfigured else {
            uid = Self.demoUID
            return
        }
        if let user = Auth.auth().currentUser {
            adopt(user)
            return
        }
        do {
            let result = try await Auth.auth().signInAnonymously()
            adopt(result.user)
        } catch {
            print("[Auth] sign-in anonimo fallito: \(error.localizedDescription)")
        }
    }

    private func adopt(_ user: User) {
        uid = user.uid
        isAppleLinked = user.providerData.contains { $0.providerID == "apple.com" }
    }

    func idToken() async throws -> String {
        guard FirebaseBootstrap.isConfigured, let user = Auth.auth().currentUser else {
            throw CherryError.demoMode
        }
        let token = try await user.getIDToken()
        persistShareExtensionToken(token)
        return token
    }

    /// La share extension non ha Firebase: deposita l'ultimo token
    /// nell'App Group così, se l'utente continua a scrollare, l'analisi
    /// parte lo stesso senza aspettare la riapertura dell'app.
    func persistShareExtensionToken() async {
        guard let token = try? await idToken() else { return }
        persistShareExtensionToken(token)
    }

    private func persistShareExtensionToken(_ token: String) {
        UserDefaults(suiteName: AppConfig.appGroupID)?
            .set(token, forKey: AppConfig.sharedAuthTokenKey)
    }

    // MARK: - Cancellazione account

    /// Dopo che il backend ha cancellato dati e utente Firebase: si
    /// chiude la sessione e se ne apre subito una nuova, anonima.
    /// L'app resta usabile — riparte dall'onboarding, come al primo
    /// avvio — senza obbligare a riaprirla.
    func resetAfterDeletion() async {
        UserDefaults(suiteName: AppConfig.appGroupID)?
            .removeObject(forKey: AppConfig.sharedAuthTokenKey)
        uid = nil
        isAppleLinked = false

        guard FirebaseBootstrap.isConfigured else {
            uid = Self.demoUID
            return
        }
        try? Auth.auth().signOut()
        await start()
    }

    // MARK: - Sign in with Apple (link dell'account anonimo)

    func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) {
        let nonce = Self.randomNonce()
        issuedNonces.append(nonce)
        if issuedNonces.count > 8 { issuedNonces.removeFirst() }
        request.requestedScopes = [.email]
        request.nonce = Self.sha256(nonce)
    }

    /// Ritrova il nonce originale che corrisponde al token appena
    /// ricevuto. Il token porta dentro l'hash di quello usato per la
    /// SUA richiesta: confrontarlo è l'unico modo affidabile di sapere
    /// quale dei nonce generati sia quello giusto.
    private func rawNonce(matching idToken: String) -> String? {
        guard let hashed = Self.hashedNonce(in: idToken) else { return issuedNonces.last }
        return issuedNonces.first { Self.sha256($0) == hashed } ?? issuedNonces.last
    }

    /// Il claim `nonce` dal payload dell'ID token (un JWT: header,
    /// payload e firma separati da punti, in base64url).
    private static func hashedNonce(in idToken: String) -> String? {
        let segments = idToken.split(separator: ".")
        guard segments.count > 1 else { return nil }

        var base64 = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)

        guard let data = Data(base64Encoded: base64),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return payload["nonce"] as? String
    }

    private static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Linka la credenziale Apple all'utente anonimo. Se l'account Apple
    /// esiste già (utente di ritorno), fa sign-in su quell'account.
    ///
    /// L'annullamento non è un errore: chi chiude il foglio di Apple ha
    /// deciso, e mostrargli "qualcosa è andato storto" è una bugia.
    func handleAppleCompletion(_ result: Result<ASAuthorization, Error>) async -> AppleAuthOutcome {
        guard FirebaseBootstrap.isConfigured else {
            isAppleLinked = true // demo: si prosegue
            return .signedIn(isReturning: true)
        }

        switch result {
        case .failure(let error):
            if let authError = error as? ASAuthorizationError, authError.code == .canceled {
                return .cancelled
            }
            print("[Auth] Sign in with Apple fallito: \(error.localizedDescription)")
            return .failed("Apple couldn't complete the sign-in. Please try again.")

        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let tokenString = String(data: tokenData, encoding: .utf8),
                  let nonce = rawNonce(matching: tokenString)
            else { return .failed("Apple didn't return a valid credential.") }

            let firebaseCredential = OAuthProvider.appleCredential(
                withIDToken: tokenString,
                rawNonce: nonce,
                fullName: credential.fullName
            )
            return await signIn(with: firebaseCredential)
        }
    }

    private func signIn(with credential: AuthCredential) async -> AppleAuthOutcome {
        do {
            if let user = Auth.auth().currentUser {
                // Il link riesce solo se questo Apple ID non era legato a
                // nessun account Cherry: non è un ritorno, è un account che
                // nasce adesso sopra l'utente anonimo.
                let linked = try await user.link(with: credential)
                adopt(linked.user)
                issuedNonces.removeAll()
                return .signedIn(isReturning: false)
            }
            let signedIn = try await Auth.auth().signIn(with: credential)
            adopt(signedIn.user)
            issuedNonces.removeAll()
            return .signedIn(isReturning: !(signedIn.additionalUserInfo?.isNewUser ?? false))
        } catch let error as NSError where Self.isAlreadyLinked(error) {
            // Utente di ritorno: l'Apple ID è già legato a un altro account
            // Firebase. Si entra in QUELL'account (i suoi dati storici),
            // abbandonando quello anonimo appena creato.
            let updated = (error.userInfo[AuthErrorUserInfoUpdatedCredentialKey] as? AuthCredential) ?? credential
            do {
                let signedIn = try await Auth.auth().signIn(with: updated)
                adopt(signedIn.user)
                issuedNonces.removeAll()
                return .signedIn(isReturning: true)
            } catch {
                print("[Auth] sign-in con credenziale esistente fallito: \(error.localizedDescription)")
                return .failed("We found your account but couldn't open it. Please try again.")
            }
        } catch {
            // Il messaggio di Firebase è roba da debugger (ci finiscono
            // hash e nomi di claim): a schermo va una frase, non un log.
            print("[Auth] link Apple fallito: \(error.localizedDescription)")
            return .failed("We couldn't complete the sign-in. Please try again.")
        }
    }

    /// Firebase segnala "questa credenziale appartiene già a qualcuno"
    /// con due codici diversi a seconda di dove sbatte: entrambi
    /// significano "sei un utente di ritorno".
    private static func isAlreadyLinked(_ error: NSError) -> Bool {
        error.code == AuthErrorCode.credentialAlreadyInUse.rawValue
            || error.code == AuthErrorCode.providerAlreadyLinked.rawValue
            || error.code == AuthErrorCode.accountExistsWithDifferentCredential.rawValue
    }

    private static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        return String((0..<length).map { _ in charset.randomElement()! })
    }
}

/// Esito di un Sign in with Apple. Serve un terzo caso oltre a
/// riuscito/fallito: l'utente che annulla non va trattato come un
/// errore da segnalare.
enum AppleAuthOutcome {
    /// `isReturning` false = questo Apple ID non aveva nessun account
    /// Cherry, quindi è appena nato. Chi arriva dal "già ho un account"
    /// deve saperlo: saltargli l'onboarding lo lascerebbe senza profilo.
    case signedIn(isReturning: Bool)
    case cancelled
    case failed(String)
}

enum CherryError: LocalizedError {
    case demoMode
    case backendUnavailable(String)

    var errorDescription: String? {
        switch self {
        case .demoMode:
            "Demo mode: add GoogleService-Info.plist to enable real data."
        case .backendUnavailable(let message):
            message
        }
    }
}
