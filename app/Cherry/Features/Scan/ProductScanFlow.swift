import SwiftUI
import VisionKit
import FirebaseFirestore

// Product scan (§5.2): barcode decodificato ON-DEVICE con VisionKit
// (niente chiavi), lookup Open Food Facts nel backend. Il risultato è
// l'etichetta riletta: cosa è (vegano, vegetariano, proteico), quanto
// pesa (kcal, Nutri-Score, lavorazione) e i valori uno per uno. Chi
// segue una dieta vede anche se gli va bene.
struct ProductScanFlow: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var scannedBarcode: String?
    @State private var manualBarcode = ""
    @State private var scan: Scan?
    @State private var listener: ListenerRegistration?
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            CherryBackground(mood: .calm)

            VStack(spacing: 0) {
                if scannedBarcode == nil {
                    FeatureFlowHeader {
                        EmptyView()
                    } trailing: {
                        FeatureFlowCloseButton { dismiss() }
                    }
                } else if scan?.status != "done" && scan?.status != "not_found" {
                    CherryWordmark(height: CherryWordmarkSize.header)
                        .padding(.top, 8)
                        .padding(.bottom, 6)
                } else {
                    FeatureFlowHeader {
                        EmptyView()
                    } trailing: {
                        FeatureFlowCloseButton { dismiss() }
                    }
                }

                if let scan, scan.status == "done" || scan.status == "not_found" {
                    ProductResultView(scan: scan, diet: appState.tasteProfile.dietaryIdentity) { reset() }
                } else if scannedBarcode != nil {
                    checkingState
                } else {
                    scannerState
                }
            }
        }
        .onDisappear { listener?.remove() }
    }

    private var scannerState: some View {
        VStack(spacing: 0) {
            if BarcodeScannerView.isSupported {
                BarcodeScannerView { code in
                    guard scannedBarcode == nil else { return }
                    Haptics.success()
                    lookup(code)
                }
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .padding(16)

                Text("Point at the barcode")
                    .font(Theme.body(15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 11)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.bottom, 20)
            } else {
                Spacer()
                Text("📷").font(.system(size: 44))
                Text("Camera not available")
                    .font(Theme.title(20))
                    .foregroundStyle(Theme.ink)
                Text("Type the barcode number instead:")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.subtle)

                HStack {
                    TextField("e.g. 0123456789012", text: $manualBarcode)
                        .font(Theme.body(16))
                        .keyboardType(.numberPad)
                    Button("Check") {
                        guard manualBarcode.count >= 8 else { return }
                        lookup(manualBarcode)
                    }
                    .font(Theme.body(15, weight: .bold))
                    .foregroundStyle(Theme.brand)
                }
                .padding(14)
                .glassEffect(.regular, in: .rect(cornerRadius: 18))
                .padding(.horizontal, 24)
                .padding(.top, 10)
                Spacer()
            }
        }
    }

    private var checkingState: some View {
        Group {
            if let errorMessage {
                VStack(spacing: 14) {
                    CherryLottieView(animation: .cookingRelax, size: 140, softEdges: true)
                    Text("Checking the label…")
                        .font(Theme.display(24))
                        .foregroundStyle(Theme.brandGradient)
                    Text(errorMessage)
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.soft_red)
                    Button("Try again") { reset() }
                        .buttonStyle(SecondaryButtonStyle())
                        .padding(.horizontal, 80)
                }
            } else {
                CherryLoadingScreen(
                    animation: .cookingRelax,
                    title: "Checking the label…",
                    subtitle: "Reading the label for you"
                )
            }
        }
    }

    private func lookup(_ barcode: String) {
        scannedBarcode = barcode
        errorMessage = nil
        let id = UUID().uuidString

        Task {
            do {
                try await appState.jobs.start("/scan/product", body: [
                    "scanId": id,
                    "barcode": barcode,
                ])
                await MainActor.run {
                    listener = FirestoreService.listenDocument(
                        "users/\(appState.uid)/scans/\(id)",
                        as: Scan.self
                    ) { result in
                        guard let result else { return }
                        if result.status == "done" || result.status == "not_found" {
                            Haptics.medium()
                            scan = result
                        }
                    }
                }
            } catch {
                await MainActor.run { errorMessage = error.localizedDescription }
            }
        }
    }

    private func reset() {
        listener?.remove()
        listener = nil
        scan = nil
        scannedBarcode = nil
        manualBarcode = ""
        errorMessage = nil
    }
}

