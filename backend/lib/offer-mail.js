// L'email con l'offerta a chi ha fatto l'account e non ha pagato.
//
// Un'ora dopo la registrazione (users/{uid}.onboardedWebAt) parte UNA email: l'annuale
// a $24.99 invece del listino, per sempre finché resta abbonato; l'offerta vale 48 ore. Il bottone porta a GET /mail/offer?t=…, che
// apre Stripe Checkout con lo sconto già messo: niente login, niente codice da copiare.
//
// Regole:
//  - solo a chi ha visitato dagli Stati Uniti (journeys.country): lì basta il link per
//    disiscriversi e l'indirizzo postale (CAN-SPAM); in Europa servirebbe un consenso
//    esplicito che oggi alla registrazione non chiediamo;
//  - mai a chi ha già pagato, a chi si è disiscritto, o due volte alla stessa persona;
//  - MODE decide chi la riceve: 'off' nessuno, 'test' solo gli account segnati a mano
//    (users/{uid}.mail.test = true, per vederla nella posta vera), 'on' tutti quelli sopra.
const crypto = require('crypto');
const Stripe = require('stripe');
const { keys } = require('../config/keys');
const { db, FieldValue } = require('./firebase');
const { isEntitled } = require('./entitlement');

const MODE = 'test';              // 'off' | 'test' | 'on'
const POSTAL = 'Cherry · Via Bernardino Lanino 5, 20144 Milano, Italy'; // obbligatorio in fondo (CAN-SPAM)
const REPLY_TO = 'support@hellocherry.app';
const COUNTRIES = new Set(['US']);
const DELAY_MS = 60 * 60 * 1000;  // quanto dopo la registrazione
const WINDOW_MS = 24 * 60 * 60 * 1000; // chi si è registrato più di un giorno fa non la riceve più
const VALID_MS = 48 * 60 * 60 * 1000;  // quanto vale l'offerta
const OFFER_CENTS = 2499;
const COUPON_ID = 'cherry-yearly-2499';
const OFFER = 'yearly-2499';

// Aperture e clic si leggono in dashboard (Cherry → Email offerta): a ogni invio ripartono da zero.
const FRESH = { offerOpenedAt: FieldValue.delete(), offerOpens: FieldValue.delete(), offerClickedAt: FieldValue.delete(), offerClicks: FieldValue.delete(), offerCheckoutAt: FieldValue.delete() };

/** Un'apertura (il pixel in fondo) o un clic sul bottone: la prima volta l'ora, poi solo il conto. */
async function mark(uid, what) {
  const at = what === 'open' ? 'offerOpenedAt' : 'offerClickedAt';
  const n = what === 'open' ? 'offerOpens' : 'offerClicks';
  const ref = db().doc(`users/${uid}`);
  const cur = (await ref.get()).data();
  if (!cur) return;
  await ref.set({ mail: { [n]: FieldValue.increment(1), ...(cur.mail?.[at] ? {} : { [at]: FieldValue.serverTimestamp() }) } }, { merge: true });
}

const stripe = () => new Stripe(keys.stripe.secretKey);
const ready = () => Boolean(keys.mail.resendKey && keys.stripe.secretKey && keys.stripe.priceYearly && keys.hmacSecret);
const sign = (text) => crypto.createHmac('sha256', keys.hmacSecret).update(text).digest('base64url').slice(0, 32);
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Il link dell'offerta vale per quell'account, fino a quella scadenza. */
const offerToken = (uid, exp) => `${uid}.${exp}.${sign(`offer:${uid}:${exp}`)}`;
function readOfferToken(token) {
  const [uid, exp, sig] = String(token || '').split('.');
  if (!uid || !/^\d+$/.test(exp || '') || !sig || !keys.hmacSecret) return null;
  if (!same(sig, sign(`offer:${uid}:${exp}`))) return null;
  return { uid, exp: Number(exp), expired: Date.now() > Number(exp) };
}
const openToken = (uid) => `${uid}.${sign(`open:${uid}`)}`;
function readOpenToken(token) {
  const [uid, sig] = String(token || '').split('.');
  if (!uid || !sig || !keys.hmacSecret || !same(sig, sign(`open:${uid}`))) return null;
  return uid;
}
const unsubToken = (uid) => `${uid}.${sign(`unsub:${uid}`)}`;
function readUnsubToken(token) {
  const [uid, sig] = String(token || '').split('.');
  if (!uid || !sig || !keys.hmacSecret || !same(sig, sign(`unsub:${uid}`))) return null;
  return uid;
}

