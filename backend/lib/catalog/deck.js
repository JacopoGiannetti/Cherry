// Il mazzo dal ricettario: prima le ricette in classifica che vanno bene
// per questa persona, l'IA solo per i posti che restano vuoti. Pubblica
// nella run gli stessi documenti che l'app legge già, in un colpo solo.
const { FieldValue } = require('firebase-admin/firestore');
const { db } = require('./deps');
const { getParams } = require('./params');
const atlas = require('./atlas');
const store = require('./store');
const { buildExclusionRules, userDietOf } = require('./ingredients');
const { localeOf, localCost, renderForApp } = require('./render');
const { buildContext, pickFromPool, pickBriefs, deckOrder } = require('./select');
const { writeRecipes } = require('./generate');
const { generateRecipeImage } = require('../../services/fal-image');
const { consumeQuota, checkQuota } = require('../rate-limit');
const { JobError } = require('../jobs');

/**
 * @param {object} o
 * @param {string} o.uid
 * @param {string} o.root
 * @param {string} o.runId
 * @param {object} o.profile
 * @param {object} o.run          { cravings, budgetUsd, servings, adventure, occasion }
 * @param {number} o.count
 * @param {number} o.remaining
 * @param {number} o.nextOrder
 * @param {Array}  o.existing     documenti ricetta già nella run
 * @param {Array}  o.chips
 * @param {Function} o.progress   (fields) => scrive i campi di progresso
 */
async function buildDeck(o) {
  const { uid, root, runId, profile, run, count, remaining, nextOrder, existing = [], chips = [], progress } = o;
  const params = await getParams();
  const userDiet = userDietOf(profile);
  const locale = localeOf(profile, params);
  const servings = run.servings;

  const [pool, history, translatedTerms, coverage, retiredDishes] = await Promise.all([
    store.rankedPool(),
    store.userHistory(uid),
    store.translateExclusions(profile.exclusions || []),
    store.coverageByDish(),
    store.retiredByDish(),
  ]);
  const rules = buildExclusionRules(profile.exclusions || [], translatedTerms);

  const runDishKeys = existing.map((r) => r.dishKey).filter(Boolean);
  const runPassedFormats = existing
    .filter((r) => r.decision === 'passed' && r.dishKey)
    .map((r) => (atlas.dish(r.dishKey) || {}).format)
    .filter(Boolean);

  const ctx = buildContext({
    userDiet,
    tiles: run.cravings || [],
    appliances: profile.appliances || [],
    rules,
    history,
    runDishKeys,
    runPassedFormats,
    servings,
    locale,
    budget: run.budgetUsd,
    remaining,
    adventure: run.adventure || 2,
    occasion: run.occasion || 'everyday',
    chips,
    retiredDishes,
  }, params);

  const { picks, missing, tracker, skipped } = pickFromPool(pool, ctx, params, count);
  const briefs = pickBriefs(missing, atlas.dishesForTiles(ctx.tiles), ctx, coverage, tracker);
  console.log(`[catalog] run ${runId}: ${picks.length} dalla classifica, ${briefs.length} nuove (scartate: ${JSON.stringify(skipped)})`);

  // Le ricette nuove, scritte sapendo cosa c'è già nel mazzo.
  let written = [];
  if (briefs.length) {
    await progress({ progressStage: 'recipes', imagesDone: 0, imagesTotal: 0 });
    const kept = existing.filter((r) => r.decision === 'kept');
    const basket = [
      ...kept.map((r) => ({ title: r.title, ingredients: (r.ingredients || []).map((i) => i.name) })),
      ...picks.map((p) => ({ title: p.entry.recipe.title, ingredients: p.entry.recipe.ingredients.map((i) => i.name) })),
    ];
    const sharing = typeof profile.ingredientSharing === 'boolean' ? profile.ingredientSharing : params.ingredientSharing;
    const result = await writeRecipes(briefs, { basket, profile, ctx, sharing, uid });
    consumeQuota(uid, 'jobs', result.calls);
    written = result.entries;
  }
  if (!picks.length && !written.length) {
    throw new JobError('empty_batch', 'Could not cook up recipes. Try again.');
  }

  // Foto delle nuove e traduzioni di tutte, in parallelo.
  const fresh = written.map(({ entry }) => {
    const ref = store.newCatalogRef();
    return { ...entry, id: ref.id, ref, saved: false };
  });
  await progress({ progressStage: 'images', imagesTotal: fresh.length, imagesDone: 0 });
  const { allowed } = fresh.length ? await checkQuota(uid, 'images') : { allowed: false };
  let imagesDone = 0;
  const ranked = picks.map((p) => ({ ...p.entry, saved: true }));
  await Promise.all([
    ...fresh.map(async (entry) => {
      entry.imageUrl = allowed
        ? await generateRecipeImage({ title: entry.recipe.title, imagePrompt: entry.recipe.imagePrompt, cuisine: entry.cuisine })
        : null;
      if (entry.imageUrl) entry.imageUrls = [entry.imageUrl];
      imagesDone += 1;
      progress({ imagesDone });
    }),
    store.ensureTranslations([...ranked, ...fresh], locale.lang),
  ]);
  consumeQuota(uid, 'images', fresh.filter((e) => e.imageUrl).length);

  // Ordine del mazzo e documenti per l'app.
  const items = deckOrder([
    ...picks.map((p, i) => ({ entry: ranked[i], source: 'ranked', young: p.young, score: p.score })),
    ...fresh.map((entry) => ({ entry, source: 'ai', young: true, score: 0 })),
  ]);

  const batch = db().batch();
  for (const entry of fresh) {
    const { ref, saved, id, ...data } = entry;
    batch.set(ref, { ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  }
  const runRef = db().doc(`${root}/runs/${runId}`);
  items.forEach((item, index) => {
    const doc = renderForApp(item.entry, { servings, locale, source: item.source });
    const recipeRef = runRef.collection('recipes').doc();
    batch.set(recipeRef, {
      ...doc,
      order: nextOrder + index,
      decision: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(store.exposureRef(recipeRef.id), {
      catalogId: item.entry.id,
      uid,
      root,
      runId,
      dishKey: item.entry.dishKey,
      diet: item.entry.diet,
      format: item.entry.format,
      userDiet,
      source: item.source,
      young: !!item.young,
      imageUrl: doc.imageUrl,
      costLocal: localCost(item.entry.recipe, servings, locale.rate),
      lang: locale.lang,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  batch.set(runRef, { status: 'swiping', progressStage: 'done', catalog: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
}

module.exports = { buildDeck };
