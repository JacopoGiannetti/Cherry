import UIKit
import SwiftUI
import UniformTypeIdentifiers
import CryptoKit

// Share extension: TikTok / Instagram → Cherry.
// Il link va nell'App Group; l'app si apre via `cherry://import` risalendo
// la responder chain fino a UIApplication, con `extensionContext.open`
// come riserva (non è affidabile ovunque, ma su alcune iOS è l'unico
// che passa).
final class ShareViewController: UIViewController {
    private let appGroupID = "group.com.cherry.jacopogiannetti.app"
    private let sharedInboxKey = "sharedInbox"
    /// autostart=1 = l'utente ha scelto di aprire ora; senza, il link
    /// resta in attesa nell'inbox e non interrompe niente.
    private let importDeepLink = URL(string: "cherry://import?autostart=1")!
    private let inboxLimit = 20

    private var sharedURL: String?
    private var cardHost: UIHostingController<ShareCardView>?
    private let dimView = UIView()
    /// L'analisi parte già qui, mentre l'utente legge la card: se
    /// preme Keep scrolling il lavoro è già sul backend.
    private var importKickoff: Task<Void, Never>?

    override func viewDidLoad() {
        super.viewDidLoad()
        // Va insieme a NSExtensionActionWantsFullScreenPresentation
        // nell'Info.plist: la chiave toglie il foglio di sistema, questo
        // dice che sotto di noi resta visibile ciò che c'era prima.
        modalPresentationStyle = .overCurrentContext
        view.isOpaque = false
        view.backgroundColor = .clear
        setupBackdrop()
        presentCard(state: .loading)

        extractSharedURL { [weak self] url in
            DispatchQueue.main.async {
                self?.handle(url)
            }
        }
    }

    /// Su iOS 26 il contenitore di sistema sopra la nostra view ha uno
    /// sfondo opaco suo (Liquid Glass) che nessun .clear locale buca:
    /// si risale la gerarchia e si svuota tutto. Va fatto qui, quando
    /// la gerarchia è completa — in viewDidLoad i superview non ci
    /// sono ancora.
    override func viewIsAppearing(_ animated: Bool) {
        super.viewIsAppearing(animated)
        var current: UIView? = view
        while let layer = current {
            layer.backgroundColor = .clear
            layer.isOpaque = false
            current = layer.superview
        }
    }

    // MARK: - Flow

    private func handle(_ url: String?) {
        guard let url, !url.isEmpty else {
            presentCard(state: .noLink)
            return
        }
        sharedURL = url
        persistSharedURL(url)
        importKickoff = Task { await Self.kickoffImport(url) }
        // Nessuna apertura automatica: chi sta scorrendo TikTok decide
        // se interrompersi o continuare.
        presentCard(state: .caught(source: sourceName(for: url)))
    }

    private func persistSharedURL(_ url: String) {
        guard let defaults = UserDefaults(suiteName: appGroupID) else { return }
        var inbox = defaults.stringArray(forKey: sharedInboxKey) ?? []
        inbox.removeAll { $0 == url }
        inbox.append(url)
        if inbox.count > inboxLimit { inbox.removeFirst(inbox.count - inboxLimit) }
        defaults.set(inbox, forKey: sharedInboxKey)
        defaults.synchronize()
    }

    // MARK: - Card

