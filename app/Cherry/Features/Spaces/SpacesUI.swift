import SwiftUI
import UIKit

// Gli spazi condivisi, lato interfaccia. La regola che tiene insieme
// tutto: in ogni momento devo sapere a colpo d'occhio se sto scrivendo
// nella MIA lista o in quella condivisa. Per questo la pill sta in cima
// alla home, cambia colore quando è condivisa, e usa sempre le stesse
// due parole ("Just me" / il nome dello spazio).

/// La pill in cima alla tab Grocery: dice dove finiscono le liste.
struct SpaceSwitcherPill: View {
    @EnvironmentObject private var appState: AppState
    let onTap: () -> Void

    private var space: Space? { appState.spaces.activeSpace }
    private var isShared: Bool { space != nil }

    var body: some View {
        Button {
            Haptics.light()
            onTap()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: isShared ? "person.2.fill" : "person.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(isShared ? Theme.brand : Theme.subtle)

                VStack(alignment: .leading, spacing: 1) {
                    Text(isShared ? (space?.name ?? "Shared") : "Just me")
                        .font(Theme.body(15, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(Theme.body(11, weight: .medium))
                        .foregroundStyle(Theme.subtle)
                        .lineLimit(1)
                }

                Spacer(minLength: 4)

                if let partner = appState.spaces.partner {
                    AvatarBubble(initials: partner.initials, tint: Theme.brand)
                }

                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.subtle)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity)
            .contentShape(.capsule)
            .glassEffect(
                isShared ? .regular.tint(Theme.brand.opacity(0.14)).interactive() : .regular.interactive(),
                in: .capsule
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isShared ? "Shared space \(space?.name ?? "")" : "Personal lists")
        .accessibilityHint("Switch space")
    }

    private var subtitle: String {
        guard let space else { return "Just yours" }
        if let partner = space.partner(of: appState.uid) {
            return "With \(partner.name)"
        }
        return "Waiting for a friend"
    }
}

/// Avatar minimo: due lettere, niente foto profilo da gestire.
struct AvatarBubble: View {
    let initials: String
    var tint: Color = Theme.brand
    var size: CGFloat = 26

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.42, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(tint, in: .circle)
    }
}

// MARK: - Il foglio: scegli dove lavorare, oppure invita qualcuno

struct SpacesSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var flow: Flow?

    private enum Flow: String, Identifiable {
        case create, join
        var id: String { rawValue }
    }

    private var spaces: SpacesStore { appState.spaces }

    /// Con uno spazio attivo il foglio ospita anche codice invito e
    /// uscita: serve più aria, altrimenti si apre già tagliato.
    private var sheetHeight: CGFloat {
        let base: CGFloat = 430
        let perSpace: CGFloat = 88
        let details: CGFloat = spaces.activeSpace != nil ? 210 : 0
        return min(720, base + CGFloat(spaces.spaces.count) * perSpace + details)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                CherryBackground(mood: .calm)

                // Con lo spazio condiviso attivo il contenuto (codice
                // invito + "Leave") supera l'altezza del foglio: senza
                // scroll l'ultima riga finisce sotto il bordo.
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 14) {
                        header

                        scopeCard(
                            title: "Just me",
                            subtitle: "Your own lists, private",
                            icon: "person.fill",
                            tint: Theme.subtle,
                            selected: spaces.activeSpaceId == nil
                        ) {
                            spaces.select(spaceId: nil)
                            dismiss()
                        }

                        ForEach(spaces.spaces) { shared in
                            if let id = shared.id {
                                sharedCard(shared, id: id)
                            }
                        }

                        // Create / join restano sempre in fondo: su
                        // "Just me" non devono mai comparire il codice
                        // di invito o "Leave this space" dello spazio
                        // condiviso — quelli stanno sotto la card dello
                        // spazio, e solo se quello è lo scope attivo.
                        inviteCard
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 28)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(Theme.body(15, weight: .semibold))
                }
            }
        }
        .presentationDetents([.height(sheetHeight), .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(32)
        .sheet(item: $flow) { which in
            switch which {
            case .create: CreateSpaceSheet()
            case .join: JoinSpaceSheet()
            }
        }
    }

    private var header: some View {
        VStack(spacing: 4) {
            Text("Where your lists live")
                .font(Theme.display(22))
                .foregroundStyle(Theme.brandGradient)
            Text("Switch anytime. Nothing moves between spaces.")
                .font(Theme.body(12))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 6)
        .padding(.bottom, 2)
    }

    private func scopeCard(
        title: String,
        subtitle: String,
        icon: String,
        tint: Color,
        selected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 42, height: 42)
                    .background(tint.opacity(0.12), in: .circle)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(Theme.body(17, weight: .bold))
                        .foregroundStyle(Theme.ink)
                    Text(subtitle)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.subtle)
                }

                Spacer()

                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(selected ? Theme.brand : Theme.subtle.opacity(0.35))
            }
            .padding(16)
            .contentShape(.rect(cornerRadius: Theme.cornerRadius))
            .vegoCard()
        }
        .buttonStyle(.plain)
    }

    /// Lo spazio condiviso: selezionabile. Codice invito e "Leave"
    /// stanno solo qui, e solo quando questo è lo spazio in cui sto
    /// lavorando — altrimenti sembrano appartenere a "Just me".
    private func sharedCard(_ space: Space, id: String) -> some View {
        let selected = spaces.activeSpaceId == id
        return VStack(spacing: 12) {
            scopeCard(
                title: space.name,
                subtitle: space.partner(of: appState.uid).map { "With \($0.name) · live" }
                    ?? "Waiting for someone to join",
                icon: "person.2.fill",
                tint: Theme.brand,
                selected: selected
            ) {
                spaces.select(spaceId: id)
                dismiss()
            }

            if selected {
                if !space.isFull, let code = space.inviteCode {
                    InviteCodeCard(code: code, spaceName: space.name)
                }

                Button(role: .destructive) {
                    Task { _ = await spaces.leave(spaceId: id) }
                } label: {
                    Label("Leave this space", systemImage: "person.fill.xmark")
                        .font(Theme.body(14, weight: .semibold))
                        .foregroundStyle(Theme.soft_red)
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
        }
    }

    /// Nessuno spazio ancora: create e join sempre visibili insieme.
    private var inviteCard: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "person.2.badge.plus")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Theme.brand)
                    .frame(width: 44, height: 44)
                    .background(Theme.brand.opacity(0.12), in: .circle)

                VStack(alignment: .leading, spacing: 3) {
                    Text("Shop together")
                        .font(Theme.body(17, weight: .bold))
                        .foregroundStyle(Theme.ink)
                    Text("One shared list for two — live on both phones.")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.subtle)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            HStack(spacing: 10) {
                Button("Create space") { flow = .create }
                    .buttonStyle(PrimaryButtonStyle())

                Button("I have a code") { flow = .join }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(16)
        .vegoCard()
    }
}

