// API della web app (hellocherry.app): token Firebase, niente HMAC
// (in un browser un segreto non resta segreto). Le funzioni che costano
// richiedono l'abbonamento, controllato qui sul server.
const express = require('express');
const Stripe = require('stripe');
const { keys } = require('../config/keys');
const { db, auth, FieldValue } = require('../lib/firebase');
const { verifyFirebaseUser } = require('../lib/middleware');
const { checkQuota, consumeQuota } = require('../lib/rate-limit');
const { requireEntitlement, isEntitled } = require('../lib/entitlement');
const crypto = require('crypto');
const { importInto, readRecipe, recipeDoc, findEmbed } = require('../lib/web-import');
const { detectPlatform, resolve: resolveSocial } = require('../services/social-video');
const { persistImage } = require('../services/storage');
const axios = require('axios');
const metaCapi = require('../lib/meta-capi');
const journeyLog = require('../lib/journey');

const router = express.Router();
const stripe = () => {
  if (!keys.stripe.secretKey) throw Object.assign(new Error('stripe not configured'), { status: 503 });
  return new Stripe(keys.stripe.secretKey);
};

// ---------- CORS: solo le origini della web app ----------
router.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && keys.web.origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Prezzi (pubblici: servono a landing e paywall) ----------
let plansCache = { at: 0, value: null };
async function loadPlans() {
  if (plansCache.value && Date.now() - plansCache.at < 10 * 60 * 1000) return plansCache.value;
  const ids = [['yearly', keys.stripe.priceYearly], ['monthly', keys.stripe.priceMonthly]].filter(([, id]) => id);
  const plans = await Promise.all(ids.map(async ([plan, id]) => {
    const p = await stripe().prices.retrieve(id);
    return {
      plan,
      amount: p.unit_amount / 100,
      currency: p.currency,
      interval: p.recurring?.interval || null,
      trialDays: p.recurring?.trial_period_days || 0,
    };
  }));
  plansCache = { at: Date.now(), value: { plans } };
  return plansCache.value;
}
/** Il prezzo di listino del piano (fallback del valore per gli eventi Meta). */
const planPrice = (plan) => loadPlans().then((r) => r.plans.find((p) => p.plan === plan) || null).catch(() => null);

router.get('/plans', async (req, res) => {
  try {
    res.json(await loadPlans());
  } catch (e) {
    res.status(e.status || 500).json({ error: 'plans_unavailable' });
  }
});

// ---------- Anteprima nell'onboarding: la TUA ricetta prima di iscriverti ----------
// Pubblica, quindi con freni: poche per IP, un tetto al giorno. Il risultato
// resta in cache, così dopo l'iscrizione l'import vero è immediato e gratis.
const previews = new Map();
const previewHits = new Map();
let previewDay = { key: '', count: 0 };
const PREVIEW_PER_IP_PER_DAY = 3;
const PREVIEW_GLOBAL_PER_DAY = 400;

function previewAllowed(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const today = new Date().toISOString().slice(0, 10);
  if (previewDay.key !== today) { previewDay = { key: today, count: 0 }; previewHits.clear(); }
  const n = previewHits.get(ip) || 0;
  if (n >= PREVIEW_PER_IP_PER_DAY || previewDay.count >= PREVIEW_GLOBAL_PER_DAY) return false;
  previewHits.set(ip, n + 1);
  previewDay.count += 1;
  return true;
}

router.post('/preview', express.json(), (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  if (!/^https?:\/\//i.test(url) || detectPlatform(url) === 'unknown') {
    return res.status(400).json({ error: 'unsupported', message: 'Paste a TikTok or Instagram video link.' });
  }
  if (!previewAllowed(req)) {
    return res.status(429).json({ error: 'limit', message: 'Preview limit reached for today.' });
  }
  const id = crypto.randomUUID();
  const job = { status: 'running', stage: 'reading', recipe: null, error: null, at: Date.now() };
  previews.set(id, job);
  for (const [k, j] of previews) if (Date.now() - j.at > 3600_000) previews.delete(k);
  readRecipe(url, (stage) => { job.stage = stage; })
    .then(({ embed, entry, platform }) => {
      job.status = 'done';
      job.recipe = { id: 'preview', status: 'ready', sourceUrl: url, platform, embed, ...recipeDoc(entry) };
    })
    .catch((e) => {
      console.error(`[web] preview ${url}: ${e.message}`);
      job.status = 'error';
      job.error = e.userMessage || "We couldn't read that video.";
    });
  res.status(202).json({ id });
});

