import SwiftUI
import AppTrackingTransparency

// Il respiro tra la storia del founder e le domande.
//
// Da qui in poi l'app chiede: il nome, i gusti, le allergie, cosa ti
// blocca. Prima di chiedere conviene dire cosa ne facciamo — è il
// momento in cui l'utente decide se rispondere davvero o tirare a
// caso, e le risposte a caso avvelenano il profilo per sempre.
//
// Le tre promesse sono scritte apposta in modo verificabile: niente
// "teniamo al tuo riguardo per la privacy". Nessuna pubblicità è vero,
// non vendere i dati è vero, e la cancellazione totale esiste davvero
// in Impostazioni.
//
// Quello che NON possiamo scrivere è "non condividiamo niente con
// nessuno": l'app manda install, registrazioni e abbonamenti ad
// AppsFlyer per l'attribuzione delle campagne. Sta nella privacy
// policy, linkata qui sotto, e la promessa è formulata per non
// contraddirla.
//
// Ed è qui che si chiede il permesso di tracciamento (ATT), non in
// una schermata sua: la quarta riga lo annuncia come la nostra parte
// del patto, e il bottone che c'è già fa comparire il prompt di iOS.
// Nessun tap in più, e arriva dopo tre promesse che si possono
// verificare — il punto del percorso in cui un sì costa meno. Senza
// quel sì Meta non riesce a legare l'acquisto all'inserzione, e le
// campagne ottimizzano al buio.
struct TrustView: View {
    /// Lo stato ATT con cui si esce: quello scelto nel prompt, o
    /// quello già deciso a monte (interruttore di sistema spento,
    /// onboarding rifatto). `nil` solo negli screenshot automatici.
    let onDone: (ATTrackingManager.AuthorizationStatus?) -> Void

    @State private var shown = 0
    @State private var halo = false
    @State private var asking = false
    @Environment(\.openURL) private var openURL

    private let promises: [(icon: String, title: String, detail: String)] = [
        (
            "hand.raised.fill",
            "No ads. Not one.",
            "Cherry is paid for by the people who use it. You're the customer, never the product."
        ),
        (
            "lock.fill",
            "We don't sell your data",
            "Not to brands, not to supermarkets, not to anyone. What you eat is nobody else's business."
        ),
        (
            "trash.fill",
            "Leave whenever you want",
            "One tap in Settings deletes your profile, lists, recipes and scans. All of it, for good."
        ),
        (
            "megaphone.fill",
            "One thing we ask back",
            "We find new people through Instagram ads. Apple lets you tell us if one brought you here: a yes or no, and nothing about what you eat."
        ),
    ]

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                emblem
                    .padding(.top, 8)
                    .opacity(shown >= 1 ? 1 : 0)
                    .scaleEffect(shown >= 1 ? 1 : 0.7)

                Text("Thank you for\ntrusting us")
                    .font(Theme.display(28))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                    .padding(.top, 12)
                    .opacity(shown >= 2 ? 1 : 0)
                    .offset(y: shown >= 2 ? 0 : 14)

