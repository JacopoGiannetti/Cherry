import SwiftUI
import SuperwallKit

@main
struct CherryApp: App {
    @StateObject private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        FirebaseBootstrap.configureIfAvailable()
        if !Secrets.superwallAPIKey.isEmpty {
            // PurchaseController = StoreKit decide chi è abbonato.
            // Senza, Superwall si tiene gli entitlement sandbox e
            // skippa onboarding_paywall (no_rule_match → fallback).
            Superwall.configure(
                apiKey: Secrets.superwallAPIKey,
                purchaseController: SuperwallActions.shared
            )
            Superwall.shared.delegate = SuperwallActions.shared
        }
        // Qui e non altrove: in SwiftUI questo è l'equivalente di
        // `didFinishLaunchingWithOptions`, cioè l'unico punto che viene
        // eseguito sempre, una volta sola, prima di qualunque scena.
        // `applicationDidBecomeActive` in un'app a Scene può non essere
        // mai chiamato, e lo SDK resterebbe spento senza dirlo.
        Analytics.start()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .preferredColorScheme(.light)
                .task {
                    // Rete di sicurezza: se per qualsiasi motivo l'SDK
                    // non fosse partito in init, riprova qui. È idempotente.
                    Analytics.start()
                    Task { await ReviewPrompt.loadRemoteSwitch() }
                    await appState.start()
                    SuperwallActions.shared.subscriptions = appState.subscriptions
                    SuperwallActions.shared.syncSubscriptionStatus(
                        isSubscribed: appState.subscriptions.isSubscribed
                    )
                    identifySuperwallUser()
                    observeRedeem()
                    Analytics.identify(appState.uid)
                    // Dopo `start()`, cioè a login pronto: prima il ping
                    // non avrebbe un uid a cui attaccarsi.
                    appState.trackAppOpen()
                }
                // Fix del difetto GutSense: il deep link è gestito QUI,
                // alla radice, montato dal primo frame e in ogni fase.
                .onOpenURL { url in
                    appState.handleDeepLink(url)
                }
                .onChange(of: scenePhase) { _, newPhase in
                    if newPhase == .active {
                        // AppsFlyer va (ri)avviato a ogni ritorno attivo.
                        Analytics.start()
                        appState.trackAppOpen()
                        appState.redeemSharedURLFromAppGroup()
                        Task { await appState.auth.persistShareExtensionToken() }
                    }
                }
                .tint(Theme.brand)
        }
    }

    private func identifySuperwallUser() {
        guard !Secrets.superwallAPIKey.isEmpty, let uid = appState.auth.uid else { return }
        Superwall.shared.identify(userId: uid)
    }

    /// Riletto l'entitlement, chi ha appena riscattato un codice esce dal
    /// paywall da solo: `observeSubscription` in AppState guarda
    /// `isSubscribed` e sceglie la fase giusta.
    private func observeRedeem() {
        SuperwallActions.shared.onRedeemFinished = { [weak appState] in
            Task { await appState?.subscriptions.refresh() }
        }
    }
}
