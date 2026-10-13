// Swap engine (§6): import da link social / screenshot / testo,
// ledger personalizzato, riscrittura finale con foto.
const express = require('express');
const crypto = require('crypto');
const { db, FieldValue } = require('../lib/firebase');
const { startJob, JobError } = require('../lib/jobs');
const { consumeQuota, checkQuota } = require('../lib/rate-limit');
const { getTasteProfile } = require('../lib/profile');
const { getCached, setCached, bumpCacheHit } = require('../lib/cache');
const { generateJSON, imagePart, videoPart } = require('../services/gemini');
const { downloadImage } = require('../services/storage');
const { downloadVideo, detectPlatform } = require('../services/social-video');
const { fetchWebRecipe } = require('../services/web-recipe');
const { generateRecipeImage } = require('../services/fal-image');
const { previewId, fetchPreview, writePreview, markPreviewFailed } = require('../lib/inbox-preview');
const { recordSocial } = require('../lib/usage');
const {
  buildExtractionPrompt, extractionSchema,
  buildLedgerPrompt, ledgerSchema,
  buildFinalizePrompt, finalizeSchema,
  GOALS, defaultGoal,
} = require('../prompts/swap');

const router = express.Router();

function normalizeUrl(url) {
  try {
    const u = new URL(url.trim());
    u.search = '';
    u.hash = '';
    return u.toString().toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

async function extractFromVideo(uid, url, profile) {
  const video = await downloadVideo(url);
  const extraction = await generateJSON({
    prompt: buildExtractionPrompt({ sourceType: 'video', caption: video.caption, profile }),
    schema: extractionSchema,
    parts: [videoPart(video.buffer, video.mimeType)],
    temperature: 0.2,
    label: 'swap-extract-video',
    thinkingLevel: 'LOW',
  });
  consumeQuota(uid, 'jobs', 1);
  if (!extraction.found || !extraction.recipe) {
    throw new JobError('no_recipe', "We couldn't find a recipe in that post.");
  }
  return {
    recipe: extraction.recipe,
    thumbnail: video.thumbnail || null,
    platform: video.platform,
    caption: video.caption || null,
  };
}

async function extractFromWebPage(uid, url, profile) {
  const page = await fetchWebRecipe(url);
  const extraction = await generateJSON({
    prompt: buildExtractionPrompt({ sourceType: 'text', text: page.text, profile }),
    schema: extractionSchema,
    temperature: 0.2,
    label: 'swap-extract-web',
    thinkingLevel: 'LOW',
  });
  consumeQuota(uid, 'jobs', 1);
  if (!extraction.found || !extraction.recipe) {
    throw new JobError('no_recipe', "We couldn't find a recipe on that page.");
  }
  return {
    recipe: extraction.recipe,
    thumbnail: page.thumbnail || null,
    platform: 'web',
    caption: page.title || null,
  };
}

/**
 * Estrazione della ricetta originale. Per i link usa la cache globale,
 * partizionata per lingua: la trascrizione è la stessa per tutti, ma il
 * testo esce nella lingua scelta da chi importa, e riusare quella di un
 * altro utente gli restituirebbe una ricetta che non sa leggere.
 */
async function extractOriginal(uid, source, profile) {
  const language = profile?.language || 'en';

  if (source.type === 'link') {
    const cacheKey = crypto
      .createHash('sha256')
      .update(`${normalizeUrl(source.url)}::${language}`)
      .digest('hex');
    const cached = await getCached('sourceRecipes', cacheKey);
    if (cached) {
      bumpCacheHit('sourceRecipes', cacheKey);
      return cached;
    }

    // Social: si guarda il video. Qualsiasi altro sito: si legge la
    // pagina, perché le ricette vivono anche fuori da TikTok.
    const entry =
      detectPlatform(source.url) === 'unknown'
        ? await extractFromWebPage(uid, source.url, profile)
        : await extractFromVideo(uid, source.url, profile);

    await setCached('sourceRecipes', cacheKey, entry);
    return entry;
  }

  if (source.type === 'screenshot') {
    const image = await downloadImage(source.storagePath);
    const extraction = await generateJSON({
      prompt: buildExtractionPrompt({ sourceType: 'screenshot', profile }),
      schema: extractionSchema,
      parts: [imagePart(image.buffer, image.mimeType)],
      temperature: 0.2,
      label: 'swap-extract-screenshot',
      thinkingLevel: 'LOW',
    });
    consumeQuota(uid, 'jobs', 1);
    if (!extraction.found || !extraction.recipe) {
      throw new JobError('no_recipe', "We couldn't find a recipe in that screenshot.");
    }
    return { recipe: extraction.recipe, thumbnail: null, platform: 'screenshot', caption: null };
  }

  // testo incollato
  const extraction = await generateJSON({
    prompt: buildExtractionPrompt({ sourceType: 'text', text: source.text, profile }),
    schema: extractionSchema,
    temperature: 0.2,
    label: 'swap-extract-text',
    thinkingLevel: 'LOW',
  });
  consumeQuota(uid, 'jobs', 1);
  if (!extraction.found || !extraction.recipe) {
    throw new JobError('no_recipe', "We couldn't find a recipe in that text.");
  }
  return { recipe: extraction.recipe, thumbnail: null, platform: 'text', caption: null };
}

// POST /swap/preview  { url }
// Anteprima leggera per l'inbox: titolo e foto dal link, in background.
router.post('/preview', (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'missing_fields', details: 'url richiesto' });
  }
  startJob(req, res, {
    type: 'swap.preview',
    payload: { url },
    work: async ({ uid }) => {
      const id = previewId(url);
      const ref = db().doc(`users/${uid}/inboxPreviews/${id}`);

      // Un'anteprima già pronta non si tocca: rifare lo scrape a ogni
      // avvio dell'app rimetteva la riga su "loading" e, quando il
      // social risponde peggio della prima volta, sostituiva titolo e
      // foto buoni con i fallback. È il "dopo un po' spariscono".
      const snap = await ref.get();
      if (snap.exists && snap.get('status') === 'ready' && snap.get('title')) return;

      recordSocial(uid, { linksPreviewed: 1 });

      await ref.set({
        url,
        status: 'loading',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      try {
        const preview = await fetchPreview(url);
        await writePreview(uid, url, preview);
      } catch (e) {
        const message = e.userMessage || e.message || 'Preview failed';
        await markPreviewFailed(uid, url, message);
        throw e;
      }
    },
  });
});

// POST /swap/import  { swapId, source: { type: 'link'|'screenshot'|'text', url?, storagePath?, text? } }
router.post('/import', (req, res) => {
  const { swapId, source } = req.body || {};
  const validSource =
    source &&
    ((source.type === 'link' && source.url) ||
      (source.type === 'screenshot' && source.storagePath) ||
      (source.type === 'text' && source.text));
  if (!swapId || !validSource) {
    return res.status(400).json({ error: 'missing_fields', details: 'swapId e source valida richiesti' });
  }
  startJob(req, res, {
    type: 'swap.import',
    payload: { swapId },
    work: async ({ uid }) => {
      const swapRef = db().doc(`users/${uid}/swaps/${swapId}`);

      // Import idempotente: per i link l'app deriva lo swapId dall'URL,
      // quindi il prewarm in background e il tap su Veganize puntano
      // allo stesso documento. Se il lavoro è già stato fatto non si
      // rifà — e soprattutto la set() qui sotto non azzera un ledger
      // già pronto.
      const existing = await swapRef.get();
      const doneStatuses = ['extracted', 'ledger_ready', 'generating_photo', 'finalized'];
      if (existing.exists && doneStatuses.includes(existing.get('status'))) return;

      if (source.type === 'link') recordSocial(uid, { linksImported: 1 });
      else if (source.type === 'screenshot') recordSocial(uid, { screenshots: 1 });
      else if (source.type === 'text') recordSocial(uid, { pastedText: 1 });

      await swapRef.set({
        status: 'extracting',
        source: { type: source.type, url: source.url || null, platform: null },
        createdAt: FieldValue.serverTimestamp(),
      });

      // Il profilo serve già in estrazione: decide la lingua del titolo
      // e degli step, che è quello che l'utente vede se salva "as is"
      // senza passare dal ledger.
      const profile = await getTasteProfile(uid);
      const extracted = await extractOriginal(uid, source, profile);
      // Chi mangia di tutto sceglie dopo se e come trasformarla: qui ci
      // si ferma alla ricetta originale, pronta da salvare così com'è.
      const goal = defaultGoal(profile);
      await swapRef.set(
        {
          status: goal ? 'building_ledger' : 'extracted',
          goal,
          original: extracted.recipe,
          source: { type: source.type, url: source.url || null, platform: extracted.platform, thumbnail: extracted.thumbnail },
        },
        { merge: true }
      );
      if (goal) await buildLedger(uid, swapRef, profile, extracted.recipe, goal);
    },
  });
});

/**
 * Ledger personalizzato sul profilo e sull'obiettivo (mai cacheable tra
 * utenti diversi). Temperatura più alta del resto: qui serve creatività
 * da chef, non trascrizione meccanica.
 */
async function buildLedger(uid, swapRef, profile, recipe, goal) {
  const ledger = await generateJSON({
    prompt: buildLedgerPrompt(profile, recipe, goal),
    schema: ledgerSchema,
    temperature: 0.6,
    label: 'swap-ledger',
  });
  consumeQuota(uid, 'jobs', 1);
  await swapRef.set(
    { status: 'ledger_ready', goal, ledger: ledger.lines || [], completedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// POST /swap/ledger  { swapId, goal }
// Cambia obiettivo su una ricetta già letta: vegana, più proteine, più leggera...
router.post('/ledger', (req, res) => {
  const { swapId, goal } = req.body || {};
  if (!swapId || !GOALS.includes(goal)) {
    return res.status(400).json({ error: 'missing_fields', details: 'swapId e goal valido richiesti' });
  }
  startJob(req, res, {
    type: 'swap.ledger',
    payload: { swapId, goal },
    work: async ({ uid }) => {
      const swapRef = db().doc(`users/${uid}/swaps/${swapId}`);
      const snap = await swapRef.get();
      if (!snap.exists || !snap.get('original')) {
        throw new JobError('swap_not_found', 'This swap session expired. Import the recipe again.');
      }
      if (snap.get('goal') === goal && snap.get('status') === 'ledger_ready') return;
      await swapRef.set({ status: 'building_ledger', goal, ledger: FieldValue.delete() }, { merge: true });
      const profile = await getTasteProfile(uid);
      try {
        await buildLedger(uid, swapRef, profile, snap.get('original'), goal);
      } catch (e) {
        // La ricetta letta resta: si torna alla scelta, non a un caricamento infinito.
        await swapRef.set({ status: 'extracted', goal: null }, { merge: true }).catch(() => {});
        throw e;
      }
    },
  });
});

// POST /swap/finalize  { swapId, chosen: [{ originalName, substituteName, quantity }] }
// "Make it mine": riscrive la ricetta con le scelte dell'utente e genera la foto.
router.post('/finalize', (req, res) => {
  const { swapId, chosen } = req.body || {};
  if (!swapId || !Array.isArray(chosen)) {
    return res.status(400).json({ error: 'missing_fields', details: 'swapId e chosen richiesti' });
  }
  startJob(req, res, {
    type: 'swap.finalize',
    payload: { swapId },
    work: async ({ uid }) => {
      const swapRef = db().doc(`users/${uid}/swaps/${swapId}`);
      const snap = await swapRef.get();
      if (!snap.exists || !snap.get('original')) {
        throw new JobError('swap_not_found', 'This swap session expired. Import the recipe again.');
      }

      const profile = await getTasteProfile(uid);
      const goal = snap.get('goal') || defaultGoal(profile);
      const result = await generateJSON({
        prompt: buildFinalizePrompt(profile, snap.get('original'), chosen, goal),
        schema: finalizeSchema,
        temperature: 0.5,
        label: 'swap-finalize',
      });
      consumeQuota(uid, 'jobs', 1);

      const recipe = { ...result.recipe, imageUrl: null };
      await swapRef.set({ status: 'generating_photo', finalRecipe: recipe }, { merge: true });

      const { allowed } = await checkQuota(uid, 'images');
      if (allowed) {
        const imageUrl = await generateRecipeImage(result.recipe);
        if (imageUrl) {
          consumeQuota(uid, 'images', 1);
          await swapRef.set(
            { status: 'finalized', finalRecipe: { ...result.recipe, imageUrl } },
            { merge: true }
          );
          return;
        }
      }

      // Foto non disponibile: si mostra la ricetta senza ripiegare
      // sulla thumbnail del video originale.
      await swapRef.set({ status: 'finalized', finalRecipe: recipe }, { merge: true });
    },
  });
});

module.exports = router;
