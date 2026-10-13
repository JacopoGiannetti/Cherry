import SwiftUI

// Il wizard della New Grocery Run (§4.1): quattro beat full-screen,
// chiudibile in ogni momento con il draft auto-salvato (tutto vive
// su Firestore: non si perde mai una sessione a metà).
struct RunWizardView: View {
    enum Step {
        case craving
        case adventure
        case kitchen
        case budget
        case deck
        case list
    }

    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store: RunStore
    @State private var step: Step
    @State private var cravings: [String] = []
    @State private var adventure: Int = 2
    @State private var occasion: String = ShopOccasion.everyday.rawValue
    @State private var appliances: [String] = []

    /// Wizard nuovo. `mergeInto`: al termine dello swipe la run viene
    /// fusa nella run indicata invece di produrre una lista a sé.
    init(appState: AppState, mergeInto: String? = nil) {
        let store = RunStore(scope: appState.scope, jobs: appState.jobs)
        store.mergeTargetRunId = mergeInto
        store.actorName = appState.attributionName
        store.spaceName = appState.activeSpaceName
        _store = StateObject(wrappedValue: store)
        _step = State(initialValue: .craving)
    }

    /// Riapertura di una run esistente (draft in swipe o in shopping).
    init(appState: AppState, existingRunId: String, startAt: Step) {
        let store = RunStore(scope: appState.scope, jobs: appState.jobs, runId: existingRunId)
        store.actorName = appState.attributionName
        store.spaceName = appState.activeSpaceName
        _store = StateObject(wrappedValue: store)
        _step = State(initialValue: startAt)
    }

    var body: some View {
        ZStack {
            CherryBackground(mood: step == .deck ? .warm : .fresh)

            VStack(spacing: 0) {
                header

                switch step {
                case .craving:
                    CravingView(profile: appState.tasteProfile) { picked in
                        cravings = picked
                        withAnimation { step = .adventure }
                    }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                case .adventure:
                    AdventureView { level, vibe in
                        adventure = level
                        occasion = vibe
                        withAnimation { step = .kitchen }
                    }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                case .kitchen:
                    KitchenSetupView(profile: appState.tasteProfile) { picked, sharing in
                        appliances = picked
                        // Restano nel profilo: dalla prossima spesa
                        // arrivano già spuntati.
                        var profile = appState.tasteProfile
                        var changed = false
                        if profile.appliances != picked {
                            profile.appliances = picked
                            changed = true
                        }
                        if profile.ingredientSharing != sharing {
                            profile.ingredientSharing = sharing
                            changed = true
                        }
                        if changed { appState.saveProfile(profile) }
                        withAnimation { step = .budget }
                    }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                case .budget:
                    BudgetView { budget, servings in
                        withAnimation { step = .deck }
                        Task {
                            await store.start(
                                cravings: cravings,
                                budgetUsd: budget,
                                servings: servings,
                                adventure: adventure,
                                occasion: occasion,
                                appliances: appliances
                            )
                        }
                    }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                case .deck:
                    DeckView(store: store) {
                        // Con una fusione in corso la lista vive nella run
                        // target: si torna alla home che la mostra.
                        if store.mergeTargetRunId != nil {
                            dismiss()
                        } else {
                            withAnimation { step = .list }
                        }
                    }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                case .list:
                    GroceryListView(store: store) {
                        dismiss()
                    }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
        }
        .onAppear {
            if step != .craving { store.listen() }
        }
        .animation(Theme.Motion.signature, value: step)
    }

    private var header: some View {
        Group {
            if showsFlowHeader {
                FeatureFlowHeader {
                    FeatureFlowDismissButton {
                        if step == .list { store.discardIfEmpty() }
                        dismiss()
                    }
                } trailing: {
                    EmptyView()
                }
            } else {
                CherryWordmark(height: CherryWordmarkSize.header)
                    .padding(.top, 8)
                    .padding(.bottom, 6)
            }
        }
    }

    /// Durante la generazione del menu non mostriamo la X: il job gira
    /// già sul backend.
    private var showsFlowHeader: Bool {
        step != .deck || !store.recipes.isEmpty || store.startError != nil
    }
}
