import SwiftUI
import CryptoKit

// Le foto dei piani curati sono la PRIMA cosa che si vede: girano nei
// telefonini finti dell'onboarding e nel deck della prova guidata, a
// pochi secondi dall'installazione. Scaricarle da fal significa un
// riquadro grigio per un secondo — o per sempre, con la rete del
// treno. Quelle dodici viaggiano quindi dentro il bundle, e l'URL
// remoto resta solo come identità della foto nei documenti Firestore.
enum BundledImages {
    private static let assetByURL: [String: String] = [
        "https://v3b.fal.media/files/b/0aa65cb1/qJIbs9y0dxiurkP-j-w53.jpg": "preset_rigatoni",
        "https://v3b.fal.media/files/b/0aa65cb1/AxABWpqKeZPtoCdARzOir.jpg": "preset_risotto",
        "https://v3b.fal.media/files/b/0aa65cc4/pgkwhaghcE_OtocHfOCvu.jpg": "preset_ribollita",
        "https://v3b.fal.media/files/b/0aa65cb1/UlYgEogCLxfXrlJhfL2p_.jpg": "preset_gyros",
        "https://v3b.fal.media/files/b/0aa65cc4/pbK1Ugedo3NFtuOUqAdAc.jpg": "preset_briam",
        "https://v3b.fal.media/files/b/0aa65cc6/C1om6QhF5-vEvCHqeDoSL.jpg": "preset_orzo",
        "https://v3b.fal.media/files/b/0aa65cc4/e42wZnxaK4NKTJC9xpVuN.jpg": "preset_fried_rice",
        "https://v3b.fal.media/files/b/0aa65cb1/CLxlnYR73wcFK6ox_OtbN.jpg": "preset_ramen",
        "https://v3b.fal.media/files/b/0aa65cb1/KPyzLO1kSSJPq1dMnS-b9.jpg": "preset_eggplant",
        "https://v3b.fal.media/files/b/0aa65cb1/7lY_QNHfXaRtepH7-xaGc.jpg": "preset_lasagna",
        "https://v3b.fal.media/files/b/0aa65cb1/b7BBOBQ6xYreSnmjwXH6G.jpg": "preset_butternut_mac",
        "https://v3b.fal.media/files/b/0aa65cb1/icaXGX33RJv5X2BoHAtrm.jpg": "preset_jackfruit",
    ]

    /// L'immagine locale corrispondente a una URL remota, se c'è.
    /// `UIImage(named:)` tiene la sua cache: chiamarla a ogni disegno
    /// costa un lookup, non una lettura da disco.
    static func image(for url: URL?) -> UIImage? {
        guard let url, let asset = assetByURL[url.absoluteString] else { return nil }
        return UIImage(named: asset)
    }
}

// Cache immagini a due livelli (memoria + disco): le foto delle ricette
// vivono NELL'APP; fal/Firebase restano solo l'origine remota. Senza
// questa cache AsyncImage riscarica tutto a ogni cambio di pagina.
enum ImageCache {
    private static let memory: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 150
        return cache
    }()

    private static let directory: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("vego-images", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private static func fileURL(for url: URL) -> URL {
        fileURL(forKey: url.absoluteString)
    }

    private static func fileURL(forKey key: String) -> URL {
        let hash = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(hash).appendingPathExtension("img")
    }

    /// Bundle → memoria → disco → rete (con salvataggio su disco).
    static func load(_ url: URL?) async -> UIImage? {
        guard let url else { return nil }
        if let bundled = BundledImages.image(for: url) { return bundled }
        let key = url.absoluteString as NSString

        if let cached = memory.object(forKey: key) { return cached }

        let file = fileURL(for: url)
        if let data = try? Data(contentsOf: file), let image = UIImage(data: data) {
            memory.setObject(image, forKey: key)
            return image
        }

        guard let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
              let image = UIImage(data: data)
        else { return nil }

        try? data.write(to: file, options: .atomic)
        memory.setObject(image, forKey: key)
        return image
    }

    /// Mette in cache una foto che abbiamo già in mano (appena scattata
    /// e caricata): senza, la ricetta appena salvata mostrerebbe il
    /// placeholder finché la stessa immagine non ritorna dalla rete.
    static func store(_ image: UIImage, for url: URL) {
        store(image, forKey: url.absoluteString)
    }

    /// Stessa cache, chiave libera: path Storage o `local://…`.
    static func store(_ image: UIImage, forKey key: String) {
        memory.setObject(image, forKey: key as NSString)
        guard let data = image.jpegData(compressionQuality: 0.85) else { return }
        try? data.write(to: fileURL(forKey: key), options: .atomic)
    }

    /// HTTP, path Firebase Storage, o foto locale appena scritta.
    static func loadAny(_ ref: String?) async -> UIImage? {
        guard let ref, !ref.isEmpty else { return nil }
        if ref.hasPrefix("http"), let url = URL(string: ref) {
            return await load(url)
        }

        let key = ref as NSString
        if let cached = memory.object(forKey: key) { return cached }

        let file = fileURL(forKey: ref)
        if let data = try? Data(contentsOf: file), let image = UIImage(data: data) {
            memory.setObject(image, forKey: key)
            return image
        }

        if ref.hasPrefix("local://") { return nil }
        if let image = await StorageUploader.download(ref) {
            memory.setObject(image, forKey: key)
            if let data = image.jpegData(compressionQuality: 0.85) {
                try? data.write(to: file, options: .atomic)
            }
            return image
        }
        return nil
    }

    /// Controllo sincrono: l'immagine è già nel bundle, in memoria o su disco?
    static func isCached(_ url: URL?) -> Bool {
        guard let url else { return true }
        if BundledImages.image(for: url) != nil { return true }
        let key = url.absoluteString as NSString
        if memory.object(forKey: key) != nil { return true }
        return FileManager.default.fileExists(atPath: fileURL(for: url).path)
    }

    /// Scarica in parallelo tutte le URL mancanti (idempotente se già in cache).
    static func preload(_ urls: [URL]) async {
        let pending = urls.filter { !isCached($0) }
        guard !pending.isEmpty else { return }
        await withTaskGroup(of: Void.self) { group in
            for url in pending {
                group.addTask { _ = await load(url) }
            }
        }
    }
}

/// Rimpiazzo di AsyncImage con cache persistente. Stessa forma d'uso:
/// contenuto per l'immagine pronta, placeholder mentre carica.
struct CachedImage<Content: View, Placeholder: View>: View {
    let url: URL?
    @ViewBuilder var content: (Image) -> Content
    @ViewBuilder var placeholder: () -> Placeholder

    @State private var loaded: UIImage?

    var body: some View {
        ZStack {
            // Il bundle si legge qui e non nel `.task`: quello gira dopo
            // il primo disegno, e basterebbe a far lampeggiare il
            // placeholder grigio sulla schermata d'apertura.
            if let image = loaded ?? BundledImages.image(for: url) {
                content(Image(uiImage: image))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            guard BundledImages.image(for: url) == nil else { return }
            loaded = await ImageCache.load(url)
        }
    }
}
