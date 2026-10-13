// Quota giornaliera per utente, su Firestore.
// Due contatori separati: lavori AI e immagini generate.
// Contrariamente a GutSense, un job che va in cache NON consuma quota
// (il decremento avviene nel job runner solo quando si chiama davvero l'AI).
const { db, FieldValue } = require('./firebase');
const { keys } = require('../config/keys');

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function currentCount(uid, kind) {
  const snap = await db().doc(`users/${uid}`).get();
  const limits = (snap.exists && snap.get('dailyUsage')) || {};
  const day = limits[todayKey()] || {};
  return day[kind] || 0;
}

/**
 * Controlla la quota senza incrementarla. Ritorna { allowed, count, limit }.
 * kind: 'jobs' | 'images'
 */
async function checkQuota(uid, kind) {
  const limit = kind === 'images' ? keys.server.dailyImageLimit : keys.server.dailyJobLimit;
  try {
    const count = await currentCount(uid, kind);
    return { allowed: count < limit, count, limit };
  } catch (e) {
    // Firestore irraggiungibile: fail-open ma loggato, come scelta consapevole.
    console.error('[rate-limit] check fallito, richiesta ammessa:', e.message);
    return { allowed: true, count: 0, limit };
  }
}

/** Incrementa il contatore SOLO quando l'AI viene chiamata davvero. */
async function consumeQuota(uid, kind, amount = 1) {
  try {
    await db()
      .doc(`users/${uid}`)
      .set(
        { dailyUsage: { [todayKey()]: { [kind]: FieldValue.increment(amount) } } },
        { merge: true }
      );
  } catch (e) {
    console.error('[rate-limit] increment fallito:', e.message);
  }
}

/** Middleware Express: blocca con 429 se la quota jobs è esaurita. */
function jobQuotaGate(req, res, next) {
  checkQuota(req.uid, 'jobs').then(({ allowed, count, limit }) => {
    if (!allowed) {
      return res.status(429).json({
        error: 'daily_limit_exceeded',
        dailyLimit: limit,
        currentCount: count,
        resetsAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
      });
    }
    next();
  });
}

module.exports = { checkQuota, consumeQuota, jobQuotaGate };
