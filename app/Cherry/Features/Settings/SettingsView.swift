import StoreKit
import SwiftUI

// Settings (§2): dietro l'avatar. Stesso linguaggio del resto
// dell'app — mesh, vetro, card — non una List di sistema.
struct SettingsView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var restoring = false
    @State private var showSpaces = false
    @State private var showDeleteConfirm = false
    @State private var deleting = false
    @State private var deleteError: String?

    var body: some View {
        NavigationStack {
            ZStack {
                CherryBackground(mood: .fresh)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 22) {
                        header
                        profileHero
                        spaceCard
                        subscriptionCard
                        helpCard
                        legalCard
                        accountCard
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 40)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    CherryWordmark(height: CherryWordmarkSize.compact)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(Theme.body(16, weight: .semibold))
                        .foregroundStyle(Theme.brand)
                }
            }
            .alert("Couldn't delete your account", isPresented: deleteErrorBinding) {
                Button("OK", role: .cancel) { deleteError = nil }
            } message: {
                Text(deleteError ?? "")
            }
            .sheet(isPresented: $showSpaces) {
                SpacesSheet()
            }
        }
    }

    private var deleteErrorBinding: Binding<Bool> {
        Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })
    }

    /// Il dismiss non serve: cancellando si torna all'onboarding, che
    /// sostituisce l'intera gerarchia sotto questo foglio.
    private func deleteAccount() {
        deleting = true
        Task {
            do {
                try await appState.deleteAccount()
            } catch {
                deleteError = error.localizedDescription
            }
            deleting = false
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Settings")
                .font(Theme.display(34))
                .foregroundStyle(Theme.brandGradient)
            Text("How Cherry works for you")
                .font(Theme.body(14))
                .foregroundStyle(Theme.subtle)
        }
        .padding(.top, 4)
        .vegoEntrance(0)
    }

    // MARK: - Profilo

    private var profileHero: some View {
        NavigationLink {
            ProfileSettingsView()
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Theme.brandGradient)
                        .frame(width: 58, height: 58)
                    Text(profileInitials)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(appState.firstName ?? "Your profile")
                        .font(Theme.body(18, weight: .bold))
                        .foregroundStyle(Theme.ink)
                    Text(appState.tasteProfile.dietaryIdentity.title)
                        .font(Theme.body(12, weight: .semibold))
                        .foregroundStyle(Theme.brand)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Theme.mint.opacity(0.65), in: .capsule)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.subtle.opacity(0.7))
            }
            .padding(16)
            .contentShape(.rect(cornerRadius: 24))
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(Theme.mint.opacity(0.28)), in: .rect(cornerRadius: 24))
        .vegoEntrance(1)
    }

    private var profileInitials: String {
        let name = appState.firstName?.trimmingCharacters(in: .whitespaces) ?? ""
        guard let first = name.first else { return "V" }
        return String(first).uppercased()
    }

    // MARK: - Spazio

    private var spaceCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("Together")
            Button {
                showSpaces = true
            } label: {
                SettingsRow(
                    icon: "person.2.fill",
                    tint: Theme.brand,
                    title: "Shared space",
                    subtitle: "Lists with one other person"
                ) {
                    Text(appState.spaces.scopeName)
                        .font(Theme.body(13, weight: .semibold))
                        .foregroundStyle(Theme.subtle)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.subtle.opacity(0.7))
                }
            }
            .buttonStyle(.plain)
            .settingsCard()
        }
        .vegoEntrance(3)
    }

    // MARK: - Abbonamento

    private var subscriptionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("Subscription")
            SettingsGroup {
                SettingsRow(
                    icon: appState.subscriptions.isSubscribed ? "checkmark.seal.fill" : "seal",
                    tint: appState.subscriptions.isSubscribed ? Theme.brand : Theme.amber,
                    title: "Status",
                    subtitle: renewalLine
                ) {
                    Text(subscriptionLabel)
                        .font(Theme.body(13, weight: .bold))
                        .foregroundStyle(appState.subscriptions.isSubscribed ? Theme.brand : Theme.subtle)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(
                            (appState.subscriptions.isSubscribed ? Theme.mint : Theme.butter).opacity(0.7),
                            in: .capsule
                        )
                }

                SettingsDivider()

                Button { manageSubscription() } label: {
                    SettingsRow(icon: "creditcard.fill", tint: Theme.sky, title: "Manage subscription") {
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.subtle.opacity(0.7))
                    }
                }
                .buttonStyle(.plain)

                SettingsDivider()

                Button {
                    restoring = true
                    Task {
                        await appState.subscriptions.restore()
                        restoring = false
                    }
                } label: {
                    SettingsRow(
                        icon: "arrow.clockwise",
                        tint: Theme.lavender,
                        title: restoring ? "Restoring…" : "Restore purchases"
                    ) {
                        if restoring { ProgressView() }
                    }
                }
                .buttonStyle(.plain)
                .disabled(restoring)
            }
        }
        .vegoEntrance(4)
    }

    private var renewalLine: String? {
        guard let renewal = appState.subscriptions.expiresAt else { return nil }
        let date = renewal.formatted(date: .abbreviated, time: .omitted)
        // Dire "Renews" a chi ha già disdetto è una bugia che si scopre
        // il giorno in cui l'app smette di funzionare.
        if appState.subscriptions.willAutoRenew == false {
            return "Expires \(date)"
        }
        return "Renews \(date)"
    }

    // MARK: - Aiuto

    private var helpCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("Help")
            Button {
                dismiss()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                    appState.startHomeTour()
                }
            } label: {
                SettingsRow(
                    icon: "sparkles",
                    tint: Theme.amber,
                    title: "Replay app tour",
                    subtitle: "Grocery, Recipes and Scan — skip anytime"
                ) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.subtle.opacity(0.7))
                }
            }
            .buttonStyle(.plain)
            .settingsCard()
        }
        .vegoEntrance(5)
    }

    // MARK: - Legale

    private var legalCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("Privacy & support")
            SettingsGroup {
                legalLink("Privacy Policy", icon: "hand.raised.fill", tint: Theme.lavender, url: AppConfig.Legal.privacyURL)
                SettingsDivider()
                legalLink("Terms of Service", icon: "doc.text.fill", tint: Theme.sky, url: AppConfig.Legal.termsURL)
                if let url = AppConfig.Legal.mail(to: AppConfig.Legal.supportEmail, subject: "Cherry support") {
                    SettingsDivider()
                    legalLink("Contact support", icon: "envelope.fill", tint: Theme.mint, url: url)
                }
                if let url = AppConfig.Legal.mail(to: AppConfig.Legal.privacyEmail, subject: "Cherry privacy request") {
                    SettingsDivider()
                    legalLink("Privacy requests", icon: "lock.fill", tint: Theme.peach, url: url)
                }

            }
        }
        .vegoEntrance(6)
    }

    private func legalLink(_ title: String, icon: String, tint: Color, url: URL) -> some View {
        Link(destination: url) {
            SettingsRow(icon: icon, tint: tint, title: title) {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.subtle.opacity(0.7))
            }
        }
    }

    // MARK: - Account

    private var accountCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("Account")
            SettingsGroup {
                SettingsRow(
                    icon: "apple.logo",
                    tint: Theme.ink,
                    title: "Signed in with",
                    subtitle: String(appState.uid.prefix(12)) + "…"
                ) {
                    Text(appState.auth.isAppleLinked ? "Apple" : "Anonymous")
                        .font(Theme.body(13, weight: .semibold))
                        .foregroundStyle(Theme.subtle)
                }

                SettingsDivider()

                Button {
                    showDeleteConfirm = true
                } label: {
                    SettingsRow(
                        icon: "trash.fill",
                        tint: Theme.soft_red,
                        title: deleting ? "Deleting…" : "Delete account",
                        subtitle: "Profile, lists, recipes and scans"
                    ) {
                        if deleting { ProgressView() }
                    }
                }
                .buttonStyle(.plain)
                .disabled(deleting)
                .confirmationDialog(
                    "Delete your account?",
                    isPresented: $showDeleteConfirm,
                    titleVisibility: .visible
                ) {
                    Button("Delete everything", role: .destructive) { deleteAccount() }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("Your taste profile, grocery lists, saved recipes and scanned menus are erased. Shared spaces you're in stay with the other person. This can't be undone.")
                }
            }

            Text("Your subscription is billed by Apple — cancel it separately.")
                .font(Theme.body(11))
                .foregroundStyle(Theme.subtle.opacity(0.85))
                .padding(.horizontal, 4)
        }
        .vegoEntrance(7)
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(Theme.body(11, weight: .bold))
            .foregroundStyle(Theme.subtle)
            .tracking(1.2)
            .padding(.horizontal, 4)
    }

    /// L'indirizzo apps.apple.com/account/subscriptions apre l'elenco di
    /// TUTTI gli abbonamenti dell'Apple ID, e Cherry va cercato in mezzo
    /// agli altri. StoreKit sa aprire il foglio già su questa app, senza
    /// nemmeno uscire da Cherry: il link web resta solo come ripiego per
    /// simulatore e sandbox, dove il foglio non esiste.
    private func manageSubscription() {
        guard let scene = UIWindowScene.active else { return }

        Task {
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                await appState.subscriptions.refresh()
            } catch {
                if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
                    await UIApplication.shared.open(url)
                }
            }
        }
    }

    // Conta quello che dice Apple; Firestore è solo il riflesso lato server.
    private var subscriptionLabel: String {
        guard appState.subscriptions.hasChecked else { return "—" }
        return appState.subscriptions.isSubscribed ? "Active" : "Inactive"
    }
}

