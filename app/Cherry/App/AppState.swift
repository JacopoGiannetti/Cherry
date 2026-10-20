import SwiftUI
import Combine
import FirebaseFirestore
import AppTrackingTransparency

// Stato centrale dell'app: fase (onboarding → paywall → login → main),
// utente, profilo, deep link in sospeso. È qui che si corregge il
// difetto GutSense: i deep link vengono accettati in QUALSIASI fase
// e riscattati quando l'app è pronta.
@MainActor
final class AppState: ObservableObject {
    enum Phase {
        case launching
        case onboarding
        case paywall
        case signIn
        case main
    }

    enum Tab: Hashable {
        case grocery, scan, recipes
    }

    struct PendingRunOpen: Equatable {
        let runId: String
        let spaceId: String?
    }

    @Published var phase: Phase = .launching
    @Published var selectedTab: Tab = .grocery
    @Published var userDoc: UserDoc?
    @Published var pendingSwapURL: String?

    /// Tap su Live Activity: aprire la lista appena l'app è pronta.
    @Published var pendingRunOpen: PendingRunOpen?

    /// Link arrivati dalla share extension e non ancora aperti: si
    /// accumulano mentre l'utente continua a scorrere i social.
    @Published var sharedInbox: [String] = []

    /// C'è una lista in corso: lo decide la home Grocery, lo legge
    /// l'header condiviso in MainTabView.
    @Published var groceryHasActiveList = false
    /// L'unica lista attiva, se c'è. Due insieme non sono ammesse.
    @Published var activeShoppingRunId: String?

    /// Nasconde header e tab bar custom quando si apre un dettaglio ricetta.
    @Published var hideMainChrome = false

    /// Tour della home: nil quando è spento.
    @Published var homeTourStep: HomeTourStep?

    private static let homeTourDoneKey = "tour.home.done"

    let auth = AuthService()
    let subscriptions = SubscriptionStore()
    let spaces = SpacesStore()
    let sharedInboxStore = SharedInboxStore()
    lazy var jobs = JobClient(auth: auth)

    /// Profilo del quiz, mantenuto in memoria durante l'onboarding
    /// e scritto su Firestore alla fine.
    @Published var draftProfile = TasteProfile()

    private var userListener: ListenerRegistration?
    /// Una listener per scope (personale + ogni spazio): la Live
    /// Activity non deve morire solo perché sono tornato su "Just me".
    private var shoppingListeners: [String: ListenerRegistration] = [:]
    private var shoppingByKey: [String: Run] = [:]
    private var cancellables = Set<AnyCancellable>()
    private var forwardingInbox = false
    private let defaults = UserDefaults.standard

    var uid: String { auth.uid ?? AuthService.demoUID }
    var tasteProfile: TasteProfile { userDoc?.tasteProfile ?? draftProfile }

    func money(_ amount: Double) -> String { tasteProfile.money(amount) }

    /// Dove leggo e scrivo le liste in questo momento. Tutto il resto
    /// (profilo, ricette salvate, scansioni) resta sempre personale.
    var scope: DataScope { DataScope(uid: uid, spaceId: spaces.activeSpaceId) }

    /// Il nome solo se l'utente ce l'ha davvero dato: un saluto che dice
    /// "Hey Me" è peggio di nessun saluto.
    var firstName: String? {
        let stored = userDoc?.displayName?.trimmingCharacters(in: .whitespaces) ?? ""
        return stored.isEmpty ? nil : stored
    }

    /// L'unico posto in cui l'app chiama l'utente per nome. Calcolato
    /// qui e non nella home: il nome arriva da Firestore dopo il primo
    /// disegno, e un saluto impostato una volta sola non lo vedrebbe.
    var groceryHeaderSubtitle: String {
        if groceryHasActiveList { return "You've got a list going" }
        if let firstName { return "Hey \(firstName) — what's cooking?" }
        return "What's cooking this week?"
    }

    /// Nome con cui appaio all'altra persona.
    var myName: String {
        let stored = userDoc?.displayName?.trimmingCharacters(in: .whitespaces) ?? ""
        return stored.isEmpty ? "Me" : stored
    }

    /// Come vengo citato SULL'ALTRO telefono ("Sara ha preso il latte").
    /// "Me" andrebbe bene solo per me: chi legge è l'altra persona.
    var attributionName: String {
        let stored = userDoc?.displayName?.trimmingCharacters(in: .whitespaces) ?? ""
        return stored.isEmpty ? "Someone" : stored
    }

