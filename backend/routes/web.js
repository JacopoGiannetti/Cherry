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
const { detectPlatform } = require('../services/social-video');

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
router.get('/plans', async (req, res) => {
  try {
    if (plansCache.value && Date.now() - plansCache.at < 10 * 60 * 1000) return res.json(plansCache.value);
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
    res.json(plansCache.value);
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
      allow_promotion_codes: true,
      success_url: `${keys.web.appUrl}/app/welcome?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${keys.web.appUrl}/app/join?canceled=1`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[stripe] checkout:', e.message);
    res.status(e.status || 500).json({ error: 'checkout_failed' });
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
    res.json({ entitled: isEntitled(user) });
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
    }
    res.json({ received: true });
  } catch (e) {
    console.error('[stripe] webhook:', e.message);
    res.status(500).end();
  }
}

module.exports = { router, stripeWebhook };
