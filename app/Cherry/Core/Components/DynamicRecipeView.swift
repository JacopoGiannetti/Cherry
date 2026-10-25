import SwiftUI
import AVFoundation
import CryptoKit

// Vista dinamica: la ricetta divisa sugli spezzoni del video originale.
// Una card per spezzone, a pagina intera: il pezzo di video in loop,
// sotto gli ingredienti e gli step che ci si vedono.
struct DynamicRecipeView: View {
    let title: String
    let videoUrl: String
    let segments: [RecipeSegment]
    let ingredients: [Ingredient]
    let steps: [String]
    /// Rifà la vista dinamica da capo, quando il file salvato non è un
    /// video vero (solo audio).
    var onRebuild: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var localFile: URL?
    @State private var loadFailed = false
    @State private var noPicture = false
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
            if let localFile {
                pager(localFile)
            } else if loadFailed {
                failure
            } else {
                ProgressView()
                    .tint(Theme.brand)
            }
        }
        .overlay(alignment: .top) { header }
        .overlay(alignment: .bottom) {
            if localFile != nil { nextButton }
        }
        .task { await load() }
    }

    // MARK: - Pagine

    private func pager(_ file: URL) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: 0) {
                ForEach(Array(pages.enumerated()), id: \.offset) { n, segment in
                    SegmentCard(
                        file: file,
                        segment: segment,
                        number: n + 1,
                        total: pages.count,
                        ingredients: segment.ingredients.map { ingredients[$0] },
                        steps: segment.steps.map { ($0 + 1, steps[$0]) },
                        isActive: index == n,
                        paused: paused,
                        muted: muted,
                        onTogglePlay: {
                            Haptics.light()
                            paused.toggle()
                        },
                        onToggleMute: {
                            Haptics.light()
                            muted.toggle()
                        }
                    )
                    .containerRelativeFrame(.vertical)
                    .id(n)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $current)
        .onChange(of: current) { _, _ in
            Haptics.selection()
            paused = false
        }
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

    private var failure: some View {
        VStack(spacing: 12) {
            Image(systemName: "play.slash")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Theme.subtle)
            Text(noPicture ? "This video came through without its picture." : "We couldn’t load the video.")
                .font(Theme.body(16, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
            if noPicture, let onRebuild {
                Button("Rebuild the dynamic view") {
                    Haptics.medium()
                    dismiss()
                    onRebuild()
                }
                .font(Theme.body(15, weight: .bold))
                .foregroundStyle(Theme.brand)
            } else if !noPicture {
                Button("Try again") {
                    loadFailed = false
                    Task { await load() }
                }
                .font(Theme.body(15, weight: .bold))
                .foregroundStyle(Theme.brand)
            }
        }
        .padding(.horizontal, 32)
    }

    /// Un file senza traccia video (la sola traccia audio di un reel)
    /// si suonerebbe su un riquadro nero.
    private static func hasPicture(_ file: URL) async -> Bool {
        let tracks = try? await AVURLAsset(url: file).loadTracks(withMediaType: .video)
        return !(tracks ?? []).isEmpty
    }

    // MARK: - Video

    /// Il file si scarica una volta e resta in cache: ogni card lo legge
    /// da disco, così saltare a uno spezzone è istantaneo.
    private func load() async {
        guard localFile == nil, let remote = URL(string: videoUrl) else {
            if localFile == nil { loadFailed = true }
            return
        }
        let target = Self.cacheFile(for: videoUrl)
        do {
            if !FileManager.default.fileExists(atPath: target.path) {
                let (temp, response) = try await URLSession.shared.download(from: remote)
                guard (response as? HTTPURLResponse)?.statusCode ?? 200 < 400 else { throw URLError(.badServerResponse) }
                try? FileManager.default.removeItem(at: target)
                try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                try FileManager.default.moveItem(at: temp, to: target)
            }
            guard await Self.hasPicture(target) else {
                try? FileManager.default.removeItem(at: target)
                noPicture = true
                loadFailed = true
                return
            }
            localFile = target
        } catch {
            loadFailed = true
        }
    }

    private static func cacheFile(for url: String) -> URL {
        let hash = SHA256.hash(data: Data(url.utf8)).map { String(format: "%02x", $0) }.joined()
        return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("dynamic-videos", isDirectory: true)
            .appendingPathComponent("\(hash.prefix(32)).mp4")
    }
}

// MARK: - Card

private struct SegmentCard: View {
    let file: URL
    let segment: RecipeSegment
    let number: Int
    let total: Int
    let ingredients: [Ingredient]
    /// Numero dello step nella ricetta intera, e testo.
    let steps: [(Int, String)]
    let isActive: Bool
    let paused: Bool
    let muted: Bool
    let onTogglePlay: () -> Void
    let onToggleMute: () -> Void

    @StateObject private var player = SegmentPlayer()

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PlayerLayerView(player: player.player)
                .background(Theme.ink)
                .overlay(alignment: .bottomTrailing) { controls }
                .containerRelativeFrame(.vertical) { height, _ in height * 0.5 }
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))

            ScrollView(showsIndicators: false) {
                details
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .padding(.horizontal, 20)
        .padding(.top, 60)
        .padding(.bottom, 76)
        .onAppear {
            player.load(file, segment: segment)
            sync(restart: false)
        }
        .onDisappear { player.pause() }
        .onChange(of: isActive) { _, _ in sync(restart: true) }
        .onChange(of: paused) { _, _ in sync(restart: false) }
        .onChange(of: muted) { _, _ in sync(restart: false) }
    }

    private func sync(restart: Bool) {
        player.setMuted(muted)
        if isActive && !paused {
            player.play(fromStart: restart)
        } else {
            player.pause()
            if restart { player.seekToStart() }
        }
    }

    private var controls: some View {
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

    private var details: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("STEP \(number) OF \(total)")
                .font(Theme.body(11, weight: .bold))
                .foregroundStyle(Theme.subtle)
                .tracking(1.2)

            if !segment.title.isEmpty {
                Text(segment.title)
                    .font(Theme.display(24))
                    .foregroundStyle(Theme.ink)
            }

            if !ingredients.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(Array(ingredients.enumerated()), id: \.offset) { _, ingredient in
                        HStack(spacing: 6) {
                            Text(ingredient.name)
                                .font(Theme.body(13, weight: .semibold))
                                .foregroundStyle(Theme.ink)
                            if !ingredient.quantity.isEmpty {
                                Text(ingredient.quantity)
                                    .font(Theme.body(13))
                                    .foregroundStyle(Theme.subtle)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .glassChip()
                    }
                }
            }

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
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Le chip vanno a capo da sole.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(in: proposal.width ?? 0, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(in: bounds.width, subviews: subviews)
        for (subview, origin) in zip(subviews, result.origins) {
            subview.place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(in width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowHeight), origins)
    }
}

