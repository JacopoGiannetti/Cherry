import Foundation
import ActivityKit

// Attributi della Live Activity di shopping (§4.2): condivisi tra
// app principale (che la avvia/aggiorna) e widget extension (che la disegna).
//
// Negli spazi condivisi la stessa lista vive su due telefoni: lo stato
// porta anche l'ultima mossa dell'altra persona, così la lock screen
// racconta "Sara ha preso il latte" invece di limitarsi a un contatore
// che cambia da solo.
struct ShoppingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var checkedCount: Int
        var totalCount: Int
        var spentUsd: Double
        /// Nome di chi ha spuntato per ultimo, se non sono io.
        var lastActorName: String?
        /// Ultimo articolo messo nel carrello.
        var lastItemName: String?
    }

    var runId: String
    var budgetUsd: Double
    /// Nome della lista, per distinguerla a colpo d'occhio.
    var listTitle: String = "Shopping run"
    /// Nome dello spazio condiviso, nil quando la spesa è personale.
    var spaceName: String?
    /// Serve al tap: apre l'app già dentro lo spazio giusto, invece di
    /// mostrare le liste personali e far cercare la lista condivisa.
    var spaceId: String?
}
