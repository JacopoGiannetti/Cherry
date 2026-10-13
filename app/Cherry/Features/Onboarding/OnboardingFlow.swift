import SwiftUI

/// Gli step del funnel di onboarding, nell'ordine in cui si vedono.
/// Uno step è una schermata che chiede un gesto: il drop-off si legge
/// solo se il confine fra due step è qualcosa che l'utente ha scelto
/// di fare.
///
/// Le coppie problema → soluzione si contano per posizione (`pair1`,
/// `pair2`…), non per argomento: l'ordine cambia da utente a utente
/// in base ai blockers, e un funnel va letto su gradini fissi.
///
/// L'elenco gemello è in `backend/lib/onboarding-funnel.js`, insieme
/// alle didascalie della dashboard: i rawValue devono combaciare, o là
/// lo step resta fermo a zero. L'ultimo (`onboarding.complete`) lo
/// manda `AppState.completeOnboarding()` col suo nome storico.
enum OnboardingStep: String {
    /// Il prefisso dei ping: `onboarding.step.v2.<rawValue>`. Cambia
    /// quando cambia il percorso, così le metriche ripartono da zero.
    static let version = "v2"

    case welcome
    case promise
    case founder
    case trust
    case hello
    case referral
    case quizIngredients = "quiz.ingredients"
    case quizCantEat = "quiz.cant_eat"
    case quizSpice = "quiz.spice"
    case quizCuisines = "quiz.cuisines"
    case quizKitchen = "quiz.kitchen"
    case quizTried = "quiz.tried"
    case quizHousehold = "quiz.household"
    case quizNights = "quiz.nights"
    case quizNightsOk = "quiz.nights_ok"
    case quizTime = "quiz.time"
    case quizWhy = "quiz.why"
    case quizApps = "quiz.apps"
    case quizDone = "quiz.done"
    case profileReady = "profile.ready"
    case blockers
    case pair1Problem = "pair1.problem"
    case pair1Solution = "pair1.solution"
    case pair2Problem = "pair2.problem"
    case pair2Solution = "pair2.solution"
    case pair3Problem = "pair3.problem"
    case pair3Solution = "pair3.solution"
    case pair4Problem = "pair4.problem"
    case pair4Solution = "pair4.solution"
    case audience
    case reviews
    case diet
}

// SHOT-HARNESS-START
enum Shot {
    static let id: String? = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-vegoShot"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }()

    static var active: Bool { id != nil }
    static var welcomeLanded: Bool { id == "promise" }

    static var beat: OnboardingFlow.Beat? {
        switch id {
        case "welcome", "promise": return .welcome
        case "founder": return .founder
        case "trust": return .trust
        case "hello": return .hello
        case "referral": return .referral
        case "quiz.ingredients", "quiz.cant_eat", "quiz.spice", "quiz.cuisines", "quiz.kitchen",
             "quiz.tried", "quiz.household", "quiz.nights", "quiz.nights_ok", "quiz.time",
             "quiz.why", "quiz.apps", "quiz.done": return .quiz
        case "profile.ready": return .allSet
        case "blockers": return .blockers
        case "audience": return .audience
        case "reviews": return .reviews
        case "diet": return .diet
        case let some? where some.hasPrefix("pair"): return .pairs
        default: return nil
        }
    }

    /// `pair2.solution` → pagina 3 del pager delle coppie.
    static var pairPage: Int? {
        guard let id, id.hasPrefix("pair"), let dot = id.firstIndex(of: ".") else { return nil }
        guard let n = Int(id[id.index(id.startIndex, offsetBy: 4)..<dot]) else { return nil }
        let offset = id.hasSuffix("solution") ? 1 : 0
        return (n - 1) * 2 + offset
    }

    /// rawValue di `TasteQuizView.Stage`.
    static var quizStage: Int? {
        switch id {
        case "quiz.ingredients": return 0
        case "quiz.cant_eat": return 1
        case "quiz.spice": return 2
        case "quiz.cuisines": return 3
        case "quiz.kitchen": return 4
        case "quiz.tried": return 5
        case "quiz.household": return 6
        case "quiz.nights": return 7
        case "quiz.nights_ok": return 8
        case "quiz.time": return 9
        case "quiz.why": return 10
        case "quiz.apps", "quiz.done": return 11
        default: return nil
        }
    }

}
// SHOT-HARNESS-END

// Onboarding (§3): prima la storia del founder e le domande veloci,
// poi il profilo; a quel punto, con i blockers in mano, i quattro
// problemi e le quattro risposte. Chiude sulla dieta, e da lì su
// paywall e login.
struct OnboardingFlow: View {
    enum Beat {
        case welcome
        case founder
        case trust
        case hello
        case referral
        case quiz
        case loading
        case allSet
        case blockers
        case pairs
        case audience
        case reviews
        case diet
    }

    @EnvironmentObject private var appState: AppState
    @State private var beat: Beat = Shot.beat ?? .welcome // SHOT