router.get('/preview/:id', (req, res) => {
  const job = previews.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  res.json({ status: job.status, stage: job.stage, recipe: job.recipe, error: job.error });
});

// ---------- Il percorso anonimo del sito (per la dashboard) ----------
// Pubblico (la landing non ha login); l'uid c'è solo se il token è valido.
const journeyHits = new Map();
router.post('/journey', express.json({ limit: '8kb' }), async (req, res) => {
  const ip = String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
  const minute = Math.floor(Date.now() / 60000);
  const hit = journeyHits.get(ip);
  if (hit && hit.minute === minute && hit.n >= 120) return res.status(429).end();
  journeyHits.set(ip, { minute, n: hit && hit.minute === minute ? hit.n + 1 : 1 });
  if (journeyHits.size > 5000) journeyHits.clear();
  try {
    const b = req.body || {};
    let uid = null;
    const h = req.get('authorization') || '';
    if (h.startsWith('Bearer ')) uid = await auth().verifyIdToken(h.slice(7)).then((d) => d.uid).catch(() => null);
    // Il paese lo dice Cloudflare al sito (/api/geo), e il sito lo passa qui.
    const country = /^[A-Z]{2}$/.test(String(b.country || '')) ? b.country : null;
    await journeyLog.record({ fid: b.fid, event: b.event, data: b.data, ctx: b.ctx, test: b.test === true, uid, country });
    if (uid && /^[a-z0-9]{10,40}$/.test(String(b.fid || ''))) {
      db().doc(`users/${uid}`).set({ journey: b.fid }, { merge: true }).catch(() => {});
    }
    res.status(204).end();
  } catch (e) {
    console.warn('[journey]', e.message);
    res.status(204).end();
  }
});

router.use(verifyFirebaseUser);

// ---------- Profilo e onboarding ----------
const PROFILE_FIELDS = ['firstName', 'diet', 'household', 'cookingFrequency', 'saveHabit', 'goals', 'referral', 'units'];
router.post('/profile', express.json(), async (req, res) => {
  const body = req.body || {};
  const web = {};
  for (const k of PROFILE_FIELDS) if (body[k] !== undefined) web[k] = body[k];
  const user = await auth().getUser(req.uid).catch(() => null);
  await db().doc(`users/${req.uid}`).set({
    displayName: body.firstName || user?.displayName || null,
    email: user?.email || null,
    webProfile: web,
    onboardedWebAt: body.completed ? FieldValue.serverTimestamp() : FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  res.json({ ok: true });
});

// ---------- Import di una ricetta da link ----------
router.post('/import', express.json(), requireEntitlement, async (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  if (!/^https?:\/\//i.test(url) || detectPlatform(url) === 'unknown') {
    return res.status(400).json({ error: 'unsupported', message: 'Paste a TikTok or Instagram video link.' });
  }
  if (!(await checkQuota(req.uid, 'jobs'))) {
    return res.status(429).json({ error: 'daily_limit', message: "You've imported a lot today. Try again tomorrow." });
  }
  try {
    const { id, existing } = await importInto(req.uid, url);
    if (!existing) consumeQuota(req.uid, 'jobs', 1);
    res.status(202).json({ id, existing });
  } catch (e) {
    console.error('[web] import:', e.message);
    res.status(500).json({ error: 'import_failed', message: 'Could not start the import. Try again.' });
  }
});

// ---------- Video di una ricetta salvata dall'app iOS ----------
// Quelle ricette hanno solo il link del post: per i link corti TikTok
// (vm.tiktok.com) serve seguire il rimando per sapere quale video mostrare.
router.post('/recipes/:id/embed', async (req, res) => {
  try {
    const ref = db().doc(`users/${req.uid}/savedRecipes/${req.params.id}`);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'not_found' });
    if (snap.get('embed')) return res.json({ embed: snap.get('embed') });
    const url = snap.get('sourceUrl');
    const platform = detectPlatform(url || '');
    if (!url || platform === 'unknown') return res.json({ embed: null });
    const embed = await findEmbed(url, platform);
    if (embed) await ref.update({ embed });
    res.json({ embed: embed || null });
  } catch (e) {
    console.error('[web] embed:', e.message);
    res.status(500).json({ error: 'embed_failed' });
  }
});