let yearly = { at: 0, value: null };
async function yearlyPrice() {
  if (yearly.value && Date.now() - yearly.at < 10 * 60 * 1000) return yearly.value;
  const p = await stripe().prices.retrieve(keys.stripe.priceYearly);
  yearly = { at: Date.now(), value: { cents: p.unit_amount, currency: p.currency } };
  return yearly.value;
}

/** Lo sconto su Stripe: si crea da solo la prima volta ($24.99 l'anno, a ogni rinnovo, finché resta abbonato). */
async function ensureCoupon() {
  const price = await yearlyPrice();
  const off = price.cents - OFFER_CENTS;
  if (off <= 0) throw new Error('il listino annuale è già sotto il prezzo dell’offerta');
  try {
    const c = await stripe().coupons.retrieve(COUPON_ID);
    if (c.amount_off !== off || c.currency !== price.currency) throw new Error(`lo sconto ${COUPON_ID} su Stripe non porta più l’annuale a $24.99: va ricreato`);
    return COUPON_ID;
  } catch (e) {
    if (e.code !== 'resource_missing') throw e;
  }
  await stripe().coupons.create({ id: COUPON_ID, name: 'Welcome offer: $24.99 a year', amount_off: off, currency: price.currency, duration: 'forever' });
  return COUPON_ID;
}

/** Apre il checkout dell'offerta per quell'account. Ritorna l'indirizzo dove mandarlo. */
async function offerCheckoutUrl(uid) {
  const ref = db().doc(`users/${uid}`);
  const user = (await ref.get()).data();
  if (!user) return `${keys.web.appUrl}/app/start`;
  if (isEntitled(user)) return `${keys.web.appUrl}/app`;
  const coupon = await ensureCoupon();
  let customer = user.stripe?.customerId;
  if (!customer) {
    const c = await stripe().customers.create({ email: user.email || undefined, name: user.displayName || undefined, metadata: { uid } });
    customer = c.id;
    await ref.set({ stripe: { customerId: customer } }, { merge: true });
  }
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: uid,
    line_items: [{ price: keys.stripe.priceYearly, quantity: 1 }],
    discounts: [{ coupon }],
    subscription_data: { metadata: { uid, offer: OFFER } },
    metadata: { uid, plan: 'yearly', offer: OFFER },
    success_url: `${keys.web.appUrl}/app/welcome?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${keys.web.appUrl}/app/join?canceled=1`,
  });
  ref.set({ mail: { offerCheckoutAt: FieldValue.serverTimestamp() } }, { merge: true }).catch(() => {});
  return session.url;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (cents) => `$${(cents / 100).toFixed(2)}`;

/** L'email: testo semplice e HTML. Usata anche dall'anteprima.
 *  È un buono, non un avviso: titolo, il regalo, la pillola con lo sconto, il prezzo di prima
 *  barrato sopra quello nuovo, un bottone solo. Tabelle e stili in linea, niente immagini:
 *  si legge uguale anche dove il programma di posta le blocca. */
