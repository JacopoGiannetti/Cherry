import SwiftUI

// Tab bar Liquid Glass (§2): due pill di vetro + pulsante camera
// centrale rialzato. Il tap sul centro NON apre un menu: il pulsante
// si SCIOGLIE nelle due bolle "Menu" e "Product" (morphing con
// GlassEffectContainer + glassEffectID), e si ricompone al close.
struct MainTabView: View {
    @EnvironmentObject private var appState: AppState
    @State private var scanExpanded = false
    @State private var scanMode: ScanMode?
    @State private var showSettings = false
    @Namespace private var glassNamespace

    enum ScanMode: String, Identifiable {
        case menu, product
        var id: String { rawValue }
    }

    var body: some View {
        ZStack(alignment: .top) {
            // Le due pagine restano montate: cambiare tab non ricrea le
            // card. Prima ogni passaggio rifaceva tutto da zero — il
            // vetro si "materializzava" in dissolvenza, le illustrazioni
            // venivano ridecodificate, i listener Firestore rifatti — e
            // il velo pastello sulle card sembrava comparire a scatti.
            // Ora si alterna solo la visibilità, secco, come una tab
            // bar di sistema.
            ZStack {
                GroceryHomeView()
                    .tabPage(visible: appState.selectedTab != .recipes)
                RecipesHomeView()
                    .tabPage(visible: appState.selectedTab == .recipes)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // Header unico: stessa posizione su Grocery e Recipes.
            if !appState.hideMainChrome {
                TabScreenHeader(
                    style: appState.selectedTab == .recipes ? .headline : .greeting,
                    title: {
                        if appState.selectedTab == .recipes {
                            return appState.tasteProfile.dietaryIdentity == .vegan
                                ? "Save it.\nVeganize it."
                                : "Save it.\nMake it yours."
                        }
                        let name = appState.firstName?.split(separator: " ").first.map(String.init)
                        return name.map { "Hi, \($0)" } ?? "Hi there"
                    }(),
                    subtitle: appState.selectedTab == .recipes ? nil : "Cherry PRO",
                    onSettings: { showSettings = true }
                )
                .background {
                    // Velo di vetro che non finisce mai di colpo: il materiale
                    // (più un lavaggio crema in alto) è mascherato da un gradiente,
                    // così il contenuto che scorre sotto si dissolve gradualmente.
                    ZStack {
                        Rectangle().fill(.thinMaterial)
                        LinearGradient(
                            colors: [Theme.cream.opacity(0.85), Theme.cream.opacity(0)],
                            startPoint: .top, endPoint: .bottom
                        )
                    }
                    .mask {
                        LinearGradient(
                            stops: [
                                .init(color: .black, location: 0),
                                .init(color: .black, location: 0.45),
                                .init(color: .clear, location: 1),
                            ],
                            startPoint: .top, endPoint: .bottom
                        )
                    }
                    .padding(.bottom, -72)
                    .ignoresSafeArea(edges: .top)
                    .allowsHitTesting(false)
                }
                .zIndex(10)
            }

            // Scrim: scurisce e sfoca ciò che c'è dietro e richiude
            // lo scan toccando altrove. Le due bolle Menu/Product
            // restano nella tab bar (morphing dal +), non una card
            // a metà schermo. Niente zIndex: deve stare SOTTO la barra,
            // altrimenti copre le bolle e le rende intoccabili.
            if scanExpanded {
                Rectangle()
                    .fill(.black.opacity(0.25))
                    .background(.ultraThinMaterial.opacity(0.6))
                    .ignoresSafeArea()
                    .transition(.opacity)
                    .onTapGesture { collapse() }
            }

            if !appState.hideMainChrome {
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    ZStack(alignment: .bottom) {
                        // Un velo solo, come in alto: niente lastra crema
                        // a metà. La maschera arriva a opaco a fondo
                        // schermo, così sotto i tasti non ricompare nulla.
                        ZStack {
                            Rectangle().fill(.thinMaterial)
                            LinearGradient(
                                colors: [Theme.cream.opacity(0), Theme.cream],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        }
                        .mask {
                            LinearGradient(
                                stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: .black.opacity(0.18), location: 0.22),
                                    .init(color: .black.opacity(0.5), location: 0.48),
                                    .init(color: .black.opacity(0.85), location: 0.72),
                                    .init(color: .black, location: 0.86),
                                    .init(color: .black, location: 1),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 280)
                        .padding(.bottom, -70)
                        .ignoresSafeArea(edges: .bottom)
                        .allowsHitTesting(false)

                        glassBar
                            .padding(.horizontal, 24)
                            .padding(.bottom, 6)
                    }
                }
            }
        }
        // Gli anchor si risolvono nello STESSO GeometryReader che disegna
        // il velo: qualunque sia la safe area del telefono, il buco cade
        // esattamente sul pulsante. Con uno spazio con nome, invece, le
        // due origini differivano dell'inset in alto (Dynamic Island,
        // notch o niente) e il buco scendeva di quel tanto.
        .overlayPreferenceValue(HomeTourAnchorKey.self) { anchors in
            GeometryReader { geo in
                if let step = appState.homeTourStep {
                    HomeTourOverlay(
                        step: step,
                        size: geo.size,
                        hole: step.anchor.flatMap { anchors[$0] }.map { geo[$0] },
                        firstName: appState.firstName,
                        onNext: { appState.advanceHomeTour() },
                        onSkip: { appState.skipHomeTour() }
                    )
                    .transition(.opacity)
                }
            }
            .ignoresSafeArea()
        }
        .animation(Theme.Motion.signature, value: appState.homeTourStep)
        .ignoresSafeArea(.keyboard)
        .onAppear { appState.offerHomeTourIfNeeded() }
        .onChange(of: appState.homeTourStep) { _, step in
            if step != nil { scanExpanded = false }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .fullScreenCover(item: $scanMode) { mode in
            switch mode {
            case .menu: MenuScanFlow()
            case .product: ProductScanFlow()
            }
        }
    }

    // MARK: - La barra di vetro

    private var glassBar: some View {
        // La spacing del contenitore governa DUE cose: quanto vicino due
        // vetri si fondono a riposo, e quanto lontano arriva il morphing
        // durante le transizioni. Serve quindi alta (24) per l'animazione
        // liquida, con le bolle distanziate PIÙ della soglia (28) perché
        // a riposo restino separate invece di sciogliersi in un blob.
        GlassEffectContainer(spacing: 24) {
            if scanExpanded {
                // ── Stato espanso: le due bolle salgono IN VERTICALE
                // sopra il pulsante, che nel frattempo diventa la X.
                VStack(spacing: 22) {
                    scanOption(
                        symbol: "menucard.fill",
                        title: "Menu",
                        subtitle: "What do I order here?",
                        tint: Theme.lavender,
                        id: "scan.menu"
                    ) { pick(.menu) }

                    scanOption(
                        symbol: "barcode.viewfinder",
                        title: "Product",
                        subtitle: "What's really in this?",
                        tint: Theme.mint,
                        id: "scan.product"
                    ) { pick(.product) }

                    Button {
                        collapse()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 64, height: 64)
                            .contentShape(.circle)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.tint(Theme.brand.opacity(0.95)).interactive(), in: .circle)
                    .glassEffectID("scan.core", in: glassNamespace)
                    .offset(y: -14)
                    .padding(.top, 14)
                }
            } else {
                HStack(spacing: 14) {
                    tabButton(.grocery, symbol: "cart.fill", label: "Grocery")
                        .glassEffect(.regular.interactive(), in: .capsule)
                        .glassEffectID("tab.grocery", in: glassNamespace)
                        .homeTourAnchor(.groceryTab)

                    Button {
                        Haptics.medium()
                        withAnimation(.spring(duration: 0.45, bounce: 0.25)) {
                            scanExpanded = true
                        }
                    } label: {
                        Image(systemName: "viewfinder")
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 64, height: 64)
                            .contentShape(.circle)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.tint(Theme.brand.opacity(0.95)).interactive(), in: .circle)
                    .glassEffectID("scan.core", in: glassNamespace)
                    .offset(y: -14)
                    .homeTourAnchor(.scan)
                    .accessibilityLabel("Scan")

                    tabButton(.recipes, symbol: "book.fill", label: "Recipes")
                        .glassEffect(.regular.interactive(), in: .capsule)
                        .glassEffectID("tab.recipes", in: glassNamespace)
                        .homeTourAnchor(.recipesTab)
                }
            }
        }
    }