// Editor delle ricette: il link incollato → quale video mostrare (anche i link corti TikTok).
router.post('/embed', express.json(), async (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  const platform = detectPlatform(url);
  if (!/^https?:\/\//i.test(url) || platform === 'unknown') return res.status(400).json({ error: 'unsupported', message: 'Paste a TikTok or Instagram video link.' });
  try {
    const embed = await findEmbed(url, platform);
    if (!embed) return res.status(404).json({ error: 'no_embed', message: 'We couldn’t find the video in that link.' });
    res.json({ embed, platform });
  } catch (e) {
    res.status(502).json({ error: 'embed_failed', message: 'We couldn’t read that link. Try again.' });
  }
});

// Il file video di un reel Instagram, per il player del web (che sul web, a
// differenza della WKWebView di iOS, non può comandare l'embed). Prima prova la
// Pages Function /api/ig sul sito, gratis; per i reel che la pagina embed non
// espone si chiede al servizio dell'import. Il link del CDN dura ~1-2 giorni:
// si salva sulla ricetta, così si paga al massimo una chiamata al giorno.
router.get('/recipes/:id/video', requireEntitlement, async (req, res) => {
  try {
    const ref = db().doc(`users/${req.uid}/savedRecipes/${req.params.id}`);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'not_found' });
    const url = snap.get('sourceUrl') || '';
    if (detectPlatform(url) !== 'instagram') return res.status(400).json({ error: 'not_instagram' });
    const saved = snap.get('videoSrc');
    if (saved?.url && saved.expires - Date.now() > 2 * 3600_000 && !('fresh' in req.query)) return res.json(saved);
    if (!(await checkQuota(req.uid, 'jobs'))) return res.status(429).json({ error: 'daily_limit' });
    const { videoUrls } = await resolveSocial(url);
    const video = (videoUrls || [])[0];
    if (!video) return res.status(404).json({ error: 'no_video' });
    const oe = (video.match(/[?&]oe=([0-9A-Fa-f]+)/) || [])[1];
    const out = { url: video, expires: oe ? parseInt(oe, 16) * 1000 : Date.now() + 12 * 3600_000 };
    await ref.update({ videoSrc: out });
    res.json(out);
  } catch (e) {
    console.error('[web] video:', e.message);
    res.status(502).json({ error: 'video_failed' });
  }
});

// Riprova la copertina della ricetta dal post: per Instagram prima la pagina
// embed pubblica (gratis), altrimenti il servizio dell'import.
// Va in un file nuovo su Storage: il vecchio resterebbe in cache nel browser.
const PAGE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function freeCover(url, platform, embed) {
  try {
    // TikTok non mette la copertina nelle pagine pubbliche (e l'oEmbed non la dà più).
    if (platform === 'instagram' && embed?.shortcode) {
      const r = await axios.get(`https://www.instagram.com/p/${embed.shortcode}/embed/captioned/`, {
        timeout: 10000, headers: { 'User-Agent': PAGE_UA }, responseType: 'text',
      });
      const m = String(r.data).match(/display_url\\*":\\*"((?:[^"\\]|\\.)*?)\\*"/)
        || String(r.data).match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/);
      let u = m && m[1];
      for (let i = 0; u && u.includes('\\') && i < 3; i++) u = JSON.parse(`"${u}"`);
      return u ? u.replace(/&amp;/g, '&') : null;
    }
  } catch (e) {
    console.log(`[web] copertina gratuita non trovata (${platform}): ${e.message}`);
  }
  return null;
}

router.post('/recipes/:id/cover', requireEntitlement, async (req, res) => {
  try {
    const ref = db().doc(`users/${req.uid}/savedRecipes/${req.params.id}`);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'not_found', message: 'Recipe not found.' });
    const url = snap.get('sourceUrl') || '';
    const platform = detectPlatform(url);
    if (platform === 'unknown') return res.status(400).json({ error: 'no_source', message: 'This recipe has no video link.' });

    const code = (url.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
    const embed = snap.get('embed') || (platform === 'instagram' && code ? { shortcode: code } : null);
    let remote = await freeCover(url, platform, embed);
    if (!remote) {
      if (!(await checkQuota(req.uid, 'jobs'))) {
        return res.status(429).json({ error: 'daily_limit', message: 'Try again tomorrow.' });
      }
      remote = (await resolveSocial(url)).thumbnail || null;
    }
    if (!remote) return res.status(404).json({ error: 'no_cover', message: 'We couldn’t find a cover for this video.' });

    const kept = await persistImage(remote, `covers/${req.uid}/${req.params.id}-${Date.now()}.jpg`).catch(() => null);
    if (!kept) return res.status(502).json({ error: 'cover_failed', message: 'We couldn’t save the cover. Try again.' });
    await ref.update({ imageUrl: kept, updatedAt: FieldValue.serverTimestamp() });
    res.json({ imageUrl: kept });
  } catch (e) {
    console.error('[web] cover:', e.message);
    res.status(500).json({ error: 'cover_failed', message: 'We couldn’t get the cover. Try again.' });
  }
});

// ---------- Abbonamento (Stripe) ----------
router.post('/checkout', express.json(), async (req, res) => {
  try {
    const plan = (req.body || {}).plan === 'monthly' ? 'monthly' : 'yearly';
    const price = plan === 'monthly' ? keys.stripe.priceMonthly : keys.stripe.priceYearly;
    if (!price) return res.status(503).json({ error: 'plan_unavailable' });
    const ref = db().doc(`users/${req.uid}`);
    const user = (await ref.get()).data() || {};
    if (isEntitled(user)) return res.json({ url: `${keys.web.appUrl}/app` });

    let customer = user.stripe?.customerId;
    if (!customer) {
      const fb = await auth().getUser(req.uid).catch(() => null);
      const c = await stripe().customers.create({
        email: fb?.email || undefined,
        name: fb?.displayName || undefined,
        metadata: { uid: req.uid },
      });
      customer = c.id;
      await ref.set({ stripe: { customerId: customer } }, { merge: true });
    }
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: req.uid,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { uid: req.uid } },
      metadata: { uid: req.uid, plan, ...(/^[a-z0-9]{10,40}$/.test(String((req.body || {}).fid || '')) ? { fid: req.body.fid } : {}), ...metaCapi.checkoutMetadata((req.body || {}).meta, req) },
      allow_promotion_codes: true,
      success_url: `${keys.web.appUrl}/app/welcome?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${keys.web.appUrl}/app/join?canceled=1`,
    });
    res.json({ url: session.url });
    // Stesso event_id dell'InitiateCheckout del browser: Meta lo conta una volta.
    const meta = (req.body || {}).meta;
    if (meta?.eventId) {
      planPrice(plan).then(async (pp) => {
        const fb = await auth().getUser(req.uid).catch(() => null);
        metaCapi.sendInitiateCheckout({ meta, req, uid: req.uid, email: fb?.email, eventId: meta.eventId, value: pp?.amount || 0, currency: pp?.currency, plan });
      });
    }
  } catch (e) {
    console.error('[stripe] checkout:', e.message);
    res.status(e.status || 500).json({ error: 'checkout_failed' });
  }
});