    /// Nome dello spazio attivo, nil quando la spesa è personale.
    var activeSpaceName: String? {
        guard let id = spaces.activeSpaceId else { return nil }
        return spaces.spaces.first { $0.id == id }?.name
    }

    /// L'accesso dipende da StoreKit, non da un flag locale che
    /// sopravviverebbe a una disdetta.
    var hasAccess: Bool {
        if subscriptions.isSubscribed { return true }
        // Holdout Superwall: gruppo di controllo che per definizione
        // non vede il paywall, quindi non può nemmeno restare fuori.
        return defaults.bool(forKey: "paywall.bypassed")
    }

    // MARK: - Avvio

    func start() async {
        await auth.start()
        await auth.persistShareExtensionToken()
        await subscriptions.start()
        observeSubscription()
        listenUserDoc()
        startSpaces()
        startSharedInbox()
        // La fase va decisa prima di leggere l'inbox: il redeem controlla
        // `phase == .main` per navigare e per avviare il prewarm degli
        // swap, e a questo punto deve vedere quella vera.
        advanceToCurrentPhase()
        redeemSharedURLFromAppGroup()
        // I piani suggeriti da Cherry: l'app non parte mai vuota.
        let uid = self.uid
        Task.detached { await PresetSeeder.seedIfNeeded(uid: uid) }
    }

    // MARK: - Spazi condivisi e Live Activity

    private func startSpaces() {
        // Prima i token e le Activity già a schermo (nate da un push
        // ad app chiusa): i listener Firestore partono subito dopo e
        // chiamano `sync`. Se `activity` è ancora nil in quel momento,
        // si farebbe una `request` nuova e la scheda visibile resterebbe
        // ferma sul numero vecchio.
        LiveActivityManager.shared.onPushToken = { [weak self] runId, spaceId, token in
            guard let self else { return }
            FirestoreService.registerLiveActivityToken(
                uid: self.uid,
                runId: runId,
                spaceId: spaceId,
                token: token
            )
        }
        LiveActivityManager.shared.onPushToStartToken = { [weak self] token in
            guard let self else { return }
            FirestoreService.registerPushToStartToken(uid: self.uid, token: token)
        }
        LiveActivityManager.shared.adoptExisting()

        refreshSpaces()

        // Le viste osservano AppState: senza inoltro non vedrebbero
        // cambiare lo spazio attivo.
        spaces.objectWillChange
            .sink { [weak self] in self?.objectWillChange.send() }
            .store(in: &cancellables)

        // Lo spazio attivo decide quale lista mostrare in Live Activity
        // se ce n'è più d'una; i listener coprono tutti gli spazi.
        spaces.$activeSpaceId
            .removeDuplicates()
            .sink { [weak self] _ in self?.publishLiveActivity() }
            .store(in: &cancellables)

        spaces.$spaces
            .map { $0.compactMap(\.id).sorted() }
            .removeDuplicates()
            .sink { [weak self] _ in self?.listenActiveRun() }
            .store(in: &cancellables)
    }

    /// L'uid può cambiare (utente di ritorno con Apple): appartenenze e
    /// lista attiva vanno riletti sul nuovo account.
    private func refreshSpaces() {
        shoppingListeners.values.forEach { $0.remove() }
        shoppingListeners.removeAll()
        shoppingByKey.removeAll()
        spaces.start(uid: uid, jobs: jobs)
        listenActiveRun()
    }

    /// Lista creata al volo (dalle ricette salvate) dentro uno spazio:
    /// va annunciata, altrimenti l'altra persona la scopre solo quando
    /// riapre l'app.
    func announceSharedList(runId: String, title: String, budgetUsd: Double, itemCount: Int) {
        guard let spaceId = spaces.activeSpaceId, itemCount > 0 else { return }
        let body: [String: Any] = [
            "spaceId": spaceId,
            "runId": runId,
            "checkedCount": 0,
            "totalCount": itemCount,
            "spentUsd": 0,
            "actorName": attributionName,
            "listTitle": title,
            "budgetUsd": budgetUsd,
        ]
        Task { try? await jobs.call("/spaces/activity/broadcast", body: body) }
    }

