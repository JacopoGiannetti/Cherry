import Foundation
import CryptoKit

// L'UNICA comunicazione app -> backend: "avvia questo lavoro".
// Il backend risponde subito 202 { jobId } e scrive i risultati su
// Firestore; qui non si aspettano mai dati.
struct JobClient {
    let auth: AuthService

    struct JobStarted: Decodable {
        let jobId: String
    }

    enum JobClientError: LocalizedError {
        case rateLimited
        case backendDown
        case badRequest(String)

        var errorDescription: String? {
            switch self {
            case .rateLimited: "You've hit today's limit. Come back tomorrow!"
            case .backendDown: "Couldn't reach the kitchen. Check your connection and try again."
            case .badRequest(let message): message
            }
        }
    }

    /// POST fire-and-forget. Ritorna il jobId; il risultato arriverà su Firestore.
    @discardableResult
    func start(_ path: String, body: [String: Any]) async throws -> String {
        let data = try await post(path, body: body, accepting: [202])
        return try JSONDecoder().decode(JobStarted.self, from: data).jobId
    }

    /// POST con risposta immediata, per le operazioni che non sono
    /// lavori dell'AI (spazi condivisi, token delle Live Activity).
    @discardableResult
    func call(_ path: String, body: [String: Any]) async throws -> [String: Any] {
        let data = try await post(path, body: body, accepting: [200, 201, 202])
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    /// Analytics sul profilo Firestore: fire-and-forget, errori ignorati.
    func ping(_ event: String) {
        Task { try? await call("/usage/event", body: ["event": event]) }
    }

    private func post(_ path: String, body: [String: Any], accepting: Set<Int>) async throws -> Data {
        guard let url = URL(string: Secrets.backendURL + path) else {
            throw JobClientError.badRequest("Bad backend URL")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15 // solo l'avvio: la risposta è immediata
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(signature(for: path), forHTTPHeaderField: "x-signature")
        let token = try await auth.idToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw JobClientError.backendDown
        }

        guard let http = response as? HTTPURLResponse else { throw JobClientError.backendDown }
        if accepting.contains(http.statusCode) { return data }
        if http.statusCode == 429 { throw JobClientError.rateLimited }
        let details = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["details"] as? String
        throw JobClientError.badRequest(details ?? "Something went wrong (\(http.statusCode))")
    }

    private func signature(for path: String) -> String {
        guard !Secrets.hmacSecret.isEmpty else { return "" }
        let key = SymmetricKey(data: Data(Secrets.hmacSecret.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: Data(path.utf8), using: key)
        return mac.map { String(format: "%02x", $0) }.joined()
    }
}
