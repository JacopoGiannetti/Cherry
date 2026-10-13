import SwiftUI

// Il beat tra la fiducia e il quiz: una domanda sola, il nome.
//
// Il nome non è una formalità — saluta in home ed è quello che l'altra
// persona vede accanto alle spunte negli spazi condivisi, quindi si
// chiede una volta sola qui.
//
// La provenienza stava su questa stessa schermata, sotto il campo del
// nome: con la tastiera aperta finiva sotto la piega e metà delle
// persone tirava dritto senza vederla. Ora ha una schermata sua.
//
// Non è obbligatoria: l'app funziona identica senza, e Apple non vuole
// dati personali imposti per usare il prodotto.
struct HelloView: View {
    let onDone: (_ name: String) -> Void

    @State private var name = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    mascot
                        .padding(.top, 10)

                    Text("Before we start,\nwhat should we\ncall you?")
                        .font(Theme.display(28))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.center)
                        .padding(.top, 18)

                    TextField("Your name", text: $name)
                        .font(Theme.title(20))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.center)
                        .textFieldStyle(.plain)
                        .textContentType(.givenName)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .focused($nameFocused)
                        .onSubmit { nameFocused = false }
                        .padding(.vertical, 16)
                        .padding(.horizontal, 20)
                        .glassEffect(.regular, in: .rect(cornerRadius: 20))
                        .padding(.horizontal, 32)
                        .padding(.top, 22)

                    Text("Just a first name. It's how Cherry greets you,\nand how you show up in a shared space.")
                        .font(Theme.body(12.5))
                        .foregroundStyle(Theme.subtle)
                        .multilineTextAlignment(.center)
                        .padding(.top, 10)
                        .padding(.bottom, 20)
                }
            }
            .scrollDismissesKeyboard(.interactively)

            continueButton
        }
        // Senza questo il pulsante sale con la tastiera e si piazza
        // sopra i tasti.
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { nameFocused = false }
                    .font(Theme.body(16, weight: .semibold))
            }
        }
    }

    // MARK: - La mascotte che saluta e impara il nome

    /// Il nome appena scritto, se basta per salutare.
    private var greetingName: String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count >= 2 ? trimmed : nil
    }

    /// Saluta con la manina e, a ogni lettera, fa un colpetto: sta
    /// ascoltando. Appena il nome ha due lettere lo ripete in un
    /// fumetto, in tempo reale: la prima prova che l'app ascolta davvero.
    private var mascot: some View {
        CherryMascotView(size: 108, pose: .wave, nudge: name.count)
            // Il fumetto è un overlay: non sposta la mascotte dal centro,
            // sta in alto a sinistra della testa con la coda verso di lei.
            .overlay(alignment: .top) {
                if let greetingName {
                    MascotBubble(style: .speech, tail: .bottomTrailing) {
                        Text("Hi, \(greetingName)!")
                            .font(Theme.body(14, weight: .bold))
                            .foregroundStyle(Theme.brand)
                            .lineLimit(1)
                            .frame(maxWidth: 150)
                    }
                    .fixedSize()
                    .offset(x: -60, y: -32)
                    .transition(.scale(scale: 0.5, anchor: .bottomTrailing).combined(with: .opacity))
                }
            }
            // Spazio per il fumetto sopra la testa, così non tocca il wordmark.
            .padding(.top, 40)
            .animation(Theme.Motion.celebration, value: greetingName)
    }

    /// Niente campo obbligatorio: se non vuole dirlo, si prosegue.
    private var continueButton: some View {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return Button(trimmed.isEmpty ? "Skip for now" : "Nice to meet you") {
            Haptics.light()
            nameFocused = false
            onDone(trimmed)
        }
        .buttonStyle(PrimaryButtonStyle())
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .animation(Theme.Motion.quick, value: trimmed.isEmpty)
    }
}