    /// La Live Activity segue la spesa, non la schermata: nasce quando
    /// una lista entra in modalità shopping (anche se creata dall'altra
    /// persona) e muore quando viene archiviata o svuotata. Si ascoltano
    /// TUTTI gli spazi: tornare su "Just me" non deve spegnere la
    /// lock screen di una lista condivisa ancora aperta.
    private func listenActiveRun() {
        var wanted: [String: DataScope] = ["": .personal(uid)]
        for space in spaces.spaces {
            if let id = space.id {
                wanted[id] = DataScope(uid: uid, spaceId: id)
            }
        }

        for key in shoppingListeners.keys where wanted[key] == nil {
            shoppingListeners[key]?.remove()
            shoppingListeners.removeValue(forKey: key)
            shoppingByKey.removeValue(forKey: key)
        }

        for (key, scope) in wanted {
            guard shoppingListeners[key] == nil else { continue }
            shoppingListeners[key] = FirestoreService.listenCollection(
                FirestoreService.runsQuery(scope: scope),
                as: Run.self
            ) { [weak self] runs in
                guard let self else { return }
                if let run = runs.first(where: { $0.status == .shopping }) {
                    self.shoppingByKey[key] = run
                } else {
                    self.shoppingByKey.removeValue(forKey: key)
                }
                self.publishLiveActivity()
            }
        }
        publishLiveActivity()
    }

    /// Preferisce la lista dello spazio che sto guardando; se non ce
    /// n'è una, tiene quella di un altro spazio invece di chiudere.
    private func publishLiveActivity() {
        let preferred = spaces.activeSpaceId ?? ""
        if let run = shoppingByKey[preferred] {
            syncLiveActivity(run, spaceId: spaces.activeSpaceId)
            return
        }
        for space in spaces.spaces {
            if let id = space.id, let run = shoppingByKey[id] {
                syncLiveActivity(run, spaceId: id)
                return
            }
        }
        if let run = shoppingByKey[""] {
            syncLiveActivity(run, spaceId: nil)
            return
        }
        LiveActivityManager.shared.end()
    }

    private func syncLiveActivity(_ run: Run, spaceId: String?) {
        guard let runId = run.id, run.status == .shopping else {
            LiveActivityManager.shared.end()
            return
        }
        let items = run.groceryItems ?? []
        let checked = items.filter(\.checked)
        // L'ultima mossa si mostra solo se è dell'altra persona: "hai
        // preso il latte" detto a me stesso non serve a niente.
        let byPartner = run.lastActorUid != nil && run.lastActorUid != uid
        let spaceName = spaceId.flatMap { id in spaces.spaces.first { $0.id == id }?.name }
        LiveActivityManager.shared.sync(.init(
            runId: runId,
            listTitle: run.title ?? "Shopping run",
            spaceName: spaceName,
            spaceId: spaceId,
            budgetUsd: run.budgetUsd,
            checked: checked.count,
            total: items.count,
            spentUsd: checked.reduce(0) { $0 + $1.costUsd },
            lastActorName: byPartner ? run.lastActorName : nil,
            lastItemName: byPartner ? run.lastItemName : nil
        ))
    }

    private func advanceToCurrentPhase() {
        if Shot.active { phase = .onboarding; return } // SHOT
        if !defaults.bool(forKey: "phase.onboardingDone") {
            phase = .onboarding
        } else if !hasAccess {
            phase = .paywall
        } else if !defaults.bool(forKey: "phase.signedIn") && !auth.isAppleLinked {
            phase = .signIn
        } else {
            phase = .main
        }
    }

    /// Scadenze e rimborsi arrivano da Apple anche ad app aperta:
    /// chi perde l'abbonamento torna al paywall senza riavviare.
    private func observeSubscription() {
        // Le viste osservano AppState: senza questo inoltro non si
        // accorgerebbero dei cambiamenti dello store annidato.
        subscriptions.objectWillChange
            .sink { [weak self] in self?.objectWillChange.send() }
            .store(in: &cancellables)

        subscriptions.$isSubscribed
            .dropFirst()
            .removeDuplicates()
            .sink { [weak self] subscribed in
                SuperwallActions.shared.syncSubscriptionStatus(isSubscribed: subscribed)
                guard let self, self.phase != .onboarding, self.phase != .launching else { return }
                withAnimation(.easeInOut) { self.advanceToCurrentPhase() }
            }
            .store(in: &cancellables)
    }