// MARK: - Righe e gruppi

private struct SettingsRow<Trailing: View>: View {
    let icon: String
    var tint: Color = Theme.brand
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 34, height: 34)
                .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Theme.body(16, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.leading)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.subtle)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .contentShape(Rectangle())
    }
}

private struct SettingsGroup<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            content()
        }
        .settingsCard()
    }
}

private struct SettingsDivider: View {
    var body: some View {
        Rectangle()
            .fill(Theme.ink.opacity(0.06))
            .frame(height: 1)
            .padding(.leading, 64)
    }
}

private extension View {
    func settingsCard() -> some View {
        glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}

// MARK: - Profile

/// Tutte le preferenze di gusto e dieta, su una pagina loro: in Settings
/// restano account, abbonamento e spazi.
struct ProfileSettingsView: View {
    @EnvironmentObject private var appState: AppState

    @State private var profile = TasteProfile()
    @State private var newExclusion = ""
    @State private var displayName = ""
    @State private var loaded = false

    var body: some View {
        List {
            Section {
                profileSubheading("Your name")
                TextField("Your name", text: $displayName)
                    .font(Theme.body(16))
                    .textContentType(.givenName)
                    .submitLabel(.done)
                    .onSubmit { appState.setDisplayName(displayName) }
            } footer: {
                Text("How Cherry greets you, and how you show up in a shared space.")
            }

            Section {
                profileSubheading("How you eat")
                ForEach(DietaryIdentity.choices) { identity in
                    Button {
                        Haptics.selection()
                        profile.dietaryIdentity = identity
                        save()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(identity.title)
                                    .font(Theme.body(16, weight: .semibold))
                                    .foregroundStyle(Theme.ink)
                                Text(identity.subtitle)
                                    .font(Theme.body(12))
                                    .foregroundStyle(Theme.subtle)
                            }
                            Spacer()
                            if profile.dietaryIdentity == identity {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(Theme.brand)
                            }
                        }
                    }
                }
            }

