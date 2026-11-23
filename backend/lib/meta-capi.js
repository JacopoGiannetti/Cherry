// Meta Conversions API: gli eventi importanti arrivano a Meta dal server, anche se
// il browser ha un blocco pubblicità o è Safari (che spesso perde gli eventi del Pixel).
// Eventi: CompleteRegistration, InitiateCheckout, Purchase, Subscribe.
//
// Consenso: si manda solo se per quella persona vale (lo decide il browser, come per il
// Pixel, e lo passa qui): in UE/UK ha premuto "Accept"; altrove (USA…) non ha fatto
// opt-out e il browser non manda Global Privacy Control.
//
// Deduplica: ogni evento ha lo stesso event_id dell'evento del browser, così Meta lo
// conta una volta sola (Purchase/Subscribe: l'id della Checkout Session).
//
// Prove: con Stripe in modalità test gli eventi partono solo se c'è META_TEST_EVENT_CODE,
// e portano quel codice (si vedono in Events Manager → Test events). In live niente codice.
const crypto = require('crypto');
const axios = require('axios');
const { keys } = require('../config/keys');
const { db } = require('./firebase');

const PIXEL_ID = process.env.META_PIXEL_ID || '';
const TOKEN = process.env.META_CAPI_TOKEN || '';
const TEST_CODE = process.env.META_TEST_EVENT_CODE || '';
const VERSION = process.env.META_GRAPH_VERSION || 'v23.0';

const sha = (v) => (v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined);
const clip = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);

function enabled() { return !!(PIXEL_ID && TOKEN); }

/** Stripe in modalità live? (chiave sk_live_ / rk_live_) */
const stripeLive = () => /^(sk|rk)_live_/.test(keys.stripe?.secretKey || '');

/** IP e user agent della richiesta del browser. */
function clientOf(req) {
  const ip = String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
  return { ip: ip.slice(0, 60), ua: String(req.get('user-agent') || '').slice(0, 480) };
}

/** Il consenso passato dal browser (metaForServer): vale solo se è esplicitamente true. */
const consented = (meta) => !!meta && meta.consent === true;

/**
 * Manda eventi a Meta. live = evento reale (false → serve META_TEST_EVENT_CODE).
 * Non lancia mai: un errore di Meta non deve rompere registrazione o pagamento.
 */
async function send(events, { live }) {
  try {
    if (!enabled() || !events.length) return 0;
    if (!live && !TEST_CODE) return 0;
    const body = { data: events, ...(!live ? { test_event_code: TEST_CODE } : {}) };
    const r = await axios.post(`https://graph.facebook.com/${VERSION}/${PIXEL_ID}/events`, body, { params: { access_token: TOKEN }, timeout: 10000 });
    const n = r.data?.events_received || 0;
    console.log(`[meta] ${events.map((e) => e.event_name).join('+')} inviati${live ? '' : ' (test)'}: ${n}`);
    logEvents(events, { live, ok: n === events.length, received: n });
    return n;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    console.warn('[meta] conversions api:', msg);
    logEvents(events, { live, ok: false, error: String(msg).slice(0, 300) });
    return 0;
  }
}

/** meta_events: cosa è partito dal server, per la dashboard. Senza dati personali (niente user_data). */
function logEvents(events, { live, ok, received, error }) {
  try {
    const batch = db().batch();
    for (const e of events) {
      batch.set(db().collection('meta_events').doc(), {
        name: e.event_name, eventId: e.event_id || null, value: e.custom_data?.value ?? null, currency: e.custom_data?.currency || null,
        live, ok, received: received ?? null, error: error || null, ts: Date.now(),
        hasFbp: !!e.user_data?.fbp, hasFbc: !!e.user_data?.fbc, hasEmail: !!e.user_data?.em,
      });
    }
    batch.commit().catch((err) => console.warn('[meta] log:', err.message));
  } catch (err) { console.warn('[meta] log:', err.message); }
}

function userData({ email, uid, fbp, fbc, ip, ua, country, zip }) {
  return {
    em: email ? [sha(email)] : undefined,
    external_id: uid ? [sha(uid)] : undefined,
    country: country ? [sha(country)] : undefined,
    zp: zip ? [sha(zip)] : undefined,
    fbp: clip(fbp, 200),
    fbc: clip(fbc, 400),
    client_ip_address: ip || undefined,
    client_user_agent: ua || undefined,
  };
}

