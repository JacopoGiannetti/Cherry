// Ricettario: le ricette condivise, la classifica, i parametri e le
// ricette di partenza da approvare. Legge e scrive le stesse collezioni
// del backend, con le credenziali della dashboard.
const express = require('express');
const { FieldValue } = require('firebase-admin/firestore');
const { firestore, bucket } = require('../firestore');
const deps = require('../../lib/catalog/deps');

deps.configure({ db: firestore, bucket });

const { COLLECTIONS } = deps;
const atlas = require('../../lib/catalog/atlas');
const { getParams, invalidateParams, DEFAULTS, merge } = require('../../lib/catalog/params');
const { score, poolMean, buildContext, pickBriefs } = require('../../lib/catalog/select');
const { writeRecipes } = require('../../lib/catalog/generate');
const { critique, persistImage } = require('../../lib/catalog/promote');
const store = require('../../lib/catalog/store');
const { generateRecipeImage } = require('../../services/fal-image');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

const guard = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((error) => {
    const status = error.status || 500;
    if (status >= 500) console.error('[catalog]', error);
    res.status(status).json({ error: error.message || 'errore' });
  });
};

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const col = () => firestore().collection(COLLECTIONS.catalog);

function millis(ts) {
  return ts && ts.toMillis ? ts.toMillis() : null;
}

/** La riga leggera della tabella: niente traduzioni, niente passaggi. */
function row(doc, params) {
  const e = doc.data();
  const stats = e.stats || {};
  const views = stats.views || 0;
  return {
    id: doc.id,
    status: e.status,
    origin: e.origin,
    title: (e.recipe || {}).title,
    oneLiner: (e.recipe || {}).oneLiner,
    dishKey: e.dishKey,
    dishName: e.dishName || (atlas.dish(e.dishKey) || {}).name || e.dishKey,
    tiles: e.tiles || [],
    cuisine: e.cuisine,
    diet: e.diet,
    format: e.format,
    protein: e.protein,
    familiarity: e.familiarity,
    costUsd: (e.recipe || {}).costUsd,
    cookMinutes: (e.recipe || {}).cookMinutes,
    imageUrl: e.imageUrl,
    stats: {
      views,
      keeps: stats.keeps || 0,
      passes: stats.passes || 0,
      stars: stats.stars || 0,
      reuses: stats.reuses || 0,
      groups: stats.groups || {},
    },
    keepRate: views ? (stats.keeps || 0) / views : null,
    score: score(e, params, null),
    critic: e.critic || null,
    languages: Object.keys(e.translations || {}),
    createdAt: millis(e.createdAt),
    promotedAt: millis(e.promotedAt),
    retiredBy: e.retiredBy || null,
    retiredReason: e.retiredReason || null,
  };
}

// GET /api/catalog/list — tutte le ricette tranne le scadute
router.get('/list', guard(async (req, res) => {
  const params = await getParams();
  const snap = await col().get();
  const ranked = snap.docs.filter((d) => d.get('status') === 'ranked').map((d) => d.data());
  const mean = poolMean(ranked);
  const rows = snap.docs.filter((d) => d.get('status') !== 'expired').map((d) => row(d, params));
  res.json({ rows, mean, at: Date.now() });
}));

// GET /api/catalog/stats — conteggi, copertura dell'atlante, esiti
router.get('/stats', guard(async (req, res) => {
  const [catalog, exposures] = await Promise.all([
    col().select('status', 'diet', 'dishKey', 'tiles').get(),
    firestore().collection(COLLECTIONS.exposures).select('status', 'outcome', 'source', 'userDiet').get(),
  ]);
  const byStatus = {};
  const rankedByTile = {};
  const dishesByTile = {};
  for (const tile of atlas.TILES) {
    rankedByTile[tile] = 0;
    dishesByTile[tile] = atlas.dishesForTiles([tile]).length;
  }
  catalog.forEach((doc) => {
    const { status, tiles } = doc.data();
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (status === 'ranked') for (const t of tiles || []) if (t in rankedByTile) rankedByTile[t] += 1;
  });
  const outcomes = {};
  const bySource = {};
  let open = 0;
  exposures.forEach((doc) => {
    const e = doc.data();
    if (e.status === 'open') open += 1;
    else outcomes[e.outcome] = (outcomes[e.outcome] || 0) + 1;
    const s = (bySource[e.source] = bySource[e.source] || { served: 0, kept: 0, passed: 0 });
    s.served += 1;
    if (e.outcome === 'kept') s.kept += 1;
    if (e.outcome === 'passed') s.passed += 1;
  });
  res.json({ byStatus, rankedByTile, dishesByTile, exposures: { total: exposures.size, open, outcomes, bySource }, atlasDishes: atlas.allDishes().length });
}));