            Section {
                profileSubheading("Never serve me")
                ForEach(profile.exclusions, id: \.self) { exclusion in
                    HStack {
                        Text(exclusion.capitalized)
                            .font(Theme.body(15))
                        Spacer()
                        Button {
                            profile.exclusions.removeAll { $0 == exclusion }
                            save()
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(Theme.subtle.opacity(0.5))
                        }
                    }
                }
                HStack {
                    TextField("Add exclusion…", text: $newExclusion)
                        .font(Theme.body(15))
                        .onSubmit(addExclusion)
                    Button(action: addExclusion) {
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(Theme.brand)
                    }
                }
            } footer: {
                Text("These never show up in recipes, swaps or menu picks.")
            }

            Section {
                profileSubheading("Taste")
                Picker("Spice tolerance", selection: $profile.spiceTolerance) {
                    Text("Mild").tag("mild")
                    Text("Medium").tag("medium")
                    Text("Hot").tag("hot")
                }
                .onChange(of: profile.spiceTolerance) { _, _ in save() }

                Picker("Cooking effort", selection: $profile.effortTolerance) {
                    Text("Quick & easy").tag("quick")
                    Text("Balanced").tag("balanced")
                    Text("I love to cook").tag("elaborate")
                }
                .onChange(of: profile.effortTolerance) { _, _ in save() }
            }

