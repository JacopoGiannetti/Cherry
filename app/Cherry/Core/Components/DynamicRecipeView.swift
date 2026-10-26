import SwiftUI
import AVFoundation
import WebKit

// Vista dinamica: la ricetta divisa sugli spezzoni del video originale.
// Il video si guarda col player ufficiale della piattaforma (TikTok o
// Instagram), mai da una copia nostra: in alto il player, fermo; sotto
// le card con step e ingredienti, e a ogni card il player salta al suo
// spezzone e lo ripete.
struct DynamicRecipeView: View {
    let title: String
    let segments: [RecipeSegment]
    let ingredients: [Ingredient]
    let steps: [String]
    /// Il post d'origine: da qui si ricava il video da mostrare.
    let sourceUrl: String?

    @Environment(\.dismiss) private var dismiss
    @State private var video: EmbeddedVideo?
    @State private var failure: String?
    @State private var current: Int? = 0
    @State private var paused = false
    @State private var muted = true

    /// Gli spezzoni che si possono mostrare: dopo una modifica a mano gli
    /// indici possono puntare fuori dalla ricetta, e quelli si scartano.
    static func pages(_ segments: [RecipeSegment]?, steps: [String], ingredients: [Ingredient]) -> [RecipeSegment] {
        (segments ?? []).compactMap { segment in
            var s = segment
            s.steps = segment.steps.filter { steps.indices.contains($0) }
            s.ingredients = segment.ingredients.filter { ingredients.indices.contains($0) }
            return s.steps.isEmpty || s.end <= s.start ? nil : s
        }
    }

    private var pages: [RecipeSegment] {
        Self.pages(segments, steps: steps, ingredients: ingredients)
    }

    /// Solo i video dei social si possono dividere in spezzoni.
    static func supports(sourceUrl: String?) -> Bool {
        let host = sourceUrl.flatMap(URL.init)?.host?.lowercased() ?? ""
        return host.contains("tiktok") || host.contains("instagram") || host.contains("instagr.am")
    }

    private var index: Int { min(current ?? 0, max(pages.count - 1, 0)) }

    var body: some View {
        ZStack {
            CherryBackground(mood: .warm).ignoresSafeArea()
            if let video, !pages.isEmpty {
                pager(video)
            } else if let failure {
                failureView(failure)
            } else {
                ProgressView()
                    .tint(Theme.brand)
            }
        }
        .overlay(alignment: .top) { header }
        .overlay(alignment: .bottom) {
            if video != nil { nextButton }
        }
        .task { await load() }
    }

    // MARK: - Pagine

    private func pager(_ video: EmbeddedVideo) -> some View {
        VStack(spacing: 18) {
            EmbeddedPlayerView(
                video: video,
                segment: pages[index],
                paused: paused,
                muted: muted,
                onUnavailable: {
                    self.video = nil
                    failure = "The video didn’t load. It may have been removed, or the creator turned off embedding."
                }
            )
            .background(Theme.ink)
            .overlay(alignment: .bottomTrailing) {
                SegmentControls(paused: paused, muted: muted, onTogglePlay: togglePlay, onToggleMute: toggleMute)
            }
            .containerRelativeFrame(.vertical) { height, _ in height * 0.5 }
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
            .padding(.horizontal, 20)
            .padding(.top, 60)

            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(Array(pages.enumerated()), id: \.offset) { n, segment in
                        ScrollView(showsIndicators: false) {
                            SegmentDetails(
                                segment: segment,
                                number: n + 1,
                                total: pages.count,
                                ingredients: segment.ingredients.map { ingredients[$0] },
                                steps: segment.steps.map { ($0 + 1, steps[$0]) }
                            )
                            .padding(.horizontal, 20)
                        }
                        .scrollBounceBehavior(.basedOnSize)
                        .containerRelativeFrame(.vertical)
                        .id(n)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $current)
            .padding(.bottom, 76)
            .onChange(of: current) { _, _ in
                Haptics.selection()
                paused = false
            }
        }
    }

    private func togglePlay() {
        Haptics.light()
        paused.toggle()
    }

