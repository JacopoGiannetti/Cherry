import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        ZStack {
            CherryBackground(mood: backgroundMood)

            switch appState.phase {
            case .launching:
                BreathingWordmark()
                    .transition(.opacity)
            case .onboarding:
                OnboardingFlow()
                    .transition(Theme.Motion.entrance)
            case .paywall:
                PaywallGateView()
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            case .signIn:
                SignInView()
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            case .main:
                MainTabView()
                    .transition(Theme.Motion.entrance)
            }
        }
        .animation(Theme.Motion.slow, value: phaseKey)
    }

    private var phaseKey: Int {
        switch appState.phase {
        case .launching: 0
        case .onboarding: 1
        case .paywall: 2
        case .signIn: 3
        case .main: 4
        }
    }

    /// Ogni fase ha la sua atmosfera pastello.
    private var backgroundMood: CherryBackground.Mood {
        switch appState.phase {
        case .launching, .onboarding: .fresh
        case .paywall, .signIn: .warm
        case .main: .fresh
        }
    }
}

/// L'avvio dura una frazione di secondo, ma è il primo fotogramma che
/// l'utente vede: un marchio immobile sembra un'app bloccata, uno che
/// respira sembra un'app viva. Il respiro è volutamente lento, deve
/// restare sotto la soglia dell'attenzione.
private struct BreathingWordmark: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var inhaled = false

    var body: some View {
        CherryWordmark(height: 56)
            .scaleEffect(inhaled ? 1.04 : 0.97)
            .opacity(inhaled ? 1 : 0.9)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(Theme.Motion.ambient) { inhaled = true }
            }
    }
}