function render({ offerUrl, unsubUrl, openUrl, listCents, postal }) {
  const list = usd(listCents), offer = usd(OFFER_CENTS);
  const save = Math.round((listCents - OFFER_CENTS) / 100);
  const pct = Math.round(((listCents - OFFER_CENTS) / listCents) * 100);
  const subject = `🎁 Your one-time offer: Cherry for ${offer}/year`;
  const text = [
    'Your one-time offer!', '',
    `Here's a ${pct}% OFF discount: Cherry for ${offer}/year instead of ${list}/year.`,
    `You save $${save} every year, for as long as you stay. This offer ends in 48 hours.`, '',
    `Claim my limited time offer: ${offerUrl}`, '',
    `Billed yearly at ${offer} per year. Cancel anytime.`, '',
    'You are getting this because you created a Cherry account.', `Unsubscribe: ${unsubUrl}`, postal,
  ].join('\n');
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"></head><body style="margin:0;background:#FFFFFF;">
<div style="display:none;max-height:0;overflow:hidden;">${pct}% off: ${offer}/year instead of ${list}/year. Ends in 48 hours.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;"><tr><td align="center" style="padding:36px 20px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;font-family:${font};color:#111111;">

<tr><td align="center" style="font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-.02em;padding:0 0 26px;">Your One-time Offer!</td></tr>

<tr><td style="padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDECEE;border-radius:28px;"><tr><td align="center" style="padding:26px 20px 28px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" width="84" height="84" style="width:84px;height:84px;background:#FFFFFF;border-radius:50%;font-size:40px;line-height:84px;">🎁</td></tr></table>
    <p style="margin:20px 0 18px;font-size:19px;line-height:1.5;white-space:nowrap;">Here's a <span style="display:inline-block;background:#111111;color:#FFFFFF;font-weight:800;font-size:19px;padding:4px 13px;border-radius:999px;">${pct}% OFF</span> Discount 🙌</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:24px;"><tr><td align="center" style="padding:20px 12px 22px;">
      <p style="margin:0;font-size:22px;color:#77706D;text-decoration:line-through;">${list}/year</p>
      <p style="margin:2px 0 0;font-size:40px;line-height:1.15;font-weight:800;letter-spacing:-.02em;color:#111111;">${offer}/year</p>
    </td></tr></table>
    <p style="margin:16px 0 0;font-size:15.5px;line-height:1.45;color:#6F6560;">Cherry at the lowest price ever.<br>Yours every year, as long as you stay.</p>
  </td></tr></table>
</td></tr>

<tr><td align="center" style="padding:28px 0 16px;font-size:17px;font-weight:600;">✓&nbsp; Special promotion · ends in 48 hours</td></tr>
<tr><td align="center">
  <a href="${esc(offerUrl)}" style="display:block;background:#111111;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:19px;text-align:center;padding:20px 18px;border-radius:18px;">Claim my limited time offer</a>
</td></tr>
<tr><td align="center" style="padding:14px 8px 0;font-size:14.5px;color:#6F6560;">billed yearly at ${offer} per year · cancel anytime</td></tr>

<tr><td align="center" style="padding:34px 8px 0;font-size:12px;line-height:1.6;color:#9A928E;">You are getting this because you created a Cherry account.<br><a href="${esc(unsubUrl)}" style="color:#9A928E;">Unsubscribe</a><br>${esc(postal)}</td></tr>
</table>
</td></tr></table>${openUrl ? `<img src="${esc(openUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;">` : ''}</body></html>`;
  return { subject, text, html };
}

async function sendOne(uid, user) {
  const exp = Date.now() + VALID_MS;
  const price = await yearlyPrice();
  const unsubUrl = `${keys.mail.apiUrl}/mail/unsubscribe?t=${unsubToken(uid)}`;
  const mail = render({
    firstName: String(user.displayName || '').trim().split(' ')[0],
    offerUrl: `${keys.mail.apiUrl}/mail/offer?t=${offerToken(uid, exp)}`,
    unsubUrl, openUrl: `${keys.mail.apiUrl}/mail/o.gif?t=${openToken(uid)}`, listCents: price.cents, postal: POSTAL,
  });
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${keys.mail.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: keys.mail.from, to: [user.email], reply_to: REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const id = await r.json().then((j) => j.id).catch(() => null);
  if (id) db().doc(`users/${uid}`).set({ mail: { resendId: id } }, { merge: true }).catch(() => {});
  return exp;
}

/** Un giro: chi si è registrato da più di un'ora (e meno di un giorno) e non ha pagato. */
async function tick() {
  if (MODE === 'off' || !POSTAL || !ready()) return { sent: 0, off: true };
  const tested = await tickTest();
  if (MODE !== 'on') return { sent: 0, tested };
  const now = Date.now();
  const snap = await db().collection('users')
    .where('onboardedWebAt', '>=', new Date(now - WINDOW_MS))
    .where('onboardedWebAt', '<=', new Date(now - DELAY_MS))
    .get();
  let sent = 0;
  for (const doc of snap.docs) {
    const uid = doc.id;
    try {
      const seen = doc.data();
      if (!seen.email || isEntitled(seen) || seen.mail?.offerAt || seen.mail?.unsubscribed) continue;
      const j = await db().collection('journeys').where('uid', '==', uid).limit(1).get();
      const journey = j.docs[0]?.data();
      if (!journey || journey.test || !COUNTRIES.has(String(journey.country || '').toUpperCase())) continue;
      // Si prenota prima di spedire: due istanze o due giri non mandano due email.
      const mine = await db().runTransaction(async (t) => {
        const cur = (await t.get(doc.ref)).data() || {};
        if (cur.mail?.offerAt || cur.mail?.unsubscribed || isEntitled(cur)) return false;
        t.set(doc.ref, { mail: { offerAt: FieldValue.serverTimestamp(), ...FRESH } }, { merge: true });
        return true;
      });
      if (!mine) continue;
      const exp = await sendOne(uid, seen);
      await doc.ref.set({ mail: { offerExpiresAt: new Date(exp), offer: OFFER } }, { merge: true });
      sent += 1;
    } catch (e) {
      console.error(`[offer-mail] ${uid}:`, e.message);
      doc.ref.set({ mail: { offerError: String(e.message).slice(0, 200) } }, { merge: true }).catch(() => {});
    }
  }
  if (sent) console.log(`[offer-mail] spedite ${sent}`);
  return { sent, tested };
}

/** Le prove: a chi ha mail.test = true parte subito, qualunque cosa abbia fatto; poi il segno si toglie. */
async function tickTest() {
  const snap = await db().collection('users').where('mail.test', '==', true).get();
  let sent = 0;
  for (const doc of snap.docs) {
    try {
      const user = doc.data();
      await doc.ref.set({ mail: { test: false, ...FRESH } }, { merge: true });
      if (!user.email) continue;
      await sendOne(doc.id, user);
      await doc.ref.set({ mail: { testSentAt: FieldValue.serverTimestamp() } }, { merge: true });
      sent += 1;
    } catch (e) {
      console.error(`[offer-mail] prova ${doc.id}:`, e.message);
      doc.ref.set({ mail: { testError: String(e.message).slice(0, 200) } }, { merge: true }).catch(() => {});
    }
  }
  if (sent) console.log(`[offer-mail] prove spedite ${sent}`);
  return sent;
}

function start() {
  if (MODE === 'off' || !POSTAL) { console.log('[offer-mail] spenta (MODE/POSTAL in lib/offer-mail.js)'); return; }
  console.log(`[offer-mail] modalità ${MODE}`);
  if (!ready()) { console.warn('[offer-mail] manca una chiave (Resend, Stripe, HMAC_SECRET): non parte'); return; }
  const run = () => tick().catch((e) => console.error('[offer-mail] giro fallito:', e.message));
  setTimeout(run, 30 * 1000);
  setInterval(run, (MODE === 'test' ? 1 : 5) * 60 * 1000).unref();
}

module.exports = { start, tick, render, mark, offerToken, readOfferToken, openToken, readOpenToken, unsubToken, readUnsubToken, offerCheckoutUrl, OFFER_CENTS };