    private func listenUserDoc() {
        userListener?.remove()
        userListener = FirestoreService.listenDocument(
            FirestoreService.userPath(uid),
            as: UserDoc.self
        ) { [weak self] doc in
            self?.userDoc = doc
            // Telefono nuovo o reinstallazione: lo spazio in cui si stava
            // lavorando lo sa solo l'account.
            self?.spaces.adoptRemoteChoice(doc?.activeSpaceId)
        }
    }

    // MARK: - Funnel di onboarding

    /// Step già segnalati: tornare indietro e riavanzare non deve
    /// rimandare il ping. Il funnel conta le persone arrivate a una
    /// schermata, non quante volte ci sono passate.
    private var onboardingStepsSent: Set<String> = []

    /// Un ping per schermata vista. La dashboard non conserva eventi
    /// grezzi: legge questi contatori, e uno step che non li manda
    /// scompare dal funnel — con il suo drop-off attribuito a quello
    /// prima. L'elenco degli step sta in `OnboardingStep`.
    ///
    /// `v2.` nel nome: è il secondo onboarding, e i suoi contatori
    /// partono da zero invece di mescolarsi a quelli del primo. La
    /// dashboard legge le due versioni separate e le confronta.
    func trackOnboarding(_ step: OnboardingStep) {
        if Shot.active { return } // SHOT
        guard onboardingStepsSent.insert(step.rawValue).inserted else { return }
        jobs.ping("onboarding.step.\(OnboardingStep.version).\(step.rawValue)")
    }

    /// Il quiz saltato: non è uno step del percorso, è la scorciatoia
    /// che lo evita, e va misurata a parte.
    func trackOnboardingQuizSkipped() {
        guard onboardingStepsSent.insert("quiz.skip").inserted else { return }
        jobs.ping("onboarding.quiz.skip")
    }

    // MARK: - Aperture dell'app

    /// Un ping per apertura dell'app.
    ///
    /// È l'unica traccia che lascia chi non paga. Col paywall duro quella
    /// persona non genera nient'altro — non una ricetta, non una lista,
    /// non un job — quindi in dashboard risultava entrata una volta e mai
    /// più tornata, anche se l'app l'ha riaperta dieci volte. Senza questo
    /// contatore non si può sapere quante volte torna prima di decidere,
    /// né a quale ritorno compra chi compra.
    ///
    /// Due aperture a meno di cinque minuti sono la stessa visita: uscire
    /// per leggere un messaggio e rientrare non è tornare.
    func trackAppOpen() {
        if Shot.active { return } // SHOT
        // Senza uid vero il ping fallirebbe in silenzio: non si segna la
        // data, così il prossimo tentativo — a login pronto — conta.
        guard auth.uid != nil else { return }
        let now = Date()
        let key = "session.lastOpenAt"
        if let last = defaults.object(forKey: key) as? Date, now.timeIntervalSince(last) < 300 { return }
        defaults.set(now, forKey: key)
        jobs.ping("app.open")
    }

    // MARK: - Transizioni di fase

    func completeOnboarding() {
        // Il profilo del quiz viene scritto subito: l'utente è già
        // autenticato (anonimo) e i dati sopravvivono al paywall/login.
        saveProfile(draftProfile)
        defaults.set(true, forKey: "phase.onboardingDone")
        Analytics.log("onboarding_complete", ["diet": draftProfile.dietaryIdentity.rawValue])
        jobs.ping("onboarding.complete")
        withAnimation(.easeInOut) { advanceToCurrentPhase() }
    }

    /// Chiamata quando Superwall conferma l'acquisto: si ricontrolla
    /// comunque con Apple prima di dare accesso.
    func completePurchase() {
        Task {
            await subscriptions.refresh()
            withAnimation(.easeInOut) {
                phase = hasAccess ? .signIn : .paywall
            }
        }
    }

    /// L'utente è nel gruppo di controllo di un test Superwall: nessun
    /// paywall da mostrare, quindi si prosegue.
    func grantPaywallBypass() {
        defaults.set(true, forKey: "paywall.bypassed")
        withAnimation(.easeInOut) { advanceToCurrentPhase() }
    }

