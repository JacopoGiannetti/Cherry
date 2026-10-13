// Webhook Superwall: unica rotta esposta senza HMAC/token Firebase
// (chi chiama è Superwall, autenticato dal webhook secret).
// Aggiorna lo stato abbonamento su users/{uid}.subscription.
//
// Superwall manda un involucro { object, type, data: { originalAppUserId, productId, ... } }
// con type tipo initial_purchase / renewal. L'app gli ha già detto l'uid
// Firebase con identify(), quindi originalAppUserId è quello.
const express = require('express');
const { keys } = require('../config/keys');
const { db, FieldValue, isReady } = require('../lib/firebase');
const { recordEvent, APP_OPEN_EVENT } = require('../lib/usage');

const router = express.Router();

// Nomi Superwall → nomi che Firestore e la dashboard già capiscono.
const EVENT_ALIAS = {
  initial_purchase: 'subscription_start',
  renewal: 'subscription_renew',
  subscription_extended: 'subscription_renew',
  non_renewing_purchase: 'nonrenewing_purchase',
  expiration: 'subscription_expire',
  cancellation: 'subscription_cancel',
  uncancellation: 'subscription_start',
  product_change: 'subscription_renew',
  subscription_paused: 'subscription_cancel',
  billing_issue: 'billing_issue',
};

const ACTIVE_EVENTS = new Set([
  'subscription_start',
  'subscription_renew',
  'trial_start',
  'trial_convert',
  'nonrenewing_purchase',
  'transaction_complete',
]);
const PAID_EVENTS = new Set([
  'subscription_start',
  'subscription_renew',
  'trial_convert',
  'nonrenewing_purchase',
  'transaction_complete',
]);
const INACTIVE_EVENTS = new Set([
  'subscription_expire',
  'subscription_cancel',
  'refund',
  'billing_issue',
  'expiration',
]);

function str(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function pickUid(event, data) {
  const candidates = [
    data.originalAppUserId,
    data.original_app_user_id,
    data.appUserId,
    data.app_user_id,
    event.appUserId,
    event.app_user_id,
    event.userId,
    event.user && event.user.appUserId,
  ];
  for (const raw of candidates) {
    const uid = str(raw);
    if (!uid) continue;
    if (uid.startsWith('$SuperwallAlias:')) continue;
    return uid;
  }
  return '';
}

function canonicalEvent(rawName, data) {
  const raw = str(rawName).toLowerCase();
  if (data.isTrialConversion === true) return 'trial_convert';
  const period = str(data.periodType).toUpperCase();
  if ((raw === 'initial_purchase' || raw === 'subscription_start') && period === 'TRIAL') {
    return 'trial_start';
  }
  return EVENT_ALIAS[raw] || raw;
}

router.post('/superwall', async (req, res) => {
  const secret = keys.superwall.webhookSecret;
  if (secret) {
    const header = req.get('authorization') || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : req.get('x-superwall-secret') || '';
    if (provided !== secret) return res.status(401).json({ error: 'invalid_secret' });
  } else {
    console.warn('[superwall] SUPERWALL_WEBHOOK_SECRET mancante: webhook non verificato');
  }
  if (!isReady()) return res.status(503).json({ error: 'backend_not_configured' });

  try {
    const event = req.body || {};
    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const rawName = event.type || data.name || event.event || event.name || '';
    const eventName = canonicalEvent(rawName, data);
    const uid = pickUid(event, data);

    if (!uid) {
      console.warn('[superwall] evento senza uid Firebase:', rawName || eventName);
      return res.status(200).json({ ok: true, skipped: 'no_user' });
    }

    const update = {
      lastEvent: eventName,
      lastEventAt: FieldValue.serverTimestamp(),
      raw: JSON.stringify(event).slice(0, 4000),
    };
    if (ACTIVE_EVENTS.has(eventName)) update.status = 'active';
    else if (INACTIVE_EVENTS.has(eventName)) update.status = 'inactive';
    if (PAID_EVENTS.has(eventName)) update.hasPaid = true;
    const productId = str(data.productId || data.product_id || event.productId || event.product_id);
    if (productId) update.productId = productId;

    // Quando ha pagato, e a quante aperture dell'app era arrivato.
    //
    // Si legge il documento prima di scriverlo perché il contatore delle
    // aperture è suo, e questa è l'unica occasione per fermarlo: al
    // rinnovo il numero sarebbe già cresciuto, e "compra alla terza
    // apertura" diventerebbe "compra alla trentesima". Per lo stesso
    // motivo si scrive una volta sola, al primo pagamento.
    if (PAID_EVENTS.has(eventName)) {
      const snap = await db().doc(`users/${uid}`).get();
      const before = snap.exists ? snap.data() || {} : {};
      if (!(before.subscription || {}).firstPaidAt) {
        const opens = ((before.usage || {}).features || {})[APP_OPEN_EVENT];
        update.firstPaidAt = FieldValue.serverTimestamp();
        update.opensAtPaid = Number.isFinite(opens) ? opens : 0;
      }
    }

    await db().doc(`users/${uid}`).set({ subscription: update }, { merge: true });
    if (ACTIVE_EVENTS.has(eventName) || INACTIVE_EVENTS.has(eventName)) {
      recordEvent(uid, `sub.${eventName}`);
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[superwall] webhook fallito:', e.message);
    res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
