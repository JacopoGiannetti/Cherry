import ActivityKit
import WidgetKit
import SwiftUI

// Live Activity dello shopping (§4.2): "7/24 · $31 spent" sulla lock
// screen e nella Dynamic Island. Il tap riporta alla lista.
//
// Nello spazio condiviso la riga più importante è l'ultima mossa
// dell'altra persona: è quella che evita di comprare due volte il latte.
struct ShoppingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShoppingActivityAttributes.self) { context in
            LockScreenView(context: context)
                .widgetURL(deepLink(context))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("\(context.state.checkedCount)/\(context.state.totalCount)",
                          systemImage: "checklist")
                        .font(.system(.headline, design: .rounded))
                        .foregroundStyle(Color(red: 0.898, green: 0.337, blue: 0.431))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(budgetText(context))
                        .font(.system(.headline, design: .rounded))
                        .foregroundStyle(overBudget(context) ? .orange : .primary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 6) {
                        ProgressView(value: progress(context))
                            .tint(Color(red: 0.898, green: 0.337, blue: 0.431))
                        if let note = partnerNote(context) {
                            Text(note)
                                .font(.system(.caption, design: .rounded))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: "cart.fill")
                    .foregroundStyle(Color(red: 0.898, green: 0.337, blue: 0.431))
            } compactTrailing: {
                Text("\(context.state.checkedCount)/\(context.state.totalCount)")
                    .font(.system(.caption2, design: .rounded).weight(.bold))
                    .foregroundStyle(Color(red: 0.898, green: 0.337, blue: 0.431))
            } minimal: {
                Image(systemName: "cart.fill")
                    .foregroundStyle(Color(red: 0.898, green: 0.337, blue: 0.431))
            }
            .widgetURL(deepLink(context))
        }
    }

    private func deepLink(_ context: ActivityViewContext<ShoppingActivityAttributes>) -> URL? {
        var link = "cherry://run?id=\(context.attributes.runId)"
        if let spaceId = context.attributes.spaceId {
            link += "&space=\(spaceId)"
        }
        return URL(string: link)
    }

    private func progress(_ context: ActivityViewContext<ShoppingActivityAttributes>) -> Double {
        guard context.state.totalCount > 0 else { return 0 }
        return Double(context.state.checkedCount) / Double(context.state.totalCount)
    }

    private func overBudget(_ context: ActivityViewContext<ShoppingActivityAttributes>) -> Bool {
        context.attributes.budgetUsd > 0 && context.state.spentUsd > context.attributes.budgetUsd
    }

    private func budgetText(_ context: ActivityViewContext<ShoppingActivityAttributes>) -> String {
        let spent = Int(context.state.spentUsd.rounded())
        guard context.attributes.budgetUsd > 0 else { return "$\(spent)" }
        return "$\(spent)/\(Int(context.attributes.budgetUsd.rounded()))"
    }

    private func partnerNote(_ context: ActivityViewContext<ShoppingActivityAttributes>) -> String? {
        guard let actor = context.state.lastActorName else { return nil }
        guard let item = context.state.lastItemName else { return "\(actor) is shopping too" }
        return "\(actor) grabbed \(item)"
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<ShoppingActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(context.attributes.listTitle, systemImage: "cart.fill")
                    .font(.system(.subheadline, design: .rounded).weight(.semibold))
                    .foregroundStyle(Color(red: 1.0, green: 0.58, blue: 0.64))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(budgetText)
                    .font(.system(.subheadline, design: .rounded).weight(.bold))
                    .foregroundStyle(overBudget ? Color.orange : .white.opacity(0.95))
            }

            HStack(spacing: 12) {
                Text("\(context.state.checkedCount)/\(context.state.totalCount)")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())

                VStack(alignment: .leading, spacing: 4) {
                    Text(subtitle)
                        .font(.system(.caption, design: .rounded).weight(.medium))
                        .foregroundStyle(.white.opacity(0.72))
                        .lineLimit(1)
                    ProgressView(value: progress)
                        .tint(Color(red: 1.0, green: 0.58, blue: 0.64))
                }
            }
        }
        .padding(16)
        .activityBackgroundTint(Color.black.opacity(0.62))
    }

    /// Con qualcuno dentro, il sottotitolo è la sua ultima mossa.
    private var subtitle: String {
        if let actor = context.state.lastActorName {
            if let item = context.state.lastItemName {
                return "\(actor) grabbed \(item)"
            }
            return "shared with \(actor)"
        }
        if let space = context.attributes.spaceName {
            return "in \(space)"
        }
        return "items in the cart"
    }

    private var progress: Double {
        guard context.state.totalCount > 0 else { return 0 }
        return Double(context.state.checkedCount) / Double(context.state.totalCount)
    }

    private var overBudget: Bool {
        context.attributes.budgetUsd > 0 && context.state.spentUsd > context.attributes.budgetUsd
    }

    private var budgetText: String {
        let spent = Int(context.state.spentUsd.rounded())
        guard context.attributes.budgetUsd > 0 else { return "$\(spent) spent" }
        return "$\(spent) / $\(Int(context.attributes.budgetUsd.rounded()))"
    }
}