    /// Utente di ritorno dal Welcome (§9): login + restore, saltando
    /// onboarding e paywall.
    ///
    /// L'uid è appena cambiato: tutto ciò che pendeva dall'account
    /// anonimo (profilo, listener, spazi, inbox) va rimontato PRIMA di
    /// decidere dove atterrare, altrimenti la home si apre sui dati di
    /// nessuno. Torna false se su questo Apple ID non risulta alcun
    /// abbonamento: chi chiama deve poterlo dire, invece di lasciare
    /// che il paywall ricompaia senza spiegazioni.
    @discardableResult
    func completeReturningUser() async -> Bool {
        defaults.set(true, forKey: "phase.onboardingDone")
        defaults.set(true, forKey: "phase.signedIn")

        userDoc = nil
        draftProfile = TasteProfile()
        listenUserDoc()
        refreshSpaces()
        startSharedInbox()
        Analytics.identify(uid) // l'uid è cambiato: era anonimo, ora è il suo
        await auth.persistShareExtensionToken()

        await subscriptions.restore()
        withAnimation(.easeInOut) { advanceToCurrentPhase() }
        redeemPendingSwapIfAny()
        return hasAccess
    }

    func completeSignIn() {
        defaults.set(true, forKey: "phase.signedIn")
        listenUserDoc() // l'uid può essere cambiato (utente di ritorno)
        refreshSpaces()
        startSharedInbox()
        Analytics.identify(uid)
        Analytics.logRegistration()
        withAnimation(.easeInOut) { phase = .main }
        redeemPendingSwapIfAny()
        offerHomeTourIfNeeded()
    }

    // MARK: - Tour della home