// MARK: - Player

/// Un player per card, sullo stesso file locale: riproduce solo il suo
/// pezzo e ricomincia da capo quando arriva in fondo.
@MainActor
private final class SegmentPlayer: ObservableObject {
    let player = AVPlayer()
    private var start: Double = 0
    private var end: Double = 0
    private var wantsPlay = false
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var statusObserver: NSKeyValueObservation?

    func load(_ file: URL, segment: RecipeSegment) {
        guard player.currentItem == nil else { return }
        start = segment.start
        end = segment.end
        let item = AVPlayerItem(url: file)
        player.replaceCurrentItem(with: item)
        player.actionAtItemEnd = .pause
        player.isMuted = true

        // Un seek prima che l'item sia pronto può andare perso: la card
        // partirebbe dall'inizio del video invece che dal suo spezzone.
        statusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            guard item.status == .readyToPlay else { return }
            Task { @MainActor in
                guard let self else { return }
                self.statusObserver = nil
                if self.wantsPlay { self.loop() } else { self.seekToStart() }
            }
        }

        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self, self.wantsPlay, time.seconds >= self.end - 0.05 else { return }
                self.loop()
            }
        }
        // Lo spezzone può finire oltre la durata vera del video.
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.wantsPlay else { return }
                self.loop()
            }
        }
    }

    func play(fromStart: Bool) {
        wantsPlay = true
        if fromStart {
            player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                Task { @MainActor in
                    guard let self, self.wantsPlay else { return }
                    self.player.play()
                }
            }
        } else {
            player.play()
        }
    }

    func pause() {
        wantsPlay = false
        player.pause()
    }

    func seekToStart() {
        player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func setMuted(_ muted: Bool) {
        // Con l'audio acceso si suona anche col silenzioso attivo: è un
        // video che si è scelto di sentire.
        if !muted { try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback) }
        player.isMuted = muted
    }

    private func loop() {
        player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.wantsPlay else { return }
                self.player.play()
            }
        }
    }

    deinit {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    }
}

private struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer

    func makeUIView(context: Context) -> PlayerUIView {
        let view = PlayerUIView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ view: PlayerUIView, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
    }

    final class PlayerUIView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}