            Section {
                profileSubheading("My kitchen")
                Toggle(isOn: shareIngredientsBinding) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Share ingredients")
                            .font(Theme.body(15))
                            .foregroundStyle(Theme.ink)
                        Text("Recipes in one shop reuse the same herbs, cans and tofu.")
                            .font(Theme.body(12))
                            .foregroundStyle(Theme.subtle)
                    }
                }
                .tint(Theme.brand)
                ForEach(KitchenAppliance.all) { appliance in
                    Button {
                        Haptics.selection()
                        toggleAppliance(appliance.id)
                    } label: {
                        HStack {
                            Image(systemName: appliance.icon)
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.brand)
                                .frame(width: 24)
                            Text(appliance.label)
                                .font(Theme.body(15))
                                .foregroundStyle(Theme.ink)
                            Spacer()
                            if currentAppliances.contains(appliance.id) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(Theme.brand)
                            }
                        }
                    }
                }
            } footer: {
                Text("We'll only suggest recipes you can actually cook.")
            }

            Section {
                profileSubheading("Language")
                Picker("Recipes language", selection: languageBinding) {
                    ForEach(ResponseLanguage.allCases) { language in
                        Text(language.title).tag(language.rawValue)
                    }
                }
                Picker("Measurements", selection: unitsBinding) {
                    ForEach(MeasurementSystem.allCases) { system in
                        Text(system.title).tag(system.rawValue)
                    }
                }
                Picker("Currency", selection: currencyBinding) {
                    ForEach(DisplayCurrency.allCases) { currency in
                        Text(currency.title).tag(currency.rawValue)
                    }
                }
            } footer: {
                Text("Language, units and currency apply to new recipes, swaps and menus. Changing language resets the other two. The app itself stays in English.")
            }
        }
        .scrollContentBackground(.hidden)
        .background { CherryBackground(mood: .fresh) }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            guard !loaded else { return }
            loaded = true
            profile = appState.tasteProfile
            displayName = appState.firstName ?? ""
        }
        // Uscire dalla pagina vale come conferma: senza, un nome scritto
        // e non "inviato" andrebbe perso.
        .onDisappear { appState.setDisplayName(displayName) }
    }

    private var currentAppliances: Set<String> {
        KitchenAppliance.defaults(for: profile)
    }

    private var shareIngredientsBinding: Binding<Bool> {
        Binding(
            get: { profile.ingredientSharing ?? true },
            set: {
                profile.ingredientSharing = $0
                save()
            }
        )
    }

    /// Almeno un elettrodomestico deve restare: senza, non esiste
    /// ricetta che si possa cucinare.
    private func toggleAppliance(_ id: String) {
        var updated = currentAppliances
        if updated.contains(id) {
            guard updated.count > 1 else { return }
            updated.remove(id)
        } else {
            updated.insert(id)
        }
        profile.appliances = KitchenAppliance.all.map(\.id).filter { updated.contains($0) }
        save()
    }

    /// Il campo è optional sul profilo (nil = English); il picker no.
    private var languageBinding: Binding<String> {
        Binding(
            get: { profile.language ?? "en" },
            set: { newValue in
                profile.language = newValue
                profile.applyLanguageDefaults()
                save()
            }
        )
    }

    private var unitsBinding: Binding<String> {
        Binding(
            get: { profile.resolvedUnits.rawValue },
            set: { newValue in
                profile.units = newValue
                save()
            }
        )
    }

    private var currencyBinding: Binding<String> {
        Binding(
            get: { profile.resolvedCurrency.rawValue },
            set: { newValue in
                profile.currency = newValue
                save()
            }
        )
    }

    private func profileSubheading(_ title: String) -> some View {
        Text(title)
            .font(Theme.body(13, weight: .bold))
            .foregroundStyle(Theme.subtle)
            .textCase(.uppercase)
            .tracking(0.6)
            .listRowInsets(EdgeInsets(top: 14, leading: 20, bottom: 4, trailing: 20))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }

    private func addExclusion() {
        let trimmed = newExclusion.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty, !profile.exclusions.contains(trimmed) else { return }
        profile.exclusions.append(trimmed)
        newExclusion = ""
        save()
    }

    private func save() {
        appState.saveProfile(profile)
    }
}
