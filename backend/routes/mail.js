// I link dentro le email (lib/offer-mail.js). Pubblici: chi clicca non è loggato,
// lo riconosce il gettone firmato nel link.
const express = require('express');
const { keys } = require('../config/keys');
const { db, FieldValue } = require('../lib/firebase');
const offer = require('../lib/offer-mail');

const router = express.Router();
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Cherry</title></head>
<body style="margin:0;background:#F4EEE4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1B1313;">
<div style="max-width:420px;margin:0 auto;padding:72px 24px;text-align:center;"><p style="font-size:22px;font-weight:800;margin:0 0 20px;">🍒 Cherry</p><h1 style="font-size:26px;margin:0 0 12px;">${title}</h1><p style="font-size:16px;line-height:1.5;color:#6F6560;margin:0 0 28px;">${body}</p><a href="${keys.web.appUrl}" style="color:#E8334A;font-weight:700;">hellocherry.app</a></div></body></html>`;

// Il bottone dell'email: apre Stripe con lo sconto già applicato.
router.get('/offer', async (req, res) => {
  const t = offer.readOfferToken(req.query.t);
  if (!t) return res.redirect(302, `${keys.web.appUrl}/app/join`);
  // Il clic si conta sempre, anche a offerta scaduta: è il numero che si guarda in dashboard.
  offer.mark(t.uid, 'click').catch(() => {});
  if (t.expired) return res.status(410).send(page('This offer has ended', 'The 48 hours are up. You can still join Cherry at the regular price.'));
  try {
    res.redirect(303, await offer.offerCheckoutUrl(t.uid));
  } catch (e) {
    console.error('[mail] offerta:', e.message);
    res.redirect(302, `${keys.web.appUrl}/app/join`);
  }
});

// L'apertura: un'immagine di un pixel in fondo all'email. È una stima: Apple Mail la scarica
// da solo anche se nessuno legge, e chi blocca le immagini non risulta.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
router.get('/o.gif', (req, res) => {
  const uid = offer.readOpenToken(req.query.t);
  if (uid) offer.mark(uid, 'open').catch(() => {});
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0' }).send(PIXEL);
});

// Disiscrizione: dal link in fondo (GET) e dal tasto del programma di posta (POST, un clic).
async function unsubscribe(req, res) {
  const uid = offer.readUnsubToken(req.query.t);
  if (!uid) return res.status(400).send(page('Link not valid', 'This unsubscribe link is not valid. Write to us and we will remove you.'));
  try {
    await db().doc(`users/${uid}`).set({ mail: { unsubscribed: true, unsubscribedAt: FieldValue.serverTimestamp() } }, { merge: true });
    res.send(page("You're unsubscribed", 'We will not send you any more emails like this one.'));
  } catch (e) {
    console.error('[mail] disiscrizione:', e.message);
    res.status(500).send(page('Something went wrong', 'Please try again in a moment.'));
  }
}
router.get('/unsubscribe', unsubscribe);
router.post('/unsubscribe', unsubscribe);

module.exports = router;
