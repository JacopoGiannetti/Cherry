// Lettura del Taste Profile dell'utente da Firestore.
// È il parametro di sistema che condiziona ogni generazione (§7).
const { db } = require('./firebase');

const DEFAULT_PROFILE = {
  dietaryIdentity: 'omnivore',
  exclusions: [],
  cuisineAffinities: [],
  spiceTolerance: 'medium',
  effortTolerance: 'balanced',
  language: 'en',
  // Chi non ha ancora dichiarato la sua cucina: si assume l'essenziale.
  appliances: ['stovetop', 'oven', 'microwave', 'freezer'],
};

async function getTasteProfile(uid) {
  const snap = await db().doc(`users/${uid}`).get();
  const profile = (snap.exists && snap.get('tasteProfile')) || {};
  return { ...DEFAULT_PROFILE, ...profile };
}

/**
 * Storico dei verdetti: l'app scrive un documento per ogni ricetta
 * swipata (id = id della ricetta). Sono i gusti dimostrati, non
 * dichiarati: valgono più di qualunque quiz, e attraversano le run.
 * Mai bloccante — se lo storico non c'è, si genera come prima.
 */
async function getTasteHistory(uid, limit = 35) {
  try {
    const snap = await db()
      .collection(`users/${uid}/tasteHistory`)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          title: data.title,
          cuisine: data.cuisine || '',
          mains: Array.isArray(data.mains) ? data.mains : [],
          verdict: data.verdict === 'kept' ? 'kept' : 'passed',
        };
      })
      .filter((entry) => entry.title);
  } catch (error) {
    console.warn(`[profile] storico gusti non leggibile per ${uid}: ${error.message}`);
    return [];
  }
}

module.exports = { getTasteProfile, getTasteHistory, DEFAULT_PROFILE };