    /// Velo scuro a tutto schermo: è anche l'unica prova visiva che
    /// l'extension è partita, se la card dovesse tardare.
    private func setupBackdrop() {
        dimView.backgroundColor = UIColor.black.withAlphaComponent(0.35)
        dimView.alpha = 0
        dimView.translatesAutoresizingMaskIntoConstraints = false
        dimView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(dismissTapped)))
        view.addSubview(dimView)

        NSLayoutConstraint.activate([
            dimView.topAnchor.constraint(equalTo: view.topAnchor),
            dimView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            dimView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            dimView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    @objc private func dismissTapped() {
        complete()
    }

    private func presentCard(state: ShareCardView.CardState) {
        let card = ShareCardView(
            state: state,
            onOpen: { [weak self] in self?.openCherryTapped() },
            onDismiss: { [weak self] in self?.complete() }
        )

        if let host = cardHost {
            host.rootView = card
            animateCardIn(host.view)
            return
        }

        let host = UIHostingController(rootView: card)
        host.view.backgroundColor = .clear
        // L'altezza della card la decide SwiftUI: senza, l'hosting view
        // non ha dimensione propria e con i soli vincoli laterali resta
        // alta zero (la extension si apre su una schermata vuota).
        host.sizingOptions = [.intrinsicContentSize]
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        view.addSubview(host.view)
        host.didMove(toParent: self)
        cardHost = host

        // Rete di sicurezza: se l'intrinsic size arrivasse a zero la card
        // resterebbe invisibile, quindi non scende mai sotto 220pt.
        let minHeight = host.view.heightAnchor.constraint(greaterThanOrEqualToConstant: 220)
        minHeight.priority = .defaultHigh

        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            host.view.topAnchor.constraint(greaterThanOrEqualTo: view.safeAreaLayoutGuide.topAnchor),
            minHeight,
        ])

        animateCardIn(host.view)
    }

    private func animateCardIn(_ cardView: UIView) {
        view.layoutIfNeeded()
        cardView.transform = CGAffineTransform(translationX: 0, y: 120)
        cardView.alpha = 0
        UIView.animate(
            withDuration: 0.45, delay: 0.02,
            usingSpringWithDamping: 0.88, initialSpringVelocity: 0.35
        ) {
            cardView.transform = .identity
            cardView.alpha = 1
            self.dimView.alpha = 1
        }
    }

    private func complete() {
        Task { [weak self] in
            guard let self else { return }
            // Il POST risponde 202 in un attimo: si aspetta un attimo
            // così Keep scrolling non uccide la richiesta a metà.
            if let importKickoff {
                _ = await Self.firstFinished(importKickoff, timeout: 1.4)
            }
            await MainActor.run {
                UIView.animate(withDuration: 0.22, animations: {
                    self.cardHost?.view.transform = CGAffineTransform(translationX: 0, y: 120)
                    self.cardHost?.view.alpha = 0
                    self.dimView.alpha = 0
                }, completion: { _ in
                    self.extensionContext?.completeRequest(returningItems: nil)
                })
            }
        }
    }

    private func openCherryTapped() {
        if openHostApp(importDeepLink) {
            finishAfterOpenAttempt()
            return
        }
        // Riserva: su alcune versioni di iOS la catena dei responder non
        // arriva a UIApplication, ma l'extension context sa aprire l'app.
        extensionContext?.open(importDeepLink) { [weak self] opened in
            DispatchQueue.main.async {
                if opened {
                    self?.finishAfterOpenAttempt()
                } else {
                    self?.showOpenFallback()
                }
            }
        }
    }

    private func showOpenFallback() {
        cardHost?.rootView = ShareCardView(
            state: .caught(source: sourceName(for: sharedURL ?? "")),
            onOpen: { [weak self] in self?.openCherryTapped() },
            onDismiss: { [weak self] in self?.complete() },
            footnote: "Tap Open Cherry again, or open the app manually — your link is saved."
        )
    }

    private func finishAfterOpenAttempt() {
        // Lascia tempo al sistema di avviare l'app prima di chiudere l'extension.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
            self?.complete()
        }
    }

    // MARK: - Apertura app (iOS 18+)

    /// Risale la responder chain fino a `UIApplication` e usa
    /// `open(_:options:completionHandler:)` — l'unico approccio che
    /// funziona ancora dalle share extension su iOS 18.
    @discardableResult
    private func openHostApp(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication {
                application.open(url, options: [:], completionHandler: nil)
                return true
            }
            responder = current.next
        }
        return false
    }

    // MARK: - Estrazione link

    private func extractSharedURL(completion: @escaping (String?) -> Void) {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            completion(nil)
            return
        }

        let urlType = UTType.url.identifier
        let textTypes = [UTType.plainText.identifier, UTType.text.identifier]

        for item in items {
            for provider in item.attachments ?? [] where provider.hasItemConformingToTypeIdentifier(urlType) {
                provider.loadItem(forTypeIdentifier: urlType, options: nil) { data, _ in
                    if let url = data as? URL {
                        completion(url.absoluteString)
                    } else if let text = data as? String {
                        completion(Self.firstURL(in: text))
                    } else {
                        completion(nil)
                    }
                }
                return
            }
        }

        for item in items {
            for provider in item.attachments ?? [] {
                for textType in textTypes where provider.hasItemConformingToTypeIdentifier(textType) {
                    provider.loadItem(forTypeIdentifier: textType, options: nil) { data, _ in
                        if let text = data as? String {
                            completion(Self.firstURL(in: text))
                        } else {
                            completion(nil)
                        }
                    }
                    return
                }
            }
        }

        completion(nil)
    }

    private static func firstURL(in text: String) -> String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        guard let match = detector?.firstMatch(in: text, options: [], range: range),
              let urlRange = Range(match.range, in: text)
        else { return nil }
        return String(text[urlRange])
    }

    private func sourceName(for url: String) -> String {
        let host = URL(string: url)?.host?.lowercased() ?? ""
        if host.contains("tiktok") { return "TikTok" }
        if host.contains("instagram") { return "Instagram" }
        if host.contains("youtu") { return "YouTube" }
        if host.contains("pinterest") { return "Pinterest" }
        if host.contains("facebook") { return "Facebook" }
        return host.isEmpty ? "this app" : host
    }

    // MARK: - Analisi in background dalla extension

    /// Stesso id dell'app e del backend: hash SHA256 dell'URL normalizzato.
    private static func makeSwapId(for url: String) -> String {
        let digest = SHA256.hash(data: Data(normalize(url).utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func normalize(_ url: String) -> String {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: trimmed) else { return trimmed.lowercased() }
        parts.query = nil
        parts.fragment = nil
        return (parts.string ?? trimmed).lowercased()
    }

    /// Anteprima + import completi. Senza token (app mai aperta) si
    /// rinuncia: il link resta in inbox e l'app lo elaborerà dopo.
    private static func kickoffImport(_ url: String) async {
        guard let token = UserDefaults(suiteName: "group.com.cherry.jacopogiannetti.app")?
            .string(forKey: "firebaseIdToken"),
              !token.isEmpty
        else { return }

        let swapId = makeSwapId(for: url)
        async let preview: Void = post("/swap/preview", token: token, body: ["url": url])
        async let importing: Void = post("/swap/import", token: token, body: [
            "swapId": swapId,
            "source": ["type": "link", "url": url],
        ])
        _ = await (preview, importing)
    }

    private static func post(_ path: String, token: String, body: [String: Any]) async {
        guard let url = URL(string: Secrets.backendURL + path) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(signature(for: path), forHTTPHeaderField: "x-signature")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: request)
    }

    private static func signature(for path: String) -> String {
        guard !Secrets.hmacSecret.isEmpty else { return "" }
        let key = SymmetricKey(data: Data(Secrets.hmacSecret.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: Data(path.utf8), using: key)
        return mac.map { String(format: "%02x", $0) }.joined()
    }

    private static func firstFinished(_ task: Task<Void, Never>, timeout: TimeInterval) async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await task.value }
            group.addTask {
                try? await Task.sleep(for: .seconds(timeout))
            }
            await group.next()
            group.cancelAll()
        }
    }
}