    /// Primo ingresso in main dopo l'acquisto: un respiro perché
    /// grocery sia già a schermo, poi parte il tour.
    func offerHomeTourIfNeeded() {
        guard phase == .main, homeTourStep == nil else { return }
        guard !defaults.bool(forKey: Self.homeTourDoneKey) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
            self?.startHomeTour()
        }
    }

    func startHomeTour() {
        guard phase == .main else { return }
        hideMainChrome = false
        selectedTab = .grocery
        withAnimation(Theme.Motion.signature) {
            homeTourStep = .welcome
        }
    }

    func advanceHomeTour() {
        guard let current = homeTourStep, let next = current.next else {
            finishHomeTour()
            return
        }
        // Prima la tab giusta, poi il passo: il pezzo da illuminare deve
        // già essere a schermo quando la card lo cerca.
        if selectedTab != next.tab {
            withAnimation(Theme.Motion.signature) { selectedTab = next.tab }
        }
        withAnimation(Theme.Motion.signature) { homeTourStep = next }
    }

    func skipHomeTour() {
        finishHomeTour()
    }

    private func finishHomeTour() {
        defaults.set(true, forKey: Self.homeTourDoneKey)
        withAnimation(Theme.Motion.signature) {
            homeTourStep = nil
            selectedTab = .grocery
        }
    }

    /// Il nome che l'altra persona vede accanto alle spunte.
    func setDisplayName(_ name: String) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean != userDoc?.displayName else { return }
        userDoc?.displayName = clean
        FirestoreService.setUserFields(uid, ["displayName": clean])
    }

    /// Nome e canale di scoperta raccolti in onboarding. Il nome è lo
    /// stesso `displayName` degli spazi condivisi: chiederlo due volte
    /// sarebbe assurdo.
    func saveIntroAnswers(name: String, referral: String?) {
        var fields: [String: Any] = [:]

        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !clean.isEmpty {
            userDoc?.displayName = clean
            fields["displayName"] = clean
        }
        if let referral, !referral.isEmpty {
            userDoc?.referralSource = referral
            fields["referralSource"] = referral
            Analytics.log("onboarding_referral", ["source": referral])
        }

        guard !fields.isEmpty else { return }
        FirestoreService.setUserFields(uid, fields)
    }

    /// La risposta al prompt ATT, come l'ha data iOS: authorized,
    /// denied, restricted (o notDetermined se il prompt non è uscito).
    /// Non cambia niente per l'utente: serve a leggere in dashboard
    /// quanti dicono sì e se il confine trust → hello ha iniziato a
    /// perdere gente da quando lo chiediamo.
    func saveTrackingChoice(_ status: ATTrackingManager.AuthorizationStatus) {
        let label: String
        switch status {
        case .authorized: label = "authorized"
        case .denied: label = "denied"
        case .restricted: label = "restricted"
        case .notDetermined: label = "notDetermined"
        @unknown default: label = "unknown"
        }
        FirestoreService.setUserFields(uid, [
            "tracking": label,
            "trackingAskedAt": FieldValue.serverTimestamp(),
        ])
    }

    /// Le due risposte del quiz che non entrano nel profilo: le cucine
    /// che ama e cosa ha in cucina. Si chiedono per conoscerlo e per
    /// restituirgliele in "profilo pronto", non per generare: le cucine
    /// si scelgono a ogni spesa, gli elettrodomestici li chiede il
    /// wizard quando servono.
    private(set) var quizCuisines: [String] = []

    func saveQuizPreferences(
        cuisines: [String],
        appliances: [String],
        tried: String?,
        household: String?,
        nights: Int,
        dinnerTime: String?,
        reasons: [String],
        otherApps: String?
    ) {
        quizCuisines = cuisines
        var fields: [String: Any] = [:]
        if !cuisines.isEmpty { fields["favoriteCuisines"] = cuisines }
        if !appliances.isEmpty { fields["kitchenAppliances"] = appliances }
        if let tried, !tried.isEmpty { fields["plantBasedTried"] = tried }
        if let household, !household.isEmpty { fields["cookingFor"] = household }
        fields["plantBasedNights"] = nights
        if let dinnerTime, !dinnerTime.isEmpty { fields["dinnerTime"] = dinnerTime }
        if !reasons.isEmpty { fields["whyPlantBased"] = reasons }
        if let otherApps, !otherApps.isEmpty { fields["triedOtherApps"] = otherApps }
        guard !fields.isEmpty else { return }
        FirestoreService.setUserFields(uid, fields)
        Analytics.log("onboarding_quiz_prefs", [
            "cuisines": cuisines.count,
            "appliances": appliances.count,
            "tried": tried ?? "",
            "household": household ?? "",
            "nights": nights,
        ])
    }

    /// In quale dei tre gruppi di "chi è Cherry" si è riconosciuto:
    /// curious (taglia la carne), recipes (vuole ricette), already
    /// (già vegano o vegetariano).
    func saveAudience(_ audience: String) {
        FirestoreService.setUserFields(uid, ["audience": audience])
        Analytics.log("onboarding_audience", ["group": audience])
    }

    /// Cosa l'utente dichiara di avere contro, in ordine di scelta.
    /// Non cambia niente nel motore delle ricette: serve a sapere su
    /// quale promessa l'app viene comprata, e a rispondere alla persona
    /// giusta nelle schermate successive.
    func saveBlockers(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        userDoc?.blockers = ids
        FirestoreService.setUserFields(uid, ["blockers": ids])
        Analytics.log("onboarding_blockers", ["primary": ids[0], "count": ids.count])
    }

    // MARK: - Cancellazione account

    /// Cancellazione dell'account (Apple 5.1.1(v)). Il backend cancella
    /// spazi, file e documento; qui si smontano listener e stato locale
    /// e si riparte dall'onboarding con un utente anonimo nuovo.
    func deleteAccount() async throws {
        try await jobs.call("/account/delete", body: [:])

        userListener?.remove()
        userListener = nil
        shoppingListeners.values.forEach { $0.remove() }
        shoppingListeners.removeAll()
        shoppingByKey.removeAll()
        LiveActivityManager.shared.end()

        let previousUID = uid
        userDoc = nil
        draftProfile = TasteProfile()
        sharedInbox = []
        pendingSwapURL = nil
        pendingRunOpen = nil

        for key in [
            "phase.onboardingDone",
            "phase.signedIn",
            "paywall.bypassed",
            Self.homeTourDoneKey,
            "spaces.active.\(previousUID)",
        ] {
            defaults.removeObject(forKey: key)
        }

        if let group = UserDefaults(suiteName: AppConfig.appGroupID) {
            group.removeObject(forKey: AppConfig.sharedInboxDefaultsKey)
            group.removeObject(forKey: AppConfig.sharedURLDefaultsKey)
            group.removeObject(forKey: AppConfig.sharedAuthTokenKey)
        }

        await auth.resetAfterDeletion()
        listenUserDoc()
        refreshSpaces()
        startSharedInbox()
        Analytics.identify(uid)
        withAnimation(.easeInOut) { phase = .onboarding }
    }

    func saveProfile(_ profile: TasteProfile) {
        draftProfile = profile
        guard let data = try? JSONEncoder().encode(profile),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        FirestoreService.setUserFields(uid, ["tasteProfile": dict])
    }

    // MARK: - Deep link (fix del difetto GutSense: gestiti alla RADICE,
    // in qualunque fase; se l'app non è pronta restano in sospeso)

    func handleDeepLink(_ url: URL) {
        guard url.scheme == AppConfig.urlScheme else { return }
        // Tap sulla Live Activity → dritti alla lista (tab Grocery).
        // Se la spesa è di uno spazio condiviso si entra prima lì,
        // altrimenti si aprirebbero le liste personali.
        if url.host == "run" {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
            let runId = items?.first(where: { $0.name == "id" })?.value
            let spaceId = items?.first(where: { $0.name == "space" })?.value

            if let spaceId, !spaceId.isEmpty {
                spaces.select(spaceId: spaceId)
            }
            if let runId, !runId.isEmpty {
                pendingRunOpen = PendingRunOpen(runId: runId, spaceId: spaceId)
            }
            if phase == .main {
                selectedTab = .grocery
            }
            return
        }
        guard url.host == "swap" || url.host == "import" else { return }

        // Share extension: i link sono già nell'App Group. Si aprono
        // subito solo se l'utente ha scelto "Open Cherry now".
        if url.host == "import" {
            let autostart = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "autostart" })?.value == "1"
            redeemSharedURLFromAppGroup(autostart: autostart)
            return
        }

        let shared = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "url" })?.value
        guard let shared, !shared.isEmpty else { return }
        pendingSwapURL = shared
        if phase == .main {
            selectedTab = .recipes
        }
        // Nelle altre fasi resta in pendingSwapURL: la tab Recipes
        // lo consumerà appena l'utente arriva in main.
    }

    /// Allinea l'inbox in memoria con quella scritta dalla share
    /// extension. Si controlla a ogni ritorno in foreground.
    func redeemSharedURLFromAppGroup(autostart: Bool = false) {
        guard let groupDefaults = UserDefaults(suiteName: AppConfig.appGroupID) else { return }

        var inbox = groupDefaults.stringArray(forKey: AppConfig.sharedInboxDefaultsKey) ?? []

        // Link lasciato da una versione precedente dell'extension.
        if let legacy = groupDefaults.string(forKey: AppConfig.sharedURLDefaultsKey), !legacy.isEmpty {
            groupDefaults.removeObject(forKey: AppConfig.sharedURLDefaultsKey)
            if !inbox.contains(legacy) { inbox.append(legacy) }
            groupDefaults.set(inbox, forKey: AppConfig.sharedInboxDefaultsKey)
        }

        sharedInbox = inbox
        syncInboxPreviews()
        guard autostart, let latest = inbox.last else { return }

        // Non si toglie dall'inbox: chiudere lo swap senza salvare
        // deve ritrovare il link tra i pending. Si elimina solo col cestino.
        pendingSwapURL = latest
        if phase == .main { selectedTab = .recipes }
    }

    /// Toglie un link dall'inbox: è stato aperto o scartato.
    func consumeFromInbox(_ url: String) {
        sharedInbox.removeAll { $0 == url }
        guard let groupDefaults = UserDefaults(suiteName: AppConfig.appGroupID) else { return }
        groupDefaults.set(sharedInbox, forKey: AppConfig.sharedInboxDefaultsKey)
    }

    /// Scarta un link in attesa e la sua anteprima.
    func discardInboxItem(_ url: String) {
        consumeFromInbox(url)
        sharedInboxStore.discardPreview(url)
    }

    /// Chiede al backend titolo e foto per i link ancora anonimi, e
    /// avvia subito l'estrazione completa: magari la ricetta è già
    /// vegana e l'utente vuole solo ritrovarla pronta da salvare.
    func syncInboxPreviews() {
        sharedInboxStore.warmPreviews(for: sharedInbox)
        // Solo con accesso pieno: il prewarm consuma quota backend.
        guard phase == .main else { return }
        sharedInboxStore.prewarmSwaps(for: sharedInbox)
    }

    private func startSharedInbox() {
        sharedInboxStore.start(uid: uid, jobs: jobs)
        // Il forwarding si aggancia una volta sola: cambiare account
        // ripunta lo store, non moltiplica le sottoscrizioni.
        guard !forwardingInbox else { return }
        forwardingInbox = true
        sharedInboxStore.objectWillChange
            .sink { [weak self] in self?.objectWillChange.send() }
            .store(in: &cancellables)
    }

    private func redeemPendingSwapIfAny() {
        if pendingSwapURL != nil {
            selectedTab = .recipes
        }
        if pendingRunOpen != nil {
            selectedTab = .grocery
        }
    }
}