// GET /api/catalog/item/:id — la ricetta intera e a chi è stata servita
router.get('/item/:id', guard(async (req, res) => {
  const snap = await col().doc(req.params.id).get();
  if (!snap.exists) throw fail(404, 'ricetta non trovata');
  const params = await getParams();
  const exposures = await firestore().collection(COLLECTIONS.exposures).where('catalogId', '==', snap.id).get();
  const served = exposures.docs
    .map((d) => {
      const e = d.data();
      return { id: d.id, userDiet: e.userDiet, source: e.source, status: e.status, outcome: e.outcome || null, lang: e.lang, createdAt: millis(e.createdAt) };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 100);
  const data = snap.data();
  res.json({
    id: snap.id,
    ...data,
    createdAt: millis(data.createdAt),
    promotedAt: millis(data.promotedAt),
    updatedAt: millis(data.updatedAt),
    firstLikeAt: millis(data.firstLikeAt),
    dish: atlas.dish(data.dishKey),
    score: score(data, params, null),
    served,
  });
}));

// POST /api/catalog/item/:id/status { status } — approva, ritira, rimette
router.post('/item/:id/status', guard(async (req, res) => {
  const next = String((req.body || {}).status || '');
  if (!['ranked', 'retired', 'rejected'].includes(next)) throw fail(400, 'stato non valido');
  const ref = col().doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) throw fail(404, 'ricetta non trovata');
  const patch = { status: next, updatedAt: FieldValue.serverTimestamp(), reviewedBy: 'dashboard' };
  // Rimessa a mano: la regola di uscita automatica non la tocca più.
  if (next === 'ranked' && snap.get('status') === 'retired') patch.keptByHand = true;
  if (next === 'ranked') {
    const imageUrl = await persistImage(snap.id, snap.get('imageUrl'));
    if (imageUrl && imageUrl !== snap.get('imageUrl')) {
      patch.imageUrl = imageUrl;
      patch.imageUrls = FieldValue.arrayUnion(imageUrl);
    }
    if (!snap.get('promotedAt')) patch.promotedAt = FieldValue.serverTimestamp();
  }
  await ref.update(patch);
  res.json({ ok: true });
}));

// GET/PUT /api/catalog/params — i parametri, con i default accanto
router.get('/params', guard(async (req, res) => {
  const snap = await firestore().collection(COLLECTIONS.config).doc('params').get();
  res.json({ defaults: DEFAULTS, saved: snap.exists ? snap.data() : {}, effective: merge(DEFAULTS, snap.exists ? snap.data() : {}) });
}));

router.put('/params', guard(async (req, res) => {
  const body = req.body || {};
  const clean = {};
  const num = (v, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw fail(400, `valore fuori scala: ${v}`);
    return n;
  };
  if (body.bonus) clean.bonus = { star: num(body.bonus.star, 0, 5), reuse: num(body.bonus.reuse, 0, 5) };
  if (body.quotas) {
    clean.quotas = {};
    for (const diet of ['vegan', 'vegetarian', 'pescatarian', 'omnivore']) {
      const q = body.quotas[diet];
      if (!q) continue;
      const out = {};
      for (const [k, v] of Object.entries(q)) if (['vegan', 'vegetarian', 'pescatarian', 'meat'].includes(k)) out[k] = num(v, 0, 1);
      const sum = Object.values(out).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 0.01) throw fail(400, `le quote ${diet} devono fare 100%`);
      clean.quotas[diet] = out;
    }
  }
  const scalars = { confidence: [0, 4], groupMinViews: [0, 1000], youngSlots: [0, 5], youngViews: [0, 1000], minAiPerDeck: [0, 14], quotaShift: [0, 0.5], seenDishDays: [0, 365], openDays: [1, 60], candidateDays: [1, 365], dishMaxRetired: [0, 50] };
  for (const [k, [lo, hi]] of Object.entries(scalars)) if (k in body) clean[k] = num(body[k], lo, hi);
  if (body.retire) {
    clean.retire = {
      earlyViews: num(body.retire.earlyViews, 1, 1000),
      earlyMaxKeeps: num(body.retire.earlyMaxKeeps, 0, 1000),
      lateViews: num(body.retire.lateViews, 1, 1000),
      lateMinKeepRate: num(body.retire.lateMinKeepRate, 0, 1),
    };
  }
  if ('ingredientSharing' in body) clean.ingredientSharing = Boolean(body.ingredientSharing);
  await firestore().collection(COLLECTIONS.config).doc('params').set(clean, { merge: true });
  invalidateParams();
  res.json({ ok: true });
}));

