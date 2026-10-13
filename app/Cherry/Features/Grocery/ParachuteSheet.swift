import SwiftUI
import FirebaseFirestore

// Il paracadute in corsia (§4.2): "non trovo il tempeh" → quali ricette
// ne dipendono + sostituti immediati con rationale di due parole.
// Accettare riscrive gli step in background e aggiorna la lista in place.
struct ParachuteSheet: View {
    @ObservedObject var store: RunStore
    let item: GroceryItem

    @Environment(\.dismiss) private var dismiss
    @State private var jobId: String?
    @State private var parachute: Parachute?
    @State private var listener: ListenerRegistration?
    @State private var errorMessage: String?
    @State private var applying = false

    private var affectedRecipes: [Recipe] {
        store.keptRecipes.filter { item.recipeIds.contains($0.id ?? "") }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Can't find \(item.name)?")
                .font(Theme.display(24))
                .foregroundStyle(Theme.ink)
                .padding(.top, 26)

            if !affectedRecipes.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("NEEDED BY")
                        .font(Theme.body(11, weight: .bold))
                        .foregroundStyle(Theme.subtle)
                        .tracking(1.2)
                    ForEach(affectedRecipes) { recipe in
                        Text("• \(recipe.title)")
                            .font(Theme.body(14, weight: .medium))
                            .foregroundStyle(Theme.ink)
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.soft_red)
            } else if let parachute {
                VStack(spacing: 10) {
                    ForEach(Array(parachute.substitutes.enumerated()), id: \.offset) { index, substitute in
                        Button {
                            apply(index: index, substitute: substitute)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(substitute.name)
                                        .font(Theme.body(16, weight: .bold))
                                        .foregroundStyle(Theme.ink)
                                    Text(substitute.quantity)
                                        .font(Theme.body(12))
                                        .foregroundStyle(Theme.subtle)
                                }
                                Spacer()
                                Text(substitute.rationale)
                                    .font(Theme.body(12, weight: .semibold))
                                    .foregroundStyle(Theme.brand)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    .background(Capsule().fill(Theme.brand.opacity(0.1)))
                            }
                            .padding(14)
                            .vegoCard()
                        }
                        .buttonStyle(.plain)
                        .disabled(applying)
                    }
                }
                if applying {
                    HStack {
                        ProgressView()
                        Text("Rewriting your recipes…")
                            .font(Theme.body(13))
                            .foregroundStyle(Theme.subtle)
                    }
                    .frame(maxWidth: .infinity)
                }
            } else {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Finding substitutes…")
                        .font(Theme.body(14))
                        .foregroundStyle(Theme.subtle)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
            }

            Spacer()
        }
        .padding(.horizontal, 22)
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(28)
        .background(CherryBackground(mood: .fresh))
        .task { await requestSubstitutes() }
        .onDisappear { listener?.remove() }
    }

    private func requestSubstitutes() async {
        do {
            var body: [String: Any] = [
                "runId": store.runId,
                "ingredientName": item.name,
            ]
            if let spaceId = store.scope.spaceId { body["spaceId"] = spaceId }
            let id = try await store.jobs.start("/grocery/substitute", body: body)
            jobId = id
            // Il risultato arriva su Firestore, nello scope della lista:
            // {users/uid | spaces/spaceId}/runs/{runId}/parachute/{jobId}
            listener = FirestoreService.listenDocument(
                "\(FirestoreService.runPath(store.scope, store.runId))/parachute/\(id)",
                as: Parachute.self
            ) { result in
                if let result {
                    Haptics.success()
                    parachute = result
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func apply(index: Int, substitute: SubstituteOption) {
        guard let jobId else { return }
        Haptics.medium()
        applying = true

        // Aggiornamento immediato della lista in place (client-side)…
        var updated = store.run?.groceryItems ?? []
        if let itemIndex = updated.firstIndex(where: { $0.id == item.id }) {
            updated[itemIndex].name = substitute.name
            updated[itemIndex].quantity = substitute.quantity
            updated[itemIndex].storeSection = substitute.storeSection
            updated[itemIndex].costUsd = substitute.costUsd
            updated[itemIndex].substitutedFrom = item.name
        }
        store.setItems(updated)

        // …e riscrittura degli step in background (fire-and-forget).
        Task {
            var body: [String: Any] = [
                "runId": store.runId,
                "parachuteId": jobId,
                "substituteIndex": index,
            ]
            if let spaceId = store.scope.spaceId { body["spaceId"] = spaceId }
            try? await store.jobs.start("/grocery/substitute/apply", body: body)
            await MainActor.run {
                applying = false
                dismiss()
            }
        }
    }
}