    private func scanOption(
        symbol: String, title: String, subtitle: String, tint: Color, id: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(tint.opacity(0.85))
                        .frame(width: 46, height: 46)
                    Image(systemName: symbol)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(Theme.body(17, weight: .bold))
                        .foregroundStyle(Theme.ink)
                    Text(subtitle)
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.subtle)
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.subtle.opacity(0.7))
            }
            .padding(.leading, 10)
            .padding(.trailing, 18)
            .padding(.vertical, 10)
            .frame(maxWidth: 320)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(tint.opacity(0.28)).interactive(), in: .capsule)
        .glassEffectID(id, in: glassNamespace)
        .glassEffectTransition(.matchedGeometry)
    }

    private func tabButton(_ tab: AppState.Tab, symbol: String, label: String) -> some View {
        let isSelected = appState.selectedTab == tab
        return Button {
            Haptics.selection()
            withAnimation(Theme.Motion.signature) { appState.selectedTab = tab }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .semibold))
                Text(label)
                    .font(Theme.body(13, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .foregroundStyle(isSelected ? Theme.brand : Theme.subtle.opacity(0.75))
            .padding(.horizontal, 12)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Azioni

    private func pick(_ mode: ScanMode) {
        Haptics.light()
        collapse()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            scanMode = mode
        }
    }

    private func collapse() {
        withAnimation(.spring(duration: 0.45, bounce: 0.25)) {
            scanExpanded = false
        }
    }
}

// MARK: - Pagina di tab sempre montata

/// Nascosta: invisibile, non toccabile, ignorata da VoiceOver, e con
/// il mesh di sfondo fermo. Il cambio non si anima: il `withAnimation`
/// del tab button deve muovere l'header, non dissolvere due pagine di
/// vetro una sull'altra.
private struct TabPage: ViewModifier {
    let visible: Bool

    func body(content: Content) -> some View {
        content
            .opacity(visible ? 1 : 0)
            .allowsHitTesting(visible)
            .accessibilityHidden(!visible)
            .environment(\.vegoMotionPaused, !visible)
            .animation(nil, value: visible)
    }
}

private extension View {
    func tabPage(visible: Bool) -> some View {
        modifier(TabPage(visible: visible))
    }
}
