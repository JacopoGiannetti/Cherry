// Grocery Run: generazione batch delle ricette (§4.1) e run da ricette
// salvate. Flusso a due fasi parallele: UNA chiamata Gemini per tutte
// le ricette (quante ne servono per il budget), poi TUTTE le foto
// fal.ai in parallelo. Il deck viene pubblicato su Firestore in un
// colpo solo, completo di immagini: l'app non mostra mai card a metà.
const express = require('express');
const crypto = require('crypto');
const { db, FieldValue } = require('../lib/firebase');
const { startJob, JobError } = require('../lib/jobs');
const { consumeQuota, checkQuota } = require('../lib/rate-limit');
const { getTasteProfile, getTasteHistory } = require('../lib/profile');
const { generateJSON } = require('../services/gemini');
const { generateRecipeImage } = require('../services/fal-image');
const { buildRecipesPrompt, recipeSchema } = require('../prompts/recipes');
const { buildMergePrompt, mergeSchema } = require('../prompts/merge');
const { resolveRoot } = require('../lib/spaces');
const { keys } = require('../config/keys');
const { buildDeck } = require('../lib/catalog/deck');

const router = express.Router();

// `root` è "users/{uid}" oppure "spaces/{spaceId}": le liste seguono lo
// spazio scelto nell'app, mentre quote e profilo restano dell'utente.
function runRef(root, runId) {
  return db().doc(`${root}/runs/${runId}`);
}

/**
 * Quante ricette generare. Il prompt chiede costi medi ~$5 a porzione,
 * quindi per riempire il budget servono ~budget/(5*porzioni) keep; si
 * genera il 70% in più perché una parte verrà scartata con lo swipe.
 */
function recipeCount(budgetUsd, servings) {
  const avgRecipeCost = 5 * servings;
  const keepsToFillBudget = Math.ceil(budgetUsd / avgRecipeCost);
  return Math.min(14, Math.max(6, Math.ceil(keepsToFillBudget * 1.7)));
}

/** Aggiorna i campi di progresso della run (best-effort, mai bloccante). */
function reportProgress(root, runId, fields) {
  return runRef(root, runId)
    .set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => {});
}

/** Contesto della run letto da Firestore (non ci si fida del client). */
async function readRunContext(root, runId) {
  const [runSnap, recipesSnap] = await Promise.all([
    runRef(root, runId).get(),
    runRef(root, runId).collection('recipes').get(),
  ]);
  if (!runSnap.exists) throw new JobError('run_not_found', 'This grocery run no longer exists.');
  const run = runSnap.data();

  const keeps = [];
  const passes = [];
  const allTitles = [];
  const existing = [];
  let keptCost = 0;
  recipesSnap.forEach((doc) => {
    const r = doc.data();
    existing.push(r);
    allTitles.push(r.title);
    if (r.decision === 'kept') {
      keptCost += r.costUsd || 0;
      const mains = (r.ingredients || []).slice(0, 5).map((i) => i.name).join(', ');
      keeps.push(`${r.title} (uses: ${mains})`);
    } else if (r.decision === 'passed') {
      passes.push(r.title);
    }
  });

  return {
    run,
    keeps,
    passes,
    exclude: allTitles,
    remainingUsd: Math.max(0, (run.budgetUsd || 0) - keptCost),
    nextOrder: recipesSnap.size,
    existing,
  };
}

/** Lista di cucine scelte al Beat 1; vuota = "sorprendimi". */
function normalizeCravings(body) {
  if (Array.isArray(body.cravings)) {
    return body.cravings.filter((c) => typeof c === 'string' && c.trim() && c !== 'surprise');
  }
  // Compatibilità con la vecchia scelta singola.
  return body.craving && body.craving !== 'surprise' ? [body.craving] : [];
}

function clampServings(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return 2;
  return Math.min(8, Math.max(1, n));
}