    /// Quello che l'utente dichiara di avere contro: decide cosa dice
    /// il grafico e in che ordine arrivano i problemi.
    @State private var blockers: [OnboardingBlocker] = []

    var body: some View {
        ZStack {
            CherryBackground(mood: .fresh)

            VStack(spacing: 0) {
                // Il marchio accompagna tutto il percorso; il welcome
                // ha il suo (grande), quindi lì non si duplica. Sulle
                // coppie e su "chi è Cherry" le illustrazioni prendono
                // la pagina.
                if beat != .welcome && beat != .pairs && beat != .audience {
                    CherryWordmark(height: CherryWordmarkSize.header)
                        .padding(.top, 6)
                        .transition(.opacity)
                }

                Group {
                    switch beat {
                    case .welcome:
                        WelcomeView(onStart: { advance(.founder) })
                            .transition(.opacity)
                    case .founder:
                        FounderView(onDone: { advance(.trust) })
                            .transition(Theme.Motion.push)
                    case .trust:
                        // Prima di cominciare a chiedere: cosa facciamo
                        // con quello che ci dice. Chi non si fida
                        // risponde a caso, e un profilo falso è peggio
                        // di nessun profilo. Qui esce anche il prompt
                        // ATT, e la risposta finisce sull'utente.
                        TrustView { status in
                            if let status { appState.saveTrackingChoice(status) }
                            advance(.hello)
                        }
                        .transition(Theme.Motion.push)
                    case .hello:
                        HelloView { name in
                            appState.saveIntroAnswers(name: name, referral: nil)
                            advance(.referral)
                        }
                        .transition(Theme.Motion.push)
                    case .referral:
                        ReferralView { referral in
                            appState.saveIntroAnswers(name: "", referral: referral)
                            advance(.quiz)
                        }
                        .transition(Theme.Motion.push)
                    case .quiz:
                        TasteQuizView(onDone: { profile in
                            appState.draftProfile = profile
                            advance(.loading)
                        })
                        .transition(Theme.Motion.push)
                    case .loading:
                        FakeLoadingView(profile: appState.draftProfile, onDone: { advance(.allSet) })
                            .transition(.opacity)
                    case .allSet:
                        AllSetView(profile: appState.draftProfile, cuisines: appState.quizCuisines, onDone: { advance(.blockers) })
                            .transition(.opacity)
                    case .blockers:
                        // L'unica domanda che guarda avanti invece che
                        // ai gusti: cosa ti farebbe mollare.
                        BlockersView { picked in
                            blockers = picked
                            appState.saveBlockers(picked.map(\.rawValue))
                            advance(.pairs)
                        }
                        .transition(Theme.Motion.push)
                    case .pairs:
                        // Quattro problemi e quattro risposte, i suoi
                        // per primi.
                        ProblemSlidesView(blockers: blockers, onDone: { advance(.audience) })
                            .transition(Theme.Motion.push)
                    case .audience:
                        // Tre persone, una per gruppo. Si tocca la
                        // propria, poi le parole dei primi utenti.
                        AudienceView { audience in
                            appState.saveAudience(audience)
                            advance(.reviews)
                        }
                        .transition(Theme.Motion.push)
                    case .reviews:
                        // I primi utenti dicono che l'app funziona.
                        // Qui chiediamo la stella.
                        ReviewsView(onDone: { advance(.diet) })
                            .transition(Theme.Motion.push)
                    case .diet:
                        // Ultima schermata prima del prezzo: dichiara
                        // dove vuole arrivare, e la dieta entra nel
                        // profilo appena prima che venga salvato.
                        DietChoiceView { identity in
                            appState.draftProfile.dietaryIdentity = identity
                            appState.completeOnboarding()
                        }
                        .transition(Theme.Motion.push)
                    }
                }
            }
        }
        .animation(Theme.Motion.slow, value: beat)
        .onChange(of: beat) { _, new in track(new) }
    }

    private func advance(_ next: Beat) {
        Haptics.light()
        withAnimation(Theme.Motion.slow) { beat = next }
    }

    /// Segna i beat che sono una schermata sola. Welcome, quiz e
    /// coppie hanno più step dentro e si segnano da sé; il caricamento
    /// del profilo non chiede niente a nessuno, quindi non è uno step:
    /// chi lo vede è già arrivato al profilo pronto.
    private func track(_ beat: Beat) {
        switch beat {
        case .founder: appState.trackOnboarding(.founder)
        case .trust: appState.trackOnboarding(.trust)
        case .hello: appState.trackOnboarding(.hello)
        case .referral: appState.trackOnboarding(.referral)
        case .allSet: appState.trackOnboarding(.profileReady)
        case .blockers: appState.trackOnboarding(.blockers)
        case .audience: appState.trackOnboarding(.audience)
        case .reviews: appState.trackOnboarding(.reviews)
        case .diet: appState.trackOnboarding(.diet)
        case .welcome, .quiz, .loading, .pairs: break
        }
    }
}