// MARK: - Card SwiftUI (target separato, senza Theme dell'app)

private struct ShareWordmark: View {
    var height: CGFloat = 30

    var body: some View {
        Text("Cherry")
            .font(.system(size: height * 0.92, weight: .black, design: .rounded))
            .foregroundStyle(Color(red: 0xE0 / 255, green: 0x26 / 255, blue: 0x3F / 255))
            .lineLimit(1)
            .fixedSize()
            .frame(height: height)
            .accessibilityLabel("Cherry")
    }
}

struct ShareCardView: View {
    enum CardState: Equatable {
        case loading
        case caught(source: String)
        case noLink
    }

    let state: CardState
    let onOpen: () -> Void
    let onDismiss: () -> Void
    var footnote: String?

    private let green = Color(red: 0.898, green: 0.337, blue: 0.431)
    private let mint = Color(red: 0.98, green: 0.84, blue: 0.86)
    private let cream = Color(red: 0.99, green: 0.97, blue: 0.957)
    private let ink = Color(red: 0.17, green: 0.12, blue: 0.133)

    @State private var appeared = false

    var body: some View {
        VStack(spacing: 14) {
            Capsule()
                .fill(ink.opacity(0.14))
                .frame(width: 36, height: 5)
                .padding(.top, 8)

            ShareWordmark(height: 30)

            sourceBadge

            VStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(ink)
                Text(subtitle)
                    .font(.system(size: 14, design: .rounded))
                    .foregroundStyle(ink.opacity(0.58))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 8)

            actionBlock
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity)
        .background(cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .strokeBorder(.white.opacity(0.65), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.18), radius: 28, y: -4)
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .fixedSize(horizontal: false, vertical: true)
        .onAppear { appeared = true }
    }

    @ViewBuilder
    private var sourceBadge: some View {
        switch state {
        case .loading:
            ProgressView()
                .tint(green)
                .frame(height: 44)
        case .caught(let source):
            HStack(spacing: 8) {
                Image(systemName: "link.circle.fill")
                    .font(.system(size: 15, weight: .semibold))
                Text("From \(source)")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
            }
            .foregroundStyle(green)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(green.opacity(0.1), in: .capsule)
            .scaleEffect(appeared ? 1 : 0.85)
            .animation(.spring(response: 0.4, dampingFraction: 0.7).delay(0.08), value: appeared)
        case .noLink:
            Image(systemName: "link.badge.plus")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(green.opacity(0.75))
                .frame(height: 44)
        }
    }

    @ViewBuilder
    private var actionBlock: some View {
        switch state {
        case .loading:
            Text("Reading shared link…")
                .font(.system(size: 13, design: .rounded))
                .foregroundStyle(ink.opacity(0.45))
                .padding(.top, 4)
        case .caught:
            VStack(spacing: 8) {
                Button(action: onOpen) {
                    Text("Open Cherry now")
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(green, in: .capsule)
                }
                if let footnote {
                    Text(footnote)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(ink.opacity(0.45))
                        .multilineTextAlignment(.center)
                }
                Button(action: onDismiss) {
                    Text("Keep scrolling")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(ink.opacity(0.5))
                        .frame(height: 38)
                }
            }
        case .noLink:
            Button(action: onDismiss) {
                Text("Close")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(green, in: .capsule)
            }
        }
    }

    private var cardBackground: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(.ultraThinMaterial)
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(cream.opacity(0.78))
        }
    }

    private var title: String {
        switch state {
        case .loading: return "One moment…"
        case .caught: return "Recipe caught!"
        case .noLink: return "No link found"
        }
    }

    private var subtitle: String {
        switch state {
        case .loading:
            return "We're grabbing the recipe link for you."
        case .caught:
            return "Adapt it now, or keep scrolling — we'll start reading the recipe either way."
        case .noLink:
            return "Try sharing the video again, or copy its link and paste it in Cherry."
        }
    }
}