                Text("The next few questions shape everything\nCherry will ever cook for you.\nHere's our side of the deal.")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.subtle)
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
                    .opacity(shown >= 2 ? 1 : 0)

                VStack(spacing: 9) {
                    ForEach(promises.indices, id: \.self) { i in
                        promiseRow(promises[i])
                            .opacity(shown >= 3 + i ? 1 : 0)
                            .offset(y: shown >= 3 + i ? 0 : 16)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 18)
                .padding(.bottom, 12)
            }
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom) { cta }
        .onAppear(perform: reveal)
    }

    /// La mano alzata dentro un alone che respira: il gesto della
    /// promessa, non un lucchetto da banca.
    private var emblem: some View {
        ZStack {
            Circle()
                .fill(Theme.mint.opacity(0.35))
                .frame(width: 104, height: 104)
                .scaleEffect(halo ? 1.12 : 0.92)
                .blur(radius: 18)
                .animation(.easeInOut(duration: 2.8).repeatForever(autoreverses: true), value: halo)

            Image(systemName: "hand.raised.fill")
                .font(.system(size: 36, weight: .medium))
                .foregroundStyle(Theme.brandGradient)
                .padding(21)
                .glassEffect(.regular, in: .circle)
        }
        .frame(height: 112)
        .onAppear { halo = true }
    }

    private func promiseRow(_ promise: (icon: String, title: String, detail: String)) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: promise.icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.brand)
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text(promise.title)
                    .font(Theme.body(15, weight: .bold))
                    .foregroundStyle(Theme.ink)
                Text(promise.detail)
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.subtle)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .vegoCard(cornerRadius: 18)
    }

    /// Il link alla policy sta qui sotto e non in fondo alla lista:
    /// una promessa di privacy con la prova nascosta sotto la piega
    /// vale la metà.
    private var cta: some View {
        VStack(spacing: 10) {
            Button("Let's personalize Cherry", action: askTracking)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 24)
                .disabled(asking)

            Button("Read our privacy policy") {
                openURL(AppConfig.Legal.privacyURL)
            }
            .font(Theme.body(12.5, weight: .semibold))
            .foregroundStyle(Theme.brand)
        }
        .padding(.top, 8)
        .padding(.bottom, 20)
        .background(.ultraThinMaterial)
        .opacity(shown >= 7 ? 1 : 0)
    }

    /// Il prompt di iOS, agganciato al tap che l'utente fa comunque.
    /// Si chiede solo se nessuno ha ancora deciso: con "Consenti alle
    /// app di richiedere il tracciamento" spento il sistema risponde
    /// da solo e il prompt non compare. Qualunque sia la risposta si
    /// va avanti, e chi la riceve la registra: la percentuale di sì e
    /// il drop-off su questo confine sono i due numeri che dicono se
    /// la scelta di chiederlo qui era giusta.
    private func askTracking() {
        guard !asking else { return }
        asking = true
        Haptics.light()

        if Shot.active { // SHOT
            onDone(nil)
            return
        }
        requestTracking(attempt: 1)
    }

    /// iOS non dice mai "non l'ho mostrato". Se non può presentare
    /// l'alert — app non `active` in quell'istante, una transizione in
    /// corso, un altro alert di sistema in coda, o l'interruttore
    /// generale spento su certe versioni — risponde subito
    /// `notDetermined`, lo stesso valore di "non ha ancora risposto".
    /// Apple, nel suo forum, consiglia di ricontrollare e richiedere.
    /// Quindi un `notDetermined` immediato si riprova un paio di volte
    /// a breve distanza, poi si va avanti comunque: lo stato resta
    /// indeterminato e non si registra niente di falso.
    ///
    /// Codici: 0 notDetermined, 1 restricted, 2 denied, 3 authorized.
    private func requestTracking(attempt: Int) {
        let before = ATTrackingManager.trackingAuthorizationStatus
        #if DEBUG
        let active = UIApplication.shared.applicationState == .active
        print("[ATT] tentativo \(attempt): stato \(before.rawValue), app attiva: \(active)")
        #endif
        guard before == .notDetermined else {
            onDone(before)
            return
        }
        ATTrackingManager.requestTrackingAuthorization { status in
            // Il completamento arriva su un thread qualunque.
            DispatchQueue.main.async {
                #if DEBUG
                print("[ATT] risposta: \(status.rawValue)")
                #endif
                if status == .notDetermined, attempt < 3 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                        requestTracking(attempt: attempt + 1)
                    }
                } else {
                    onDone(status)
                }
            }
        }
    }

    private func reveal() {
        shown = 0
        for step in 1...7 {
            let delay = 0.15 + Double(step - 1) * 0.26
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                withAnimation(.spring(duration: 0.5, bounce: 0.22)) { shown = step }
                if step <= 3 { Haptics.light() }
            }
        }
    }
}
