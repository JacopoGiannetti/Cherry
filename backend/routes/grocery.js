// Il paracadute in corsia (§4.2): sostituti immediati per un ingrediente
// introvabile, poi riscrittura degli step delle ricette coinvolte.
const express = require('express');
const { db, FieldValue } = require('../lib/firebase');
const { startJob, JobError } = require('../lib/jobs');
const { consumeQuota } = require('../lib/rate-limit');
const { getTasteProfile } = require('../lib/profile');
const { getCached, setCached, bumpCacheHit } = require('../lib/cache');
const { generateJSON } = require('../services/gemini');
const { buildSubstitutePrompt, substituteSchema } = require('../prompts/substitute');
const { resolveRoot } = require('../lib/spaces');

const router = express.Router();

// `root` è "users/{uid}" o "spaces/{spaceId}": la lista da correggere
// può essere quella condivisa.
async function affectedKeptRecipes(root, runId, ingredientName) {
  const snap = await db().collection(`${root}/runs/${runId}/recipes`).where('decision', '==', 'kept').get();
  const needle = ingredientName.toLowerCase();
  const affected = [];
  snap.forEach((doc) => {
    const r = doc.data();
    const uses = (r.ingredients || []).some((i) => (i.name || '').toLowerCase().includes(needle) || needle.includes((i.name || '').toLowerCase()));
    if (uses) {
      affected.push({
        recipeId: doc.id,
        title: r.title,
        ingredients: r.ingredients,
        steps: r.steps,
      });
    }
  });
  return affected;
}

// POST /grocery/substitute  { runId, ingredientName }
// Scrive users/{uid}/runs/{runId}/parachute/{jobId} con substitutes[] e
// rewrittenRecipes[] (step già riscritti con il primo sostituto).
router.post('/substitute', (req, res) => {
  const { runId, ingredientName } = req.body || {};
  if (!runId || !ingredientName) {
    return res.status(400).json({ error: 'missing_fields', details: 'runId e ingredientName richiesti' });
  }
  startJob(req, res, {
    type: 'grocery.substitute',
    payload: { runId, ingredientName },
    work: async ({ uid, jobId }) => {
      const root = await resolveRoot(uid, (req.body || {}).spaceId);
      const profile = await getTasteProfile(uid);
      const affected = await affectedKeptRecipes(root, runId, ingredientName);
      if (!affected.length) throw new JobError('not_in_run', 'That ingredient is not in this run.');

      // Cache globale per (ingrediente, identità dietetica): il tempeh
      // introvabile è introvabile per tutti.
      const cacheKey = { ingredient: ingredientName.toLowerCase().trim(), diet: profile.dietaryIdentity };
      let substitutes = await getCached('substitutions', cacheKey);
      let rewrittenRecipes = null;

      if (substitutes) {
        bumpCacheHit('substitutions', cacheKey);
        // Gli step riscritti dipendono dalle ricette della run: si generano comunque.
        const result = await generateJSON({
          prompt: buildSubstitutePrompt(profile, ingredientName, affected),
          schema: substituteSchema,
          temperature: 0.4,
          label: 'substitute-rewrite',
        });
        consumeQuota(uid, 'jobs', 1);
        rewrittenRecipes = result.rewrittenRecipes;
      } else {
        const result = await generateJSON({
          prompt: buildSubstitutePrompt(profile, ingredientName, affected),
          schema: substituteSchema,
          temperature: 0.4,
          label: 'substitute',
        });
        consumeQuota(uid, 'jobs', 1);
        substitutes = result.substitutes;
        rewrittenRecipes = result.rewrittenRecipes;
        await setCached('substitutions', cacheKey, substitutes);
      }

      await db().doc(`${root}/runs/${runId}/parachute/${jobId}`).set({
        ingredientName,
        substitutes,
        rewrittenRecipes: rewrittenRecipes || [],
        affectedRecipeIds: affected.map((a) => a.recipeId),
        createdAt: FieldValue.serverTimestamp(),
      });
    },
  });
});

// POST /grocery/substitute/apply  { runId, parachuteId, substituteIndex }
// L'utente ha accettato: aggiorna ingredienti+step delle ricette coinvolte
// e sostituisce la voce nella grocery list della run.
router.post('/substitute/apply', (req, res) => {
  const { runId, parachuteId, substituteIndex } = req.body || {};
  if (!runId || !parachuteId || typeof substituteIndex !== 'number') {
    return res.status(400).json({ error: 'missing_fields', details: 'runId, parachuteId e substituteIndex richiesti' });
  }
  startJob(req, res, {
    type: 'grocery.substituteApply',
    payload: { runId, parachuteId },
    work: async ({ uid }) => {
      const root = await resolveRoot(uid, (req.body || {}).spaceId);
      const paraSnap = await db().doc(`${root}/runs/${runId}/parachute/${parachuteId}`).get();
      if (!paraSnap.exists) throw new JobError('parachute_not_found', 'Substitution options expired.');
      const para = paraSnap.data();
      const chosen = (para.substitutes || [])[substituteIndex];
      if (!chosen) throw new JobError('bad_substitute', 'That substitute is not available.');

      const profile = await getTasteProfile(uid);
      const affected = await affectedKeptRecipes(root, runId, para.ingredientName);

      // Se l'utente ha scelto il primo sostituto gli step sono già pronti,
      // altrimenti si riscrivono per la scelta effettiva.
      let rewritten = substituteIndex === 0 ? para.rewrittenRecipes : null;
      if (!rewritten || !rewritten.length) {
        const result = await generateJSON({
          prompt: buildSubstitutePrompt(profile, `${para.ingredientName} (user chose to replace it with: ${chosen.name})`, affected),
          schema: substituteSchema,
          temperature: 0.4,
          label: 'substitute-apply',
        });
        consumeQuota(uid, 'jobs', 1);
        rewritten = result.rewrittenRecipes;
      }

      // Aggiorna ingredienti e step di ogni ricetta coinvolta.
      const needle = para.ingredientName.toLowerCase();
      for (const recipe of affected) {
        const newSteps = (rewritten.find((r) => r.recipeId === recipe.recipeId) || {}).steps;
        const newIngredients = recipe.ingredients.map((i) =>
          (i.name || '').toLowerCase().includes(needle) || needle.includes((i.name || '').toLowerCase())
            ? { name: chosen.name, quantity: chosen.quantity, storeSection: chosen.storeSection, costUsd: chosen.costUsd }
            : i
        );
        await db().doc(`${root}/runs/${runId}/recipes/${recipe.recipeId}`).set(
          { ingredients: newIngredients, ...(newSteps ? { steps: newSteps } : {}), substitutionApplied: { from: para.ingredientName, to: chosen.name } },
          { merge: true }
        );
      }

      // Sostituisce la voce nella grocery list della run (se già costruita).
      const runSnap = await db().doc(`${root}/runs/${runId}`).get();
      const items = runSnap.get('groceryItems');
      if (Array.isArray(items)) {
        const updated = items.map((item) =>
          (item.name || '').toLowerCase().includes(needle)
            ? { ...item, name: chosen.name, quantity: chosen.quantity, storeSection: chosen.storeSection, costUsd: chosen.costUsd, substitutedFrom: para.ingredientName }
            : item
        );
        await db().doc(`${root}/runs/${runId}`).set({ groceryItems: updated }, { merge: true });
      }
    },
  });
});

module.exports = router;
