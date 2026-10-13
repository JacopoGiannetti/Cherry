import SwiftUI
import Lottie

// Animazioni Lottie per i loading (§10: la latenza è teatro).
// I file .lottie vivono in Resources/Lottie/ nel bundle.
enum CherryLottie: String {
    /// Import ricetta da social / estrazione ingredienti.
    case loading
    /// Meal plan: unica animazione della generazione.
    case cooking
    /// Scan menu o barcode prodotto.
    case cookingRelax = "cooking-relax"
    /// Finalize swap ("Make it vegan").
    case science
    /// Onboarding welcome — swipe up to start.
    case prepareFood = "prepare-food"
    /// Onboarding — "Optimizing your algorithm".
    case tomatoPlant = "tomato-plant"

    /// Xcode copia i .lottie nella radice del bundle, ma con una folder
    /// reference finirebbero in Lottie/: cerchiamo in entrambi i posti.
    var url: URL? {
        Bundle.main.url(forResource: rawValue, withExtension: "lottie", subdirectory: "Lottie")
            ?? Bundle.main.url(forResource: rawValue, withExtension: "lottie")
    }
}

struct CherryLottieView: View {
    let animation: CherryLottie
    var size: CGFloat = 160
    /// Dissolve i bordi dell'animazione (centro pieno): serve per i file
    /// con lo sfondo bianco, che altrimenti restano un rettangolo
    /// appiccicato sul mesh pastello.
    var softEdges = false

    var body: some View {
        LottieView {
            guard let url = animation.url else { return nil }
            return try await DotLottieFile.loadedFrom(url: url)
        } placeholder: {
            ProgressView()
                .frame(width: size, height: size)
        }
        .playing(loopMode: .loop)
        .frame(width: size, height: size)
        .mask {
            if softEdges {
                RadialGradient(
                    colors: [.black, .black.opacity(0.92), .clear],
                    center: .center,
                    startRadius: size * 0.08,
                    endRadius: size * 0.54
                )
            } else {
                Rectangle().fill(.black)
            }
        }
    }
}

/// Layout standard loading: Lottie + titolo + sottotitolo, e la
/// percentuale quando si sa da quando si sta aspettando.
struct CherryLoadingScreen: View {
    let animation: CherryLottie
    let title: String
    let subtitle: String
    var lottieSize: CGFloat = 180
    var progressStartedAt: Date?
    var progressFloor: Double = 0

    var body: some View {
        VStack(spacing: 14) {
            CherryLottieView(animation: animation, size: lottieSize, softEdges: true)
            Text(title)
                .font(Theme.display(24))
                .foregroundStyle(Theme.brandGradient)
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            if let progressStartedAt {
                LoadingPercent(startedAt: progressStartedAt, floor: progressFloor)
                    .padding(.top, 10)
            }
        }
    }
}

/// Curva del caricamento a tempo: veloce all'inizio, poi sempre più
/// lenta (50% a 10 s, 75% a 30 s, 90% a 60 s, 100% a 90 s). Si ferma
/// al 99% finché il lavoro non è finito; quando finisce, la schermata
/// se ne va da sola.
enum LoadingCurve {
    private static let points: [(seconds: Double, fraction: Double)] = [
        (0, 0), (10, 0.5), (30, 0.75), (60, 0.9), (90, 1),
    ]

    /// `floor` = avanzamento vero quando c'è (es. foto pronte): la barra
    /// non resta mai indietro rispetto a quello che è successo davvero.
    static func fraction(elapsed: TimeInterval, floor: Double = 0) -> Double {
        var timed = 1.0
        for (a, b) in zip(points, points.dropFirst()) where elapsed < b.seconds {
            let t = max(0, elapsed - a.seconds) / (b.seconds - a.seconds)
            timed = a.fraction + (b.fraction - a.fraction) * t
            break
        }
        return min(0.99, max(timed, floor))
    }
}

/// Percentuale grande + barra, aggiornata cinque volte al secondo.
struct LoadingPercent: View {
    let startedAt: Date
    var floor: Double = 0
    var width: CGFloat = 220

    var body: some View {
        TimelineView(.periodic(from: startedAt, by: 0.2)) { context in
            let fraction = LoadingCurve.fraction(
                elapsed: context.date.timeIntervalSince(startedAt),
                floor: floor
            )
            let percent = Int(fraction * 100)
            VStack(spacing: 8) {
                Text("\(percent)%")
                    .font(Theme.display(30))
                    .foregroundStyle(Theme.brandGradient)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.snappy, value: percent)
                PhotoProgressBar(fraction: fraction)
                    .frame(width: width)
            }
        }
    }
}
