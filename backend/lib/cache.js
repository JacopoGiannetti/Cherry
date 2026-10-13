// Cache globali su Firestore (§10.3 del blueprint): condivise tra TUTTI
// gli utenti, a differenza di GutSense dove la cache era per-utente e
// con un solo slot. Il centesimo utente che incolla la stessa carbonara
// virale riceve un risultato istantaneo e gratuito.
const crypto = require('crypto');
const { db, FieldValue } = require('./firebase');

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 giorni

function hashKey(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * collection: 'sourceRecipes' | 'products' | 'substitutions'
 * key: stringa o oggetto (viene hashato)
 */
async function getCached(collection, key, ttlMs = DEFAULT_TTL_MS) {
  const id = typeof key === 'string' ? key : hashKey(key);
  try {
    const snap = await db().doc(`caches/${collection}/entries/${id}`).get();
    if (!snap.exists) return null;
    const data = snap.data();
    const created = data.createdAt ? data.createdAt.toMillis() : 0;
    if (Date.now() - created > ttlMs) return null;
    return data.value;
  } catch (e) {
    console.error(`[cache ${collection}] lettura fallita:`, e.message);
    return null;
  }
}

async function setCached(collection, key, value) {
  const id = typeof key === 'string' ? key : hashKey(key);
  try {
    await db().doc(`caches/${collection}/entries/${id}`).set({
      value,
      createdAt: FieldValue.serverTimestamp(),
      hits: FieldValue.increment(0),
    });
  } catch (e) {
    console.error(`[cache ${collection}] scrittura fallita:`, e.message);
  }
}

async function bumpCacheHit(collection, key) {
  const id = typeof key === 'string' ? key : hashKey(key);
  db()
    .doc(`caches/${collection}/entries/${id}`)
    .set({ hits: FieldValue.increment(1) }, { merge: true })
    .catch(() => {});
}

module.exports = { getCached, setCached, bumpCacheHit, hashKey };