// MARK: - Risultato (§5.2)

/// L'etichetta riletta. In alto il prodotto come una foto attaccata
/// col nastro e le parole che lo descrivono (quelle che non valgono
/// restano barrate, così si vede che sono state controllate); poi le
/// kcal grandi col Nutri-Score; sotto i valori come su una vera
/// tabella nutrizionale, ognuno col suo livello.
struct ProductResultView: View {
    let scan: Scan
    let diet: DietaryIdentity
    let onScanAnother: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if scan.status == "not_found" {
                notFound
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 22) {
                        if let product = scan.product {
                            header(product)
                                .vegoEntrance(0)
                        }

                        if !badges.isEmpty {
                            MagnetWrap(spacing: 10) {
                                ForEach(badges, id: \.magnet.id) { badge in
                                    if badge.holds {
                                        MagnetTile(magnet: badge.magnet)
                                            .rotationEffect(.degrees(badge.tilt))
                                    } else {
                                        StruckTile(word: badge.magnet.word)
                                    }
                                }
                            }
                            .vegoEntrance(1)
                        }

                        if diet.isPlantBased, let verdict = scan.verdict, verdict.fits != nil {
                            dietLine(verdict)
                                .vegoEntrance(2)
                        }

                        if let nutrition = scan.product?.nutrition {
                            energyCard(nutrition)
                                .vegoEntrance(3)
                            NutritionLabel(nutrition: nutrition, per: scan.product?.per ?? "100 g")
                                .vegoEntrance(4)
                        } else {
                            noNutrition
                                .vegoEntrance(3)
                        }

                        if let source = sourceNote {
                            AIGeneratedNote(text: source)
                                .padding(.horizontal, 4)
                        }

                        Spacer(minLength: 100)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 6)
                }
            }

            Button("Scan another") {
                Haptics.light()
                onScanAnother()
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
    }

    // MARK: Prodotto

    private func header(_ product: ProductInfo) -> some View {
        HStack(alignment: .center, spacing: 18) {
            if let imageUrl = product.imageUrl, let url = URL(string: imageUrl) {
                CachedImage(url: url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    ProgressView().tint(Theme.subtle)
                }
                .frame(width: 84, height: 104)
                .padding(8)
                .background(.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .shadow(color: Theme.ink.opacity(0.14), radius: 10, y: 5)
                .overlay(alignment: .top) { tape }
                .rotationEffect(.degrees(-3))
                .padding(.top, 8)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(product.name)
                    .font(Theme.display(24))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(3)
                    .minimumScaleFactor(0.8)
                    .fixedSize(horizontal: false, vertical: true)
                let detail = [product.brand, product.quantity].compactMap { $0 }.joined(separator: " · ")
                if !detail.isEmpty {
                    Text(detail)
                        .font(Theme.body(13.5, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
    }

    /// Il pezzo di nastro di carta che tiene su la foto.
    private var tape: some View {
        Rectangle()
            .fill(Theme.butter.opacity(0.85))
            .frame(width: 46, height: 16)
            .overlay(Rectangle().stroke(.white.opacity(0.6), lineWidth: 0.5))
            .rotationEffect(.degrees(6))
            .offset(y: -9)
            .shadow(color: Theme.ink.opacity(0.06), radius: 1, y: 1)
    }

    // MARK: Etichette

    private struct Badge {
        let magnet: WordMagnet
        let holds: Bool
        let tilt: Double
    }

    /// Vegano assorbe vegetariano: se lo è, la seconda parola non dice nulla.
    private var badges: [Badge] {
        guard let b = scan.badges else { return [] }
        var list: [Badge] = []
        if let vegan = b.vegan {
            list.append(Badge(magnet: WordMagnet(id: "vegan", word: "vegan", wash: Color(hex: 0xD3EEDC), ink: Color(hex: 0x2E8B57)), holds: vegan, tilt: -2))
            if !vegan, let vegetarian = b.vegetarian {
                list.append(Badge(magnet: WordMagnet(id: "vegetarian", word: "vegetarian", wash: Theme.butter, ink: Color(hex: 0x977616)), holds: vegetarian, tilt: 1.5))
            }
        }
        if let protein = b.highProtein {
            list.append(Badge(magnet: WordMagnet(id: "protein", word: "high-protein", wash: Theme.peach, ink: Color(hex: 0xBF6B36)), holds: protein, tilt: 2.5))
        }
        return list.sorted { $0.holds && !$1.holds }
    }

    private func dietLine(_ verdict: Verdict) -> some View {
        let fits = verdict.fits == true
        let names = verdict.offendingIngredients.map(\.name).joined(separator: ", ")
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: fits ? "checkmark" : "xmark")
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(fits ? Theme.fit : Theme.soft_red, in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(fits ? "Fits your diet" : "Not for your diet")
                    .font(Theme.title(18))
                    .foregroundStyle(Theme.ink)
                if !names.isEmpty {
                    Text("Contains \(names)")
                        .font(Theme.body(13.5, weight: .medium))
                        .foregroundStyle(Theme.soft_red)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .glassEffect(.regular.tint((fits ? Theme.fitWash : Theme.blush).opacity(0.5)), in: CherryPebbleShape(hero: false))
    }

    // MARK: Energia e punteggi

    private func energyCard(_ nutrition: ProductNutrition) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(Int(nutrition.kcal))")
                    .font(Theme.display(54))
                    .foregroundStyle(Theme.ink)
                    .monospacedDigit()
                Text("kcal per \(scan.product?.per ?? "100 g")")
                    .font(Theme.body(13, weight: .semibold))
                    .foregroundStyle(Theme.subtle)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 10) {
                if let grade = scan.product?.nutriScore {
                    NutriScoreStrip(grade: grade)
                }
                if let nova = scan.product?.nova {
                    Text(Self.novaLabel(nova))
                        .font(Theme.body(12, weight: .bold))
                        .foregroundStyle(nova == 4 ? Theme.soft_red : Theme.subtle)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background((nova == 4 ? Theme.blush : Theme.ink.opacity(0.06)), in: .capsule)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .glassEffect(.regular.tint(.white.opacity(0.35)), in: CherryPebbleShape(hero: false))
    }

    /// Il gruppo NOVA detto a parole: il numero da solo non lo sa nessuno.
    private static func novaLabel(_ group: Int) -> String {
        switch group {
        case 1: "Unprocessed"
        case 2: "Kitchen ingredient"
        case 3: "Processed"
        default: "Ultra-processed"
        }
    }

    /// Dice da dove viene solo quello che è a schermo.
    private var sourceNote: String? {
        let hasNutrition = scan.product?.nutrition != nil
        let readsDiet = !badges.isEmpty || (diet.isPlantBased && scan.verdict?.fits != nil)
        switch (hasNutrition, readsDiet) {
        case (true, true): return "Nutrition and scores from Open Food Facts. Vegan and vegetarian read by AI from the ingredient list. Always check the pack before you buy."
        case (true, false): return "Nutrition and scores from Open Food Facts. Always check the pack before you buy."
        case (false, true): return "Read by AI from the ingredient list. Always check the pack before you buy."
        case (false, false): return nil
        }
    }

    private var noNutrition: some View {
        Text("Open Food Facts doesn't have the nutrition facts for this one yet.")
            .font(Theme.body(14, weight: .medium))
            .foregroundStyle(Theme.subtle)
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(.regular.tint(Theme.lavender.opacity(0.35)), in: CherryPebbleShape(hero: false))
    }

    private var notFound: some View {
        VStack(spacing: 10) {
            Spacer()
            Text("🤷").font(.system(size: 56))
            Text("Product not found")
                .font(Theme.display(26))
                .foregroundStyle(Theme.ink)
            Text("This barcode isn't in the database yet.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

/// Una parola che non vale per questo prodotto: barrata a mano, senza
/// fondo, così si vede che è stata controllata e non dimenticata.
private struct StruckTile: View {
    let word: String

    var body: some View {
        Text(word)
            .font(Theme.body(17, weight: .bold))
            .foregroundStyle(Theme.ink.opacity(0.32))
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .overlay {
                Capsule()
                    .fill(Theme.ink.opacity(0.4))
                    .frame(height: 2)
                    .padding(.horizontal, 9)
                    .rotationEffect(.degrees(-4))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1.2, dash: [5, 4]))
                    .foregroundStyle(Theme.ink.opacity(0.18))
            }
            .fixedSize()
            .accessibilityLabel("Not \(word)")
    }
}

/// Le cinque lettere di sempre, con quella del prodotto in rilievo.
private struct NutriScoreStrip: View {
    let grade: String

    private static let grades: [(String, Color)] = [
        ("a", Color(hex: 0x038141)),
        ("b", Color(hex: 0x85BB2F)),
        ("c", Color(hex: 0xF2C200)),
        ("d", Color(hex: 0xEE8100)),
        ("e", Color(hex: 0xE63E11)),
    ]

    var body: some View {
        VStack(alignment: .trailing, spacing: 5) {
            Text("NUTRI-SCORE")
                .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                .tracking(1)
                .foregroundStyle(Theme.subtle)
            HStack(spacing: 3) {
                ForEach(Self.grades, id: \.0) { letter, color in
                    let active = letter == grade
                    Text(letter.uppercased())
                        .font(.system(size: active ? 19 : 12, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                        .frame(width: active ? 32 : 20, height: active ? 38 : 26)
                        .background(color.opacity(active ? 1 : 0.35), in: RoundedRectangle(cornerRadius: active ? 9 : 6, style: .continuous))
                        .shadow(color: active ? color.opacity(0.4) : .clear, radius: 6, y: 3)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Nutri-Score \(grade.uppercased())")
    }
}

/// I valori come sulla tabella del retro: righe fitte, zuccheri e
/// grassi saturi rientrati sotto la loro voce, e accanto a ciascuna quanto è (poco, nella media, tanto)
/// secondo le soglie del semaforo britannico per 100 g.
private struct NutritionLabel: View {
    let nutrition: ProductNutrition
    let per: String

    private enum Level: Int { case low = 1, medium, high }

    /// Per proteine e fibre "tanto" è un bene; per il resto è il contrario.
    private struct Row: Identifiable {
        let id: String
        let name: String
        let grams: Double
        let indented: Bool
        let level: Level?
        let good: Bool
    }

    private var rows: [Row] {
        var rows: [Row] = []
        func add(_ name: String, _ value: Double?, indented: Bool = false, good: Bool = false, level: (Double) -> Level?) {
            guard let value else { return }
            rows.append(Row(id: name, name: name, grams: value, indented: indented, level: level(value), good: good))
        }
        let kcal = max(nutrition.kcal, 1)
        add("Protein", nutrition.protein, good: true) { g in
            let share = g * 4 / kcal
            return share >= 0.2 ? .high : share >= 0.12 ? .medium : .low
        }
        add("Fiber", nutrition.fiber, good: true) { $0 >= 6 ? .high : $0 >= 3 ? .medium : .low }
        add("Carbs", nutrition.carbs) { _ in nil }
        add("Sugars", nutrition.sugars, indented: true) { $0 > 22.5 ? .high : $0 > 5 ? .medium : .low }
        add("Fat", nutrition.fat) { $0 > 17.5 ? .high : $0 > 3 ? .medium : .low }
        add("Saturated fat", nutrition.saturatedFat, indented: true) { $0 > 5 ? .high : $0 > 1.5 ? .medium : .low }
        add("Salt", nutrition.salt) { $0 > 1.5 ? .high : $0 > 0.3 ? .medium : .low }
        return rows
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("What's inside")
                    .font(Theme.title(19))
                    .foregroundStyle(Theme.ink)
                Spacer()
                Text("per \(per)")
                    .font(Theme.body(12.5, weight: .semibold))
                    .foregroundStyle(Theme.subtle)
            }
            .padding(.bottom, 10)

            Rectangle()
                .fill(Theme.ink)
                .frame(height: 3)

            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 {
                    Rectangle()
                        .fill(Theme.ink.opacity(row.indented ? 0.07 : 0.14))
                        .frame(height: 1)
                        .padding(.leading, row.indented ? 18 : 0)
                }
                rowView(row)
            }
        }
        .padding(20)
        .background(.white.opacity(0.78), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(.white, lineWidth: 1)
        }
        .shadow(color: Theme.ink.opacity(0.08), radius: 16, y: 8)
    }

    private func rowView(_ row: Row) -> some View {
        HStack(spacing: 12) {
            Text(row.name)
                .font(row.indented ? Theme.body(14) : Theme.body(15, weight: .bold))
                .foregroundStyle(row.indented ? Theme.subtle : Theme.ink)
                .padding(.leading, row.indented ? 18 : 0)
            Spacer(minLength: 8)
            Text(Self.grams(row.grams))
                .font(Theme.body(15, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .monospacedDigit()
            meter(row)
                .frame(width: 76, alignment: .trailing)
        }
        .padding(.vertical, row.indented ? 8 : 11)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func meter(_ row: Row) -> some View {
        if let level = row.level {
            let color = Self.color(level, good: row.good)
            HStack(spacing: 6) {
                HStack(spacing: 2.5) {
                    ForEach(1...3, id: \.self) { step in
                        Capsule()
                            .fill(step <= level.rawValue ? color : Theme.ink.opacity(0.1))
                            .frame(width: 9, height: 5)
                    }
                }
                Text(Self.word(level))
                    .font(Theme.body(11, weight: .bold))
                    .foregroundStyle(color)
                    .frame(width: 30, alignment: .leading)
            }
        } else {
            Color.clear.frame(height: 1)
        }
    }

    private static func grams(_ value: Double) -> String {
        value < 10 && value != value.rounded()
            ? String(format: "%.1f g", value)
            : "\(Int(value.rounded())) g"
    }

    private static func word(_ level: Level) -> String {
        switch level {
        case .low: "low"
        case .medium: "mid"
        case .high: "high"
        }
    }

    private static func color(_ level: Level, good: Bool) -> Color {
        switch (level, good) {
        case (.high, true): Theme.fit
        case (.medium, true): Color(hex: 0x6DAE7F)
        case (.low, true): Theme.subtle
        case (.low, false): Theme.fit
        case (.medium, false): Theme.amber
        case (.high, false): Theme.soft_red
        }
    }
}

// MARK: - Scanner VisionKit

struct BarcodeScannerView: UIViewControllerRepresentable {
    let onScan: (String) -> Void

    static var isSupported: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.ean13, .ean8, .upce, .code128])],
            qualityLevel: .fast,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: (String) -> Void
        init(onScan: @escaping (String) -> Void) { self.onScan = onScan }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for item in addedItems {
                if case .barcode(let barcode) = item, let payload = barcode.payloadStringValue {
                    onScan(payload)
                    return
                }
            }
        }
    }
}