// MARK: - Codice invito

struct InviteCodeCard: View {
    let code: String
    let spaceName: String

    @State private var copied = false

    private var shareText: String {
        "Join my Cherry space \"\(spaceName)\" — open Cherry, tap the space switcher, then \"I have a code\" and enter \(code)."
    }

    var body: some View {
        VStack(spacing: 12) {
            Text("INVITE CODE")
                .font(Theme.body(11, weight: .bold))
                .foregroundStyle(Theme.subtle)
                .tracking(1.4)

            Text(code)
                .font(.system(size: 34, weight: .bold, design: .monospaced))
                .tracking(6)
                .foregroundStyle(Theme.ink)
                .padding(.leading, 6) // compensa il tracking sull'ultima lettera

            Text("Valid until someone joins. Only one person can use it.")
                .font(Theme.body(12))
                .foregroundStyle(Theme.subtle)
                .multilineTextAlignment(.center)

            HStack(spacing: 10) {
                Button {
                    UIPasteboard.general.string = code
                    Haptics.success()
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(Theme.body(14, weight: .semibold))
                        .foregroundStyle(Theme.brand)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .contentShape(.capsule)
                        .glassChip()
                }
                .buttonStyle(.plain)

                ShareLink(item: shareText) {
                    Label("Send", systemImage: "square.and.arrow.up")
                        .font(Theme.body(14, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .contentShape(.capsule)
                        .glassEffect(.regular.tint(Theme.brand.opacity(0.92)).interactive(), in: .capsule)
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(Theme.brand.opacity(0.07), in: .rect(cornerRadius: Theme.cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.cornerRadius)
                .strokeBorder(Theme.brand.opacity(0.22), lineWidth: 1)
        )
    }
}

// MARK: - Creazione

struct CreateSpaceSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var spaceName = "Our kitchen"
    @State private var myName = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        SpaceFormScaffold(
            title: "Create a shared space",
            subtitle: "You'll get a code to send to the other person.",
            icon: "person.2.badge.plus"
        ) {
            VStack(spacing: 12) {
                SpaceField(label: "Space name", text: $spaceName, placeholder: "Our kitchen")
                SpaceField(label: "Your name", text: $myName, placeholder: "How they'll see you")
                    .focused($nameFocused)
            }
        } footer: {
            VStack(spacing: 10) {
                if let error = appState.spaces.errorMessage {
                    Text(error)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.soft_red)
                        .multilineTextAlignment(.center)
                }
                Button {
                    create()
                } label: {
                    if appState.spaces.isWorking {
                        ProgressView().tint(.white)
                    } else {
                        Text("Create space")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canCreate || appState.spaces.isWorking)
                .opacity(canCreate ? 1 : 0.5)
            }
        }
        .onAppear {
            if myName.isEmpty, appState.myName != "Me" { myName = appState.myName }
            nameFocused = myName.isEmpty
        }
    }

    private var canCreate: Bool {
        !spaceName.trimmingCharacters(in: .whitespaces).isEmpty
            && !myName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func create() {
        let name = myName.trimmingCharacters(in: .whitespaces)
        appState.setDisplayName(name)
        Task {
            let ok = await appState.spaces.createSpace(
                name: spaceName.trimmingCharacters(in: .whitespaces),
                myName: name
            )
            if ok {
                Haptics.success()
                dismiss()
            }
        }
    }
}

// MARK: - Ingresso con codice

struct JoinSpaceSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var code = ""
    @State private var myName = ""
    @FocusState private var codeFocused: Bool

    var body: some View {
        SpaceFormScaffold(
            title: "Join a space",
            subtitle: "Ask the other person for their 6-character code.",
            icon: "person.badge.key.fill"
        ) {
            VStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("INVITE CODE")
                        .font(Theme.body(11, weight: .bold))
                        .foregroundStyle(Theme.subtle)
                        .tracking(1.2)
                    TextField("ABC123", text: $code)
                        .font(.system(size: 26, weight: .bold, design: .monospaced))
                        .tracking(4)
                        .multilineTextAlignment(.center)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .focused($codeFocused)
                        .padding(.vertical, 14)
                        .frame(maxWidth: .infinity)
                        .background(.white.opacity(0.6), in: .rect(cornerRadius: 16))
                        .onChange(of: code) { _, value in
                            code = String(value.uppercased().filter(\.isLetterOrNumber).prefix(6))
                        }
                }
                SpaceField(label: "Your name", text: $myName, placeholder: "How they'll see you")
            }
        } footer: {
            VStack(spacing: 10) {
                if let error = appState.spaces.errorMessage {
                    Text(error)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.soft_red)
                        .multilineTextAlignment(.center)
                }
                Button {
                    join()
                } label: {
                    if appState.spaces.isWorking {
                        ProgressView().tint(.white)
                    } else {
                        Text("Join")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canJoin || appState.spaces.isWorking)
                .opacity(canJoin ? 1 : 0.5)
            }
        }
        .onAppear {
            if myName.isEmpty, appState.myName != "Me" { myName = appState.myName }
            codeFocused = true
        }
    }

    private var canJoin: Bool {
        code.count == 6 && !myName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func join() {
        let name = myName.trimmingCharacters(in: .whitespaces)
        appState.setDisplayName(name)
        Task {
            let ok = await appState.spaces.join(code: code, myName: name)
            if ok {
                Haptics.success()
                dismiss()
            }
        }
    }
}

// MARK: - Impalcatura comune dei due form

private struct SpaceFormScaffold<Content: View, Footer: View>: View {
    let title: String
    let subtitle: String
    let icon: String
    @ViewBuilder var content: () -> Content
    @ViewBuilder var footer: () -> Footer

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            CherryBackground(mood: .calm)

            VStack(spacing: 18) {
                HStack {
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.subtle)
                            .frame(width: 32, height: 32)
                            .contentShape(.circle)
                            .glassChip()
                    }
                    .buttonStyle(.plain)
                }

                VStack(spacing: 8) {
                    Image(systemName: icon)
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(Theme.brand)
                    Text(title)
                        .font(Theme.title(22))
                        .foregroundStyle(Theme.ink)
                    Text(subtitle)
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.subtle)
                        .multilineTextAlignment(.center)
                }

                content()

                Spacer(minLength: 0)

                footer()
            }
            .padding(20)
        }
        .presentationDetents([.medium])
        .presentationCornerRadius(32)
    }
}

private struct SpaceField: View {
    let label: String
    @Binding var text: String
    let placeholder: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(Theme.body(11, weight: .bold))
                .foregroundStyle(Theme.subtle)
                .tracking(1.2)
            TextField(placeholder, text: $text)
                .font(Theme.body(16, weight: .medium))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 13)
                .background(.white.opacity(0.6), in: .rect(cornerRadius: 16))
        }
    }
}

private extension Character {
    var isLetterOrNumber: Bool { isLetter || isNumber }
}