    private func toggleMute() {
        Haptics.light()
        muted.toggle()
        // Con l'audio acceso si suona anche col silenzioso attivo.
        if !muted { try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback) }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button {
                Haptics.light()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 38, height: 38)
                    .contentShape(.circle)
                    .glassEffect(.regular.interactive(), in: .circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")

            // Una tacca per spezzone, piena fino a quello aperto.
            HStack(spacing: 4) {
                ForEach(pages.indices, id: \.self) { n in
                    Capsule()
                        .fill(n <= index ? Theme.brand : Theme.ink.opacity(0.12))
                        .frame(height: 4)
                }
            }
            .animation(Theme.Motion.quick, value: index)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private var isLast: Bool { index >= pages.count - 1 }

    private var nextButton: some View {
        Button {
            Haptics.medium()
            if isLast {
                dismiss()
            } else {
                withAnimation(Theme.Motion.signature) { current = index + 1 }
            }
        } label: {
            HStack(spacing: 8) {
                Text(isLast ? "Done" : "Next step")
                    .font(Theme.body(15, weight: .bold))
                Image(systemName: isLast ? "checkmark" : "chevron.down")
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 22)
            .frame(height: 46)
            .contentShape(.capsule)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
        .buttonStyle(.plain)
        .padding(.bottom, 12)
        .contentTransition(.opacity)
        .animation(Theme.Motion.quick, value: isLast)
    }

    private func failureView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "play.slash")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Theme.subtle)
            Text(message)
                .font(Theme.body(16, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
            Button("Try again") {
                failure = nil
                Task { await load() }
            }
            .font(Theme.body(15, weight: .bold))
            .foregroundStyle(Theme.brand)
        }
        .padding(.horizontal, 32)
    }

    // MARK: - Video

    private func load() async {
        print("[dynamic] apertura: sourceUrl=\(sourceUrl ?? "nil") spezzoni=\(pages.count)")
        guard video == nil else { return }
        if let found = await EmbeddedVideo.find(in: sourceUrl) {
            print("[dynamic] video: \(found)")
            video = found
        } else {
            print("[dynamic] video NON trovato nel link \(sourceUrl ?? "nil")")
            failure = "We couldn’t find this video."
        }
    }
}

// MARK: - Il video da incorporare

enum EmbeddedVideo: Equatable, CustomStringConvertible {
    case tiktok(postId: String)
    case instagram(shortcode: String)

    var description: String {
        switch self {
        case .tiktok(let id): "TikTok \(id)"
        case .instagram(let code): "Instagram \(code)"
        }
    }

    static func find(in link: String?) async -> EmbeddedVideo? {
        guard let link else { return nil }
        let lower = link.lowercased()
        if lower.contains("instagram") || lower.contains("instagr.am") {
            return shortcode(in: link).map { .instagram(shortcode: $0) }
        }
        if lower.contains("tiktok") {
            return await tiktokPostId(from: link).map { .tiktok(postId: $0) }
        }
        return nil
    }

    private static func shortcode(in link: String) -> String? {
        guard let match = link.range(of: #"/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)"#, options: .regularExpression) else { return nil }
        return String(link[match]).split(separator: "/").last.map(String.init)
    }

    /// L'id del post nel link, anche nei link corti di condivisione
    /// (vm.tiktok.com/…), che rimandano a quello completo.
    private static func tiktokPostId(from link: String) async -> String? {
        if let id = postId(in: link) { return id }
        guard let url = URL(string: link) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.httpMethod = "HEAD"
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            print("[dynamic] TikTok: link corto \(link) → \(response.url?.absoluteString ?? "nil") (HTTP \(status))")
            // Da non loggati TikTok rimanda al login, col link del video
            // codificato in `redirect_url`: si cerca anche lì dentro.
            return response.url.flatMap { final in
                postId(in: final.absoluteString) ?? final.absoluteString.removingPercentEncoding.flatMap(postId(in:))
            }
        } catch {
            print("[dynamic] TikTok: risoluzione del link fallita: \(error.localizedDescription)")
            return nil
        }
    }

    private static func postId(in link: String) -> String? {
        for pattern in [#"/(?:video|photo|v)/(\d{8,})"#, #"[?&]item_id=(\d{8,})"#] {
            if let match = link.range(of: pattern, options: .regularExpression) {
                return String(link[match]).components(separatedBy: CharacterSet.decimalDigits.inverted).first { $0.count >= 8 }
            }
        }
        return nil
    }
}

// MARK: - Card