async function generateInto(uid, root, runId, { profile, history, run, keeps, passes, exclude, remainingUsd, nextOrder, correctionChips, existing }) {
  const servings = clampServings(run.servings);
  const count = recipeCount(Math.max(remainingUsd, 20), servings);

  // Il ricettario ha solo ricette vegane, vegetariane e pescetariane:
  // chi mangia di tutto le riceve scritte apposta.
  if (keys.catalog.enabled && profile.dietaryIdentity !== 'omnivore') {
    return buildDeck({
      uid,
      root,
      runId,
      profile,
      run: {
        cravings: run.cravings && run.cravings.length
          ? run.cravings
          : (run.craving && run.craving !== 'surprise' ? String(run.craving).split(', ') : []),
        budgetUsd: run.budgetUsd || 50,
        servings,
        adventure: run.adventure || 2,
        occasion: run.occasion || 'everyday',
      },
      count,
      remaining: remainingUsd,
      nextOrder,
      existing: existing || [],
      chips: correctionChips || [],
      progress: (fields) => reportProgress(root, runId, fields),
    });
  }

  const baseOpts = {
    profile,
    history: history || [],
    cravings: run.cravings && run.cravings.length
      ? run.cravings
      : (run.craving && run.craving !== 'surprise' ? [run.craving] : []),
    budgetUsd: run.budgetUsd || 50,
    servings,
    adventure: run.adventure || 2,
    occasion: run.occasion || 'everyday',
    correctionChips: correctionChips || [],
    keeps,
    passes,
  };

  // Fase 1 — una sola chiamata Gemini per l'intero deck.
  await reportProgress(root, runId, { progressStage: 'recipes', imagesDone: 0, imagesTotal: 0 });
  const result = await generateJSON({
    prompt: buildRecipesPrompt({ ...baseOpts, remainingUsd, count, exclude }),
    schema: recipeSchema,
    label: 'recipes',
  });
  consumeQuota(uid, 'jobs', 1);

  const seen = new Set(exclude.map((t) => t.toLowerCase()));
  const recipes = (result.recipes || []).filter((r) => {
    if (!r.title || seen.has(r.title.toLowerCase())) return false;
    seen.add(r.title.toLowerCase());
    return true;
  });
  if (!recipes.length) throw new JobError('empty_batch', 'Could not cook up recipes. Try again.');

  // Fase 2 — tutte le foto in parallelo (la concorrenza la governa il
  // servizio fal). Il progresso viene scritto sulla run man mano.
  await reportProgress(root, runId, { progressStage: 'images', imagesTotal: recipes.length, imagesDone: 0 });
  const { allowed } = await checkQuota(uid, 'images');
  if (!allowed) console.warn(`[runs] quota immagini esaurita per ${uid}`);

  let imagesDone = 0;
  const urls = await Promise.all(
    recipes.map(async (recipe) => {
      const url = allowed ? await generateRecipeImage(recipe) : null;
      imagesDone += 1;
      reportProgress(root, runId, { imagesDone });
      return url;
    })
  );
  consumeQuota(uid, 'images', urls.filter(Boolean).length);

  // Pubblicazione atomica: il deck completo appare in un colpo solo.
  const batch = db().batch();
  recipes.forEach((recipe, index) => {
    batch.set(runRef(root, runId).collection('recipes').doc(), {
      ...recipe,
      order: nextOrder + index,
      decision: 'pending',
      imageUrl: urls[index],
      imageStatus: urls[index] ? 'ready' : 'failed',
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  batch.set(
    runRef(root, runId),
    { status: 'swiping', progressStage: 'done', updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  await batch.commit();
}

// POST /runs/generate  { runId, cravings: [], budgetUsd, servings }
// Il runId lo genera l'app, così può mettersi in ascolto subito.
router.post('/generate', (req, res) => {
  const { runId, budgetUsd } = req.body || {};
  if (!runId || typeof budgetUsd !== 'number') {
    return res.status(400).json({ error: 'missing_fields', details: 'runId e budgetUsd richiesti' });
  }
  const cravings = normalizeCravings(req.body || {});
  const servings = clampServings((req.body || {}).servings);
  // 1 = solo comfort, 2 = bilanciato, 3 = sperimentale.
  const adventure = Math.min(3, Math.max(1, parseInt((req.body || {}).adventure, 10) || 2));
  // La vibe della spesa: solo valori noti, tutto il resto è "everyday".
  const OCCASIONS = ['everyday', 'hosting', 'date', 'mealprep', 'quick', 'comfort'];
  const occasion = OCCASIONS.includes((req.body || {}).occasion) ? req.body.occasion : 'everyday';
  // L'app le manda anche qui: il profilo su Firestore è appena stato
  // scritto e potrebbe non essere ancora leggibile.
  const appliances = Array.isArray((req.body || {}).appliances)
    ? (req.body.appliances || []).filter((a) => typeof a === 'string' && a.trim())
    : null;

  startJob(req, res, {
    type: 'run.generate',
    payload: { runId },
    work: async ({ uid }) => {
      const root = await resolveRoot(uid, (req.body || {}).spaceId);
      const [saved, history] = await Promise.all([getTasteProfile(uid), getTasteHistory(uid)]);
      const profile = appliances && appliances.length ? { ...saved, appliances } : saved;
      await runRef(root, runId).set(
        {
          status: 'generating',
          progressStage: 'recipes',
          imagesDone: 0,
          imagesTotal: 0,
          cravings,
          craving: cravings.length ? cravings.join(', ') : 'surprise',
          budgetUsd,
          servings,
          adventure,
          occasion,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await generateInto(uid, root, runId, {
        profile,
        history,
        run: { cravings, budgetUsd, servings, adventure, occasion },
        keeps: [],
        passes: [],
        exclude: [],
        remainingUsd: budgetUsd,
        nextOrder: 0,
        correctionChips: [],
      });
    },
  });
});

// POST /runs/generate-more  { runId, correctionChips? }
// Keeps/passes/exclude vengono letti da Firestore, non dal client.
router.post('/generate-more', (req, res) => {
  const { runId, correctionChips } = req.body || {};
  if (!runId) return res.status(400).json({ error: 'missing_fields', details: 'runId richiesto' });
  startJob(req, res, {
    type: 'run.generateMore',
    payload: { runId },
    work: async ({ uid }) => {
      const root = await resolveRoot(uid, (req.body || {}).spaceId);
      const [profile, history, context] = await Promise.all([
        getTasteProfile(uid),
        getTasteHistory(uid),
        readRunContext(root, runId),
      ]);
      await generateInto(uid, root, runId, { profile, history, ...context, correctionChips: correctionChips || [] });
    },
  });
});

// POST /runs/from-recipes  { runId, recipeIds: [savedRecipeId] }
// "From my recipes": lista della spesa istantanea, zero AI (§4).
router.post('/from-recipes', (req, res) => {
  const { runId, recipeIds } = req.body || {};
  if (!runId || !Array.isArray(recipeIds) || !recipeIds.length) {
    return res.status(400).json({ error: 'missing_fields', details: 'runId e recipeIds richiesti' });
  }
  startJob(req, res, {
    type: 'run.fromRecipes',
    payload: { runId },
    work: async ({ uid }) => {
      const root = await resolveRoot(uid, (req.body || {}).spaceId);
      // Le ricette salvate restano personali anche quando la lista
      // finisce in uno spazio condiviso.
      const snaps = await Promise.all(
        recipeIds.map((id) => db().doc(`users/${uid}/savedRecipes/${id}`).get())
      );
      const recipes = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
      if (!recipes.length) throw new JobError('recipes_not_found', 'Those saved recipes were not found.');

      const totalCost = recipes.reduce((sum, r) => sum + (r.costUsd || 0), 0);

      // Copia le ricette nella run (la run possiede le sue ricette, §4)
      // già marcate kept, tenendo gli id dei nuovi documenti per la lista.
      let order = 0;
      const copies = recipes.map((recipe) => {
        const { id, ...fields } = recipe;
        const ref = runRef(root, runId).collection('recipes').doc();
        return {
          ref,
          data: {
            ...fields,
            order: order++,
            decision: 'kept',
            imageStatus: fields.imageUrl ? 'ready' : 'failed',
            createdAt: FieldValue.serverTimestamp(),
            savedRecipeId: id,
          },
        };
      });

      // La lista della spesa si costruisce QUI, deterministicamente:
      // prima era lasciata all'app, che però non aveva nessun hook su
      // questa run → l'utente si ritrovava una lista vuota.
      const merged = new Map();
      for (const copy of copies) {
        for (const ingredient of copy.data.ingredients || []) {
          const key = (ingredient.name || '').toLowerCase().trim();
          if (!key) continue;
          const existing = merged.get(key);
          if (existing) {
            if (ingredient.quantity && !existing.quantity.includes(ingredient.quantity)) {
              existing.quantity += ` + ${ingredient.quantity}`;
            }
            // Ingrediente condiviso: si compra una volta — costo max, non somma.
            existing.costUsd = Math.max(existing.costUsd, ingredient.costUsd || 0);
            existing.recipeIds.push(copy.ref.id);
          } else {
            merged.set(key, {
              id: crypto.randomUUID(),
              name: ingredient.name,
              quantity: ingredient.quantity || '',
              storeSection: ingredient.storeSection || 'other',
              costUsd: ingredient.costUsd || 0,
              checked: false,
              recipeIds: [copy.ref.id],
            });
          }
        }
      }

      const batch = db().batch();
      batch.set(runRef(root, runId), {
        status: 'shopping',
        craving: 'from_recipes',
        budgetUsd: Math.ceil(totalCost),
        groceryItems: [...merged.values()],
        progressStage: 'done',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      for (const copy of copies) batch.set(copy.ref, copy.data);
      await batch.commit();
    },
  });
});

// POST /runs/merge  { targetRunId, sourceRunId }
// Fonde la run sorgente dentro la target: ricette kept copiate, liste
// della spesa unificate dall'AI (duplicati e quasi-duplicati sommati),
// checked/recipeIds ricostruiti deterministicamente. La sorgente viene
// archiviata con riferimento alla destinazione.
router.post('/merge', (req, res) => {
  const { targetRunId, sourceRunId } = req.body || {};
  if (!targetRunId || !sourceRunId || targetRunId === sourceRunId) {
    return res.status(400).json({ error: 'missing_fields', details: 'targetRunId e sourceRunId distinti richiesti' });
  }
  startJob(req, res, {
    type: 'run.merge',
    payload: { runId: targetRunId },
    work: async ({ uid }) => {
      const root = await resolveRoot(uid, (req.body || {}).spaceId);
      const [targetSnap, sourceSnap, targetRecipes, sourceRecipes] = await Promise.all([
        runRef(root, targetRunId).get(),
        runRef(root, sourceRunId).get(),
        runRef(root, targetRunId).collection('recipes').get(),
        runRef(root, sourceRunId).collection('recipes').get(),
      ]);
      if (!targetSnap.exists || !sourceSnap.exists) {
        throw new JobError('run_not_found', 'One of the runs to merge no longer exists.');
      }
      const target = targetSnap.data();
      const source = sourceSnap.data();

      const targetItems = target.groceryItems || [];
      const sourceItems = source.groceryItems || [];

      // Lista unificata via AI (compito meccanico: thinking basso).
      let finalItems = [...targetItems, ...sourceItems];
      if (targetItems.length && sourceItems.length) {
        const merged = await generateJSON({
          prompt: buildMergePrompt(targetItems, sourceItems),
          schema: mergeSchema,
          temperature: 0.2,
          thinkingLevel: 'LOW',
          label: 'run-merge',
        });
        consumeQuota(uid, 'jobs', 1);

        const byName = new Map(
          [...targetItems, ...sourceItems].map((item) => [String(item.name).toLowerCase(), item])
        );
        const rebuilt = (merged.items || []).map((item) => {
          const origins = (item.mergedFrom || [])
            .map((name) => byName.get(String(name).toLowerCase()))
            .filter(Boolean);
          const recipeIds = [...new Set(origins.flatMap((origin) => origin.recipeIds || []))];
          const manual = origins.some((origin) => origin.manual) && recipeIds.length === 0;
          const row = {
            id: crypto.randomUUID(),
            name: item.name,
            quantity: item.quantity || '',
            storeSection: item.storeSection || 'other',
            costUsd: item.costUsd || 0,
            checked: origins.some((origin) => origin.checked),
            recipeIds,
          };
          if (manual) row.manual = true;
          return row;
        });
        if (rebuilt.length) finalItems = rebuilt;
      }

      // L'AI unisce per nome: carta igienica e pastiglie non stanno
      // nelle ricette, e una riga persa lì sparirebbe dalla lista.
      const covered = new Set(
        (finalItems || []).map((item) => String(item.name || '').toLowerCase())
      );
      for (const origin of [...targetItems, ...sourceItems]) {
        if (!origin.manual) continue;
        const key = String(origin.name || '').toLowerCase().trim();
        if (!key || covered.has(key)) continue;
        finalItems.push({
          id: origin.id || crypto.randomUUID(),
          name: origin.name,
          quantity: origin.quantity || '',
          storeSection: origin.storeSection || 'other',
          costUsd: origin.costUsd || 0,
          checked: !!origin.checked,
          recipeIds: [],
          manual: true,
        });
        covered.add(key);
      }

      const batch = db().batch();

      // Ricette kept della sorgente → in coda al deck della target.
      let order = targetRecipes.size;
      sourceRecipes.forEach((doc) => {
        const recipe = doc.data();
        if (recipe.decision !== 'kept') return;
        batch.set(runRef(root, targetRunId).collection('recipes').doc(), {
          ...recipe,
          order: order++,
        });
      });

      const cravings = [...new Set([target.craving, source.craving].filter(Boolean))];
      batch.set(
        runRef(root, targetRunId),
        {
          status: 'shopping',
          merging: false,
          groceryItems: finalItems,
          budgetUsd: (target.budgetUsd || 0) + (source.budgetUsd || 0),
          craving: cravings.join(', '),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      batch.set(
        runRef(root, sourceRunId),
        { status: 'archived', mergedInto: targetRunId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      await batch.commit();
    },
  });
});

module.exports = router;