/** Evento dal browser (CompleteRegistration, InitiateCheckout): consenso, ids e cookie da `meta`. */
function browserEvent(name, { meta, req, uid, email, eventId, url, custom }) {
  if (!consented(meta)) return null;
  const { ip, ua } = clientOf(req);
  return {
    event_name: name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: clip(eventId, 120),
    action_source: 'website',
    event_source_url: clip(url, 500) || `${keys.web.appUrl}/app`,
    user_data: userData({ email, uid, fbp: meta.fbp, fbc: meta.fbc, ip, ua }),
    custom_data: custom,
  };
}

/** CompleteRegistration (dopo il primo login, dal percorso). */
async function sendRegistration({ meta, req, uid, email, eventId, url }) {
  const ev = browserEvent('CompleteRegistration', { meta, req, uid, email, eventId, url, custom: { status: true, content_name: 'Cherry account' } });
  return ev ? send([ev], { live: stripeLive() }) : 0;
}

/** InitiateCheckout (quando si apre Stripe Checkout). */
async function sendInitiateCheckout({ meta, req, uid, email, eventId, value, currency, plan }) {
  const ev = browserEvent('InitiateCheckout', {
    meta, req, uid, email, eventId, url: `${keys.web.appUrl}/app/join`,
    custom: { value, currency: String(currency || 'usd').toUpperCase(), content_name: `Cherry ${plan}`, num_items: 1 },
  });
  return ev ? send([ev], { live: stripeLive() }) : 0;
}

/** Da tenere nella Checkout Session: cosa serve dopo per abbinare l'acquisto all'annuncio. */
function checkoutMetadata(meta, req) {
  if (!consented(meta)) return {};
  const { ip, ua } = clientOf(req);
  const out = { meta_consent: '1', meta_basis: meta.basis === 'opt_in' ? 'opt_in' : 'default', meta_ip: ip, meta_ua: ua };
  if (typeof meta.fbp === 'string') out.meta_fbp = meta.fbp.slice(0, 200);
  if (typeof meta.fbc === 'string') out.meta_fbc = meta.fbc.slice(0, 400);
  return out;
}

/**
 * Il valore dell'acquisto: quello pagato; se Stripe non lo dà (0 per prova gratuita
 * o codice sconto al 100%) il prezzo del piano, così l'evento parte comunque.
 */
function purchaseValue(session, planPrice) {
  const paid = (session.amount_total || 0) / 100;
  if (paid > 0) return { value: paid, currency: String(session.currency || 'usd').toUpperCase() };
  if (planPrice && planPrice.amount > 0) return { value: planPrice.amount, currency: String(planPrice.currency || session.currency || 'usd').toUpperCase() };
  return { value: 0, currency: String(session.currency || 'usd').toUpperCase() };
}

/** checkout.session.completed → Purchase + Subscribe. Non blocca mai il webhook. */
async function sendPurchase(session, { uid, plan, appUrl, planPrice }) {
  const md = session.metadata || {};
  if (md.meta_consent !== '1') return 0;
  const { value, currency } = purchaseValue(session, planPrice);
  const base = {
    event_time: session.created || Math.floor(Date.now() / 1000),
    event_id: session.id,
    action_source: 'website',
    event_source_url: `${appUrl}/app/welcome`,
    user_data: userData({
      email: session.customer_details?.email, uid,
      country: session.customer_details?.address?.country, zip: session.customer_details?.address?.postal_code,
      fbp: md.meta_fbp, fbc: md.meta_fbc, ip: md.meta_ip, ua: md.meta_ua,
    }),
  };
  const custom = { value, currency, content_name: `Cherry ${plan || ''}`.trim() };
  return send([
    { ...base, event_name: 'Purchase', custom_data: custom },
    { ...base, event_name: 'Subscribe', custom_data: { ...custom, predicted_ltv: value } },
  ], { live: !!session.livemode });
}

module.exports = { checkoutMetadata, sendPurchase, sendRegistration, sendInitiateCheckout, purchaseValue, enabled };