// POST /api/catalog/seed { tile, mix: { vegan, vegetarian, pescatarian, meat } }
// Ricette di partenza per una cucina: piatti famosi dell'atlante, scritti,
// passati dal critico, con la foto. Restano "da approvare" finché non le
// approvi tu.
router.post('/seed', guard(async (req, res) => {
  const { tile, mix = { vegan: 3, vegetarian: 1, pescatarian: 1 } } = req.body || {};
  if (!atlas.TILES.includes(tile)) throw fail(400, 'cucina non valida');
  const params = await getParams();
  const coverage = await store.coverageByDish();

  const slots = [];
  for (const diet of ['vegan', 'vegetarian', 'pescatarian', 'meat']) {
    for (let i = 0; i < Math.min(5, Number(mix[diet]) || 0); i++) slots.push({ slot: slots.length, diet });
  }
  if (!slots.length) throw fail(400, 'nessuna ricetta richiesta');

  const ctx = buildContext({
    userDiet: 'omnivore',
    tiles: [tile],
    appliances: [],
    rules: [],
    history: [],
    runDishKeys: [],
    servings: 2,
    locale: { rate: 1, lang: 'en', units: 'metric' },
    budget: 100,
    remaining: 100,
    adventure: 1,
    occasion: 'everyday',
    chips: [],
  }, params);
  // Per partire, i piatti più conosciuti; i meno noti solo se per una
  // dieta i famosi non bastano.
  const all = atlas.dishesForTiles([tile]);
  const tracker = { ok: (i) => !ctx.blocked.has(i.dishKey), add: (i) => ctx.blocked.add(i.dishKey), neediestTile: () => null };
  const briefs = pickBriefs(slots, all.filter((d) => d.familiarity === 1), ctx, coverage, tracker);
  const left = slots.filter((s) => !briefs.some((b) => b.slot === s.slot));
  briefs.push(...pickBriefs(left, all, ctx, coverage, tracker));
  if (!briefs.length) throw fail(409, 'nessun piatto disponibile per questa cucina');

  const { entries, rejected } = await writeRecipes(briefs, {
    basket: [],
    profile: { appliances: [] },
    ctx,
    sharing: false,
    uid: null,
    label: 'catalog-seed',
  });

  const results = await Promise.all(entries.map(async ({ entry }) => {
    const ref = col().doc();
    const full = { ...entry, id: ref.id };
    let review;
    try {
      review = await critique(full);
    } catch (e) {
      review = { verdict: 'reject', score: 0, issues: [`critico non raggiungibile: ${e.message}`], recipe: entry.recipe };
    }
    const ok = review.verdict !== 'reject';
    const imageUrl = ok
      ? await generateRecipeImage({ title: review.recipe.title, imagePrompt: review.recipe.imagePrompt, cuisine: entry.cuisine })
      : null;
    const data = {
      ...entry,
      origin: 'seed',
      status: ok ? 'seed_review' : 'rejected',
      recipe: review.recipe,
      critic: { verdict: review.verdict, score: review.score, issues: review.issues, at: new Date().toISOString() },
      imageUrl,
      imageUrls: imageUrl ? [imageUrl] : [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(data);
    return { id: ref.id, title: review.recipe.title, verdict: review.verdict, issues: review.issues };
  }));
  store.invalidatePool();
  res.json({ results, notWritten: rejected });
}));

module.exports = router;