/** CompleteRegistration dal server (stesso event_id del browser). Una volta per account. */
router.post('/meta/registration', express.json(), async (req, res) => {
  const { meta, eventId, url } = req.body || {};
  if (!meta || meta.consent !== true || typeof eventId !== 'string') return res.json({ sent: false });
  try {
    const ref = db().doc(`users/${req.uid}`);
    const first = await db().runTransaction(async (t) => {
      const u = (await t.get(ref)).data() || {};
      if (u.meta?.registrationSent) return false;
      t.set(ref, { meta: { registrationSent: Date.now() } }, { merge: true });
      return true;
    });
    if (!first) return res.json({ sent: false, already: true });
    const fb = await auth().getUser(req.uid).catch(() => null);
    const n = await metaCapi.sendRegistration({ meta, req, uid: req.uid, email: fb?.email, eventId, url });
    res.json({ sent: n > 0 });
  } catch (e) {
    console.error('[meta] registrazione:', e.message);
    res.json({ sent: false });
  }
});

router.post('/portal', async (req, res) => {
  try {
    const user = (await db().doc(`users/${req.uid}`).get()).data() || {};
    if (!user.stripe?.customerId) return res.status(404).json({ error: 'no_customer' });
    const session = await stripe().billingPortal.sessions.create({
      customer: user.stripe.customerId,
      return_url: `${keys.web.appUrl}/app/settings`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[stripe] portal:', e.message);
    res.status(500).json({ error: 'portal_failed' });
  }
});

// ---------- Cancellazione account: prima si ferma l'abbonamento ----------
router.post('/account/delete', async (req, res, next) => {
  try {
    const user = (await db().doc(`users/${req.uid}`).get()).data() || {};
    const sub = user.stripe?.subscriptionId;
    if (sub && keys.stripe.secretKey && user.stripe?.status !== 'canceled') {
      await stripe().subscriptions.cancel(sub);
    }
  } catch (e) {
    console.error('[stripe] abbonamento non cancellato:', e.message);
    return res.status(500).json({ error: 'cancel_failed', message: 'Could not cancel your membership. Try again or contact support.' });
  }
  next();
});
router.use('/account', require('./account'));

/** Dopo il pagamento: se il webhook non è ancora arrivato, si legge da Stripe. */
router.post('/checkout/confirm', express.json(), async (req, res) => {
  try {
    const sessionId = String((req.body || {}).session || '');
    if (!sessionId) return res.status(400).json({ error: 'missing_session' });
    const s = await stripe().checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    if (s.client_reference_id !== req.uid) return res.status(403).json({ error: 'not_yours' });
    if (s.subscription && typeof s.subscription === 'object') await writeSubscription(req.uid, s.subscription);
    const user = (await db().doc(`users/${req.uid}`).get()).data() || {};
    // Il valore serve all'evento Purchase del browser (stesso id della Conversions API).
    const { value, currency } = metaCapi.purchaseValue(s, await planPrice(s.metadata?.plan));
    res.json({ entitled: isEntitled(user), value, currency, plan: s.metadata?.plan || null });
  } catch (e) {
    console.error('[stripe] confirm:', e.message);
    res.status(500).json({ error: 'confirm_failed' });
  }
});

async function writeSubscription(uid, sub) {
  const item = sub.items?.data?.[0];
  await db().doc(`users/${uid}`).set({
    stripe: {
      customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
      subscriptionId: sub.id,
      status: sub.status,
      priceId: item?.price?.id || null,
      interval: item?.price?.recurring?.interval || null,
      currentPeriodEnd: (item?.current_period_end || sub.current_period_end || 0) * 1000 || null,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      updatedAt: Date.now(),
    },
  }, { merge: true });
}

/** payments/{id}: entrate di Cherry per la dashboard (primo pagamento, rinnovi, rimborsi). */
async function recordPayment(id, p) {
  await db().doc(`payments/${id}`).set({ ...p, recordedAt: Date.now() }, { merge: true }).catch((e) => console.warn('[stripe] payments:', e.message));
}

// ---------- Webhook Stripe (montato fuori da questo router, senza token) ----------
async function stripeWebhook(req, res) {
  let event;
  try {
    if (!keys.stripe.webhookSecret) return res.status(503).end();
    event = stripe().webhooks.constructEvent(req.rawBody, req.get('stripe-signature'), keys.stripe.webhookSecret);
  } catch (e) {
    console.warn('[stripe] webhook rifiutato:', e.message);
    return res.status(400).send('bad signature');
  }
  try {
    const obj = event.data.object;
    if (event.type.startsWith('customer.subscription.')) {
      const uid = obj.metadata?.uid;
      if (uid) await writeSubscription(uid, obj);
    } else if (event.type === 'checkout.session.completed' && obj.subscription && obj.client_reference_id) {
      const sub = await stripe().subscriptions.retrieve(obj.subscription);
      await writeSubscription(obj.client_reference_id, sub);
      planPrice(obj.metadata?.plan).then((pp) => metaCapi.sendPurchase(obj, { uid: obj.client_reference_id, plan: obj.metadata?.plan, appUrl: keys.web.appUrl, planPrice: pp }));
      // Per la dashboard: il primo pagamento e il percorso che l'ha portato.
      await recordPayment(obj.id, {
        uid: obj.client_reference_id, fid: obj.metadata?.fid || null, plan: obj.metadata?.plan || null, kind: 'first',
        amount: (obj.amount_total || 0) / 100, currency: obj.currency, live: !!obj.livemode, ts: (obj.created || 0) * 1000 || Date.now(),
        source: obj.metadata?.meta_fbc ? 'meta_click' : null,
      });
      if (obj.metadata?.fid) journeyLog.markPaid(obj.metadata.fid, { plan: obj.metadata?.plan, value: (obj.amount_total || 0) / 100, currency: obj.currency, uid: obj.client_reference_id, live: !!obj.livemode });
    } else if (event.type === 'invoice.paid' && obj.billing_reason === 'subscription_cycle') {
      // I rinnovi (se l'endpoint del webhook su Stripe li manda).
      const uid = obj.subscription_details?.metadata?.uid || obj.parent?.subscription_details?.metadata?.uid || null;
      await recordPayment(obj.id, { uid, plan: null, kind: 'renewal', amount: (obj.amount_paid || 0) / 100, currency: obj.currency, live: !!obj.livemode, ts: (obj.created || 0) * 1000 || Date.now() });
    } else if (event.type === 'charge.refunded') {
      await recordPayment(`${obj.id}_refund`, { uid: obj.metadata?.uid || null, kind: 'refund', amount: -((obj.amount_refunded || 0) / 100), currency: obj.currency, live: !!obj.livemode, ts: Date.now() });
    }
    res.json({ received: true });
  } catch (e) {
    console.error('[stripe] webhook:', e.message);
    res.status(500).end();
  }
}

module.exports = { router, stripeWebhook };