/// Play/pausa e audio, sopra il video.
private struct SegmentControls: View {
    let paused: Bool
    let muted: Bool
    let onTogglePlay: () -> Void
    let onToggleMute: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            controlButton(paused ? "play.fill" : "pause.fill", label: paused ? "Play" : "Pause", action: onTogglePlay)
            controlButton(muted ? "speaker.slash.fill" : "speaker.wave.2.fill", label: muted ? "Sound on" : "Sound off", action: onToggleMute)
        }
        .padding(12)
    }

    private func controlButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .contentShape(.circle)
                .contentTransition(.symbolEffect(.replace))
                .glassEffect(.regular.tint(.black.opacity(0.25)).interactive(), in: .circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// Titolo, step e ingredienti di uno spezzone.
private struct SegmentDetails: View {
    let segment: RecipeSegment
    let number: Int
    let total: Int
    let ingredients: [Ingredient]
    /// Numero dello step nella ricetta intera, e testo.
    let steps: [(Int, String)]

    // Gli step prima di tutto, subito sotto il titolo: sono quello che si
    // segue mentre si cucina. Gli ingredienti stanno su una riga sola.
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("STEP \(number) OF \(total)")
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(Theme.subtle)
                    .tracking(1.2)

                if !segment.title.isEmpty {
                    Text(segment.title)
                        .font(Theme.display(22))
                        .foregroundStyle(Theme.ink)
                }
            }

            stepsList

            if !ingredients.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(ingredients.enumerated()), id: \.offset) { _, ingredient in
                            HStack(spacing: 5) {
                                if let emoji = ingredient.emoji {
                                    Text(emoji)
                                        .font(.system(size: 14))
                                }
                                Text(ingredient.name)
                                    .font(Theme.body(13, weight: .semibold))
                                    .foregroundStyle(Theme.ink)
                                if !ingredient.quantity.isEmpty {
                                    Text(ingredient.quantity)
                                        .font(Theme.body(13))
                                        .foregroundStyle(Theme.subtle)
                                }
                            }
                            .lineLimit(1)
                            .padding(.horizontal, 12)
                            .frame(height: 32)
                            .glassChip()
                        }
                    }
                    .padding(.horizontal, 20)
                }
                .scrollClipDisabled()
                .padding(.horizontal, -20)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var stepsList: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(steps, id: \.0) { step in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(step.0)")
                        .font(Theme.body(13, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(Theme.brand))
                    Text(step.1)
                        .font(Theme.body(15))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

// MARK: - Player ufficiale

/// Il player ufficiale della piattaforma, in una web view: il video arriva
/// da loro, col nome di chi l'ha fatto. Le due pagine espongono la stessa
/// funzione `send(tipo, valore)` e mandano gli stessi messaggi
/// (onPlayerReady, onCurrentTime, onStateChange), così il loop sullo
/// spezzone è uno solo.
///
/// TikTok: Embed Player (developers.tiktok.com/doc/embed-player), comandi
/// via postMessage. Instagram: la pagina embed del post, dove si preme
/// play e si sceglie il punto sul suo video.
private struct EmbeddedPlayerView: UIViewRepresentable {
    let video: EmbeddedVideo
    let segment: RecipeSegment
    let paused: Bool
    let muted: Bool
    let onUnavailable: () -> Void

    /// Dominio da cui il player TikTok risulta incorporato.
    private static let origin = URL(string: "https://hellocherry.app")!

    func makeCoordinator() -> Coordinator { Coordinator(onUnavailable: onUnavailable) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(WeakScriptHandler(context.coordinator), name: "player")
        if case .instagram = video {
            config.userContentController.addUserScript(
                WKUserScript(source: Self.instagramBridge, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
            )
        }

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        // Con lo user agent di default di WKWebView i player possono dare una versione di ripiego.
        web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        context.coordinator.web = web
        context.coordinator.update(segment: segment, paused: paused, muted: muted)

        switch video {
        case .tiktok(let postId):
            web.loadHTMLString(Self.tiktokPage(postId: postId), baseURL: Self.origin)
        case .instagram(let shortcode):
            web.load(URLRequest(url: URL(string: "https://www.instagram.com/reel/\(shortcode)/embed/")!))
        }
        context.coordinator.startWatchdog()
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.update(segment: segment, paused: paused, muted: muted)
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        coordinator.stop()
        web.configuration.userContentController.removeScriptMessageHandler(forName: "player")
    }

    private static func tiktokPage(postId: String) -> String {
        let params = [
            "controls=0", "autoplay=1", "loop=0", "muted=0", "progress_bar=0", "play_button=0",
            "volume_control=0", "fullscreen_button=0", "timestamp=0", "rel=0", "music_info=0",
            "description=0", "native_context_menu=0", "closed_caption=0",
        ].joined(separator: "&")
        return """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
        <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
        </head><body>
        <iframe id="p" src="https://www.tiktok.com/player/v1/\(postId)?\(params)" allow="autoplay; encrypted-media; fullscreen"></iframe>
        <script>
        function send(type, value) {
          document.getElementById('p').contentWindow.postMessage({ type: type, value: value, 'x-tiktok-player': true }, '*');
        }
        window.addEventListener('message', function (e) {
          var d = e.data;
          if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return; } }
          if (!d || !d['x-tiktok-player']) return;
          window.webkit.messageHandlers.player.postMessage(JSON.stringify(d));
        });
        </script>
        </body></html>
        """
    }

    /// Sulla pagina embed di Instagram: trova il video del post e gli dà
    /// gli stessi comandi del player TikTok.
    private static let instagramBridge = """
    (function () {
      var video = null, pendingSeek = null;
      function post(type, value) {
        try { window.webkit.messageHandlers.player.postMessage(JSON.stringify({ type: type, value: value })); } catch (_) {}
      }
      function attach() {
        var el = document.querySelector('video');
        if (!el || el === video) return;
        video = el;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.addEventListener('loadedmetadata', function () {
          if (pendingSeek !== null) { video.currentTime = pendingSeek; pendingSeek = null; }
        });
        video.addEventListener('timeupdate', function () { post('onCurrentTime', { currentTime: video.currentTime, duration: video.duration || 0 }); });
        video.addEventListener('ended', function () { post('onStateChange', 0); });
        post('onPlayerReady');
      }
      window.send = function (type, value) {
        if (!video) return;
        if (type === 'seekTo') {
          if (video.readyState < 1) { pendingSeek = value; } else { video.currentTime = value; }
        } else if (type === 'play') {
          var p = video.play();
          if (p && p.catch) p.catch(function (e) { post('onError', String(e)); });
        } else if (type === 'pause') { video.pause(); }
        else if (type === 'mute') { video.muted = true; }
        else if (type === 'unMute') { video.muted = false; }
      };
      attach();
      new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
    })();
    """

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        weak var web: WKWebView?
        private let onUnavailable: () -> Void
        private var ready = false
        private var segment: RecipeSegment?
        private var paused = false
        private var muted = true
        private var watchdog: Task<Void, Never>?

        init(onUnavailable: @escaping () -> Void) {
            self.onUnavailable = onUnavailable
        }

        /// Se il player non dice "pronto" in tempo, non arriverà più.
        func startWatchdog() {
            watchdog = Task { [weak self] in
                try? await Task.sleep(for: .seconds(12))
                guard let self, !Task.isCancelled, !self.ready else { return }
                print("[dynamic] player: nessun 'pronto' in 12s, errore")
                self.onUnavailable()
            }
        }

        func stop() {
            watchdog?.cancel()
            send("pause")
        }

        func update(segment new: RecipeSegment, paused newPaused: Bool, muted newMuted: Bool) {
            let segmentChanged = segment.map { $0.start != new.start || $0.end != new.end } ?? true
            let pausedChanged = paused != newPaused
            let mutedChanged = muted != newMuted
            segment = new
            paused = newPaused
            muted = newMuted
            guard ready else { return }
            if mutedChanged { send(muted ? "mute" : "unMute") }
            if segmentChanged { restart() } else if pausedChanged { send(paused ? "pause" : "play") }
        }

        private func restart() {
            guard let segment else { return }
            send("seekTo", value: segment.start)
            send(paused ? "pause" : "play")
        }

        private func send(_ type: String, value: Double? = nil) {
            let arg = value.map { String($0) } ?? "undefined"
            print("[dynamic] player → \(type)\(value.map { " \($0)" } ?? "")")
            web?.evaluateJavaScript("window.send && send('\(type)', \(arg))") { _, error in
                if let error { print("[dynamic] player: comando \(type) fallito: \(error.localizedDescription)") }
            }
        }

        nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? String,
                  let data = body.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = json["type"] as? String else { return }
            let value = json["value"]
            Task { @MainActor in self.handle(type, value: value) }
        }

        private func handle(_ type: String, value: Any?) {
            if type != "onCurrentTime" { print("[dynamic] player ← \(type) \(value.map { "\($0)" } ?? "")") }
            switch type {
            case "onPlayerReady":
                guard !ready else { return }
                ready = true
                watchdog?.cancel()
                send(muted ? "mute" : "unMute")
                restart()
            case "onCurrentTime":
                guard !paused, let segment,
                      let info = value as? [String: Any],
                      let time = (info["currentTime"] as? NSNumber)?.doubleValue else { return }
                if time >= segment.end - 0.15 || time < segment.start - 1 { restart() }
            case "onStateChange":
                // 0 = finito: lo spezzone può chiudere oltre la fine vera.
                if (value as? NSNumber)?.intValue == 0, !paused { restart() }
            default:
                break
            }
        }

        // I link del player (autore, "guarda su…") si aprono fuori,
        // nell'app della piattaforma o in Safari, non al posto del player.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard action.navigationType == .linkActivated, let url = action.request.url else { return .allow }
            print("[dynamic] player: link aperto fuori dall'app: \(url.absoluteString)")
            await UIApplication.shared.open(url)
            return .cancel
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            print("[dynamic] player: pagina caricata")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[dynamic] player: caricamento fallito: \(error.localizedDescription)")
        }
    }
}

/// WKUserContentController tiene forte il suo handler: senza questo
/// passaggio il coordinator non verrebbe mai liberato.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
