import Foundation
import FirebaseCore
import FirebaseFirestore

// L'app deve COMPILARE E GIRARE anche senza GoogleService-Info.plist
// (modalità demo): FirebaseApp.configure() crasherebbe, quindi si
// configura solo se il plist esiste nel bundle.
enum FirebaseBootstrap {
    private(set) static var isConfigured = false

    static func configureIfAvailable() {
        guard !isConfigured else { return }
        guard Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil else {
            print("[Cherry] GoogleService-Info.plist assente: modalità demo, nessun dato persistito")
            return
        }
        FirebaseApp.configure()

        // Cache su disco senza tetto: liste e ricette restano leggibili
        // e modificabili anche senza rete (al supermercato capita).
        let settings = Firestore.firestore().settings
        settings.cacheSettings = PersistentCacheSettings(
            sizeBytes: NSNumber(value: FirestoreCacheSizeUnlimited)
        )
        Firestore.firestore().settings = settings

        isConfigured = true
    }
}
