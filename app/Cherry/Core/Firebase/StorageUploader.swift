import Foundation
import UIKit
import FirebaseStorage

// Le foto salgono su Firebase Storage direttamente dall'app;
// al backend passa solo il path.
enum StorageUploader {
    static func uploadJPEG(_ image: UIImage, uid: String, prefix: String) async throws -> String {
        guard FirebaseBootstrap.isConfigured else { throw CherryError.demoMode }
        guard let data = compressed(image) else {
            throw CherryError.backendUnavailable("Could not read that photo.")
        }
        let path = "users/\(uid)/uploads/\(prefix)-\(UUID().uuidString).jpg"
        let ref = Storage.storage().reference(withPath: path)
        let metadata = StorageMetadata()
        metadata.contentType = "image/jpeg"
        _ = try await ref.putDataAsync(data, metadata: metadata)
        return path
    }

    /// Come `uploadJPEG`, ma restituisce l'URL scaricabile invece del
    /// path: le foto delle ricette finiscono in `imageUrl`, che l'app
    /// legge con `CachedImage` come qualsiasi altra foto.
    static func uploadJPEGReturningURL(_ image: UIImage, uid: String, prefix: String) async throws -> String {
        let path = try await uploadJPEG(image, uid: uid, prefix: prefix)
        let url = try await downloadURL(for: path)
        return url.absoluteString
    }

    static func downloadURL(for path: String) async throws -> URL {
        try await Storage.storage().reference(withPath: path).downloadURL()
    }

    /// Scarica una foto già caricata (menu in cronologia, anteprima risultato).
    /// `getData` parla con Storage da autenticato: l'URL pubblico
    /// firmato, passato da ImageCache, sui menu vecchi spesso non
    /// arrivava e la galleria restava vuota.
    static func download(_ path: String) async -> UIImage? {
        guard FirebaseBootstrap.isConfigured, !path.isEmpty else { return nil }
        do {
            let data = try await Storage.storage()
                .reference(withPath: path)
                .data(maxSize: 15 * 1024 * 1024)
            return UIImage(data: data)
        } catch {
            print("[Storage] download \(path): \(error.localizedDescription)")
            return nil
        }
    }

    static func delete(_ path: String) async {
        guard FirebaseBootstrap.isConfigured, !path.isEmpty else { return }
        try? await Storage.storage().reference(withPath: path).delete()
    }

    /// Ridimensiona e comprime per stare sotto i limiti (max ~2 MB).
    /// Prima si ridisegna in un bitmap: le foto dalla libreria (HEIC,
    /// CIImage) spesso hanno `jpegData` a nil e sparivano al salvataggio.
    private static func compressed(_ image: UIImage) -> Data? {
        let flattened = flatten(image)
        let maxDimension: CGFloat = 2048
        var target = flattened
        let largest = max(flattened.size.width, flattened.size.height)
        if largest > maxDimension {
            let scale = maxDimension / largest
            let newSize = CGSize(width: flattened.size.width * scale, height: flattened.size.height * scale)
            let renderer = UIGraphicsImageRenderer(size: newSize)
            target = renderer.image { _ in flattened.draw(in: CGRect(origin: .zero, size: newSize)) }
        }
        for quality in [0.8, 0.6, 0.4] {
            if let data = target.jpegData(compressionQuality: quality), data.count < 2_000_000 {
                return data
            }
        }
        return target.jpegData(compressionQuality: 0.3)
    }

    private static func flatten(_ image: UIImage) -> UIImage {
        let size = image.size
        guard size.width > 1, size.height > 1 else { return image }
        let format = UIGraphicsImageRendererFormat.default()
        format.opaque = true
        format.scale = image.scale
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { _ in
            UIColor.white.setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
