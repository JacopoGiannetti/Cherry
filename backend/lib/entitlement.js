// Chi può usare le funzioni a pagamento. Un abbonamento vale ovunque:
// Stripe (web) o App Store (Superwall, app iOS). Letto sempre dal
// server: il client non può scriversi da solo questi campi (firestore.rules).
const { db } = require('./firebase');

const STRIPE_OK = new Set(['active', 'trialing', 'past_due']);

function isEntitled(user) {
  if (!user) return false;
  if (STRIPE_OK.has(user.stripe?.status)) return true;
  if (user.subscription?.status === 'active') return true;
  return false;
}

async function requireEntitlement(req, res, next) {
  try {
    const snap = await db().doc(`users/${req.uid}`).get();
    if (isEntitled(snap.exists ? snap.data() : null)) return next();
    return res.status(402).json({ error: 'subscription_required', message: 'Start your membership to use Cherry.' });
  } catch (e) {
    console.error('[entitlement] lettura fallita:', e.message);
    return res.status(503).json({ error: 'unavailable' });
  }
}

module.exports = { isEntitled, requireEntitlement };
