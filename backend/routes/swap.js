// Swap engine (§6): import da link social / screenshot / testo,
// ledger personalizzato, riscrittura finale con foto.
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { db, FieldValue } = require('../lib/firebase');
const { startJob, JobError } = require('../lib/jobs');
const { consumeQuota, checkQuota } = require('../lib/rate-limit');
const { getTasteProfile } = require('../lib/profile');
const { getCached, setCached, patchCached, bumpCacheHit } = require('../lib/cache');
const { generateJSON, imagePart, videoPart } = require('../services/gemini');
const { downloadImage, stageRemoteVideo, isPersisted } = require('../services/storage');
const { cleanSegments, remapSegments, withoutSegments } = require('../lib/recipe-segments');
const { downloadVideo, detectPlatform, resolve, SocialVideoError } = require('../services/social-video');
const { fetchWebRecipe } = require('../services/web-recipe');
const { generateRecipeImage } = require('../services/fal-image');
const { previewId, fetchPreview, writePreview, markPreviewFailed, keepThumbnail } = require('../lib/inbox-preview');
const { recordSocial } = require('../lib/usage');
const {
  buildExtractionPrompt, extractionSchema, videoExtractionSchema,
  buildSegmentsPrompt, segmentsSchema,
  buildLedgerPrompt, ledgerSchema,
  buildFinalizePrompt, finalizeSchema, finalizeWithSegmentsSchema,
  buildCoverPrompt, coverSchema,
  GOALS, defaultGoal,
} = require('../prompts/swap');

const router = express.Router();

// Come `staleAfter` in SharedInboxStore: oltre, un ledger mai arrivato
// è un job morto e l'import può ripartire.
const LEDGER_STALE_MS = 3 * 60 * 1000;

/** Estrazioni dei link in corso, per chiave di cache. */
const extracting = new Map();

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

/**
 * Il video intero di un post fatto guardare a Gemini da Storage (niente
 * limite dei 18MB) e cancellato appena risponde: copie dei video dei
 * creator non se ne tengono. null se nessuna versione si carica.
 */
async function watchVideo(url, videoUrls, request) {
  for (const [i, remote] of (videoUrls || []).entries()) {
    let staged;
    try {
      staged = await stageRemoteVideo(remote);
    } catch (e) {
      console.log(`[swap.video] ${url}: video NON caricato (${i + 1}/${videoUrls.length}): ${e.message}`);
      continue;
    }
    try {
      return await generateJSON({ ...request, parts: [{ fileData: { fileUri: staged.gsUri, mimeType: 'video/mp4' } }] });
    } finally {
      await staged.discard();
      console.log(`[swap.video] ${url}: video temporaneo cancellato`);
    }
  }
  return null;
}

/**
 * Una chiamata sola: Gemini guarda il video intero e legge ricetta e
 * spezzoni insieme. Lancia se il video non si carica o Gemini fallisce:
 * chi chiama ripiega sulla lettura di sempre. "Nessuna ricetta" invece è
 * definitivo.
 */
async function extractWatchingVideo(uid, url, profile) {
  const t0 = Date.now();
  const post = await resolve(url);
  if (!post.videoUrls?.length) throw new Error('nessuna versione video');
  const extraction = await watchVideo(url, post.videoUrls, {
    prompt: buildExtractionPrompt({ sourceType: 'video', caption: post.caption, profile, segments: true }),
    schema: videoExtractionSchema,
    temperature: 0.2,
    label: 'swap-extract-video-full',
    thinkingLevel: 'LOW',
  });
  if (!extraction) throw new Error('video intero non caricato');
  const t2 = Date.now();
  consumeQuota(uid, 'jobs', 1);
  if (!extraction.found || !extraction.recipe) {
    throw new JobError('no_recipe', "We couldn't find a recipe in that post.");
  }
  const recipe = withoutSegments(extraction.recipe);
  const segments = cleanSegments(extraction.recipe.segments, recipe);
  if (segments) recipe.segments = segments;
  console.log(`[swap.video] ${url}: Gemini ha guardato il VIDEO intero, ${recipe.steps?.length || 0} step,`
    + ` spezzoni grezzi ${extraction.recipe.segments?.length || 0}, validi ${segments?.length || 0}`
    + ` | tempo ${((t2 - t0) / 1000).toFixed(1)}s`);
  return {
    recipe,
    thumbnail: (await keepThumbnail(url, post.thumbnail)) || post.thumbnail || null,
    platform: detectPlatform(url),
    caption: post.caption || null,
  };
}

async function extractFromVideo(uid, url, profile) {
  try {
    return await extractWatchingVideo(uid, url, profile);
  } catch (e) {
    if (e instanceof JobError) throw e;
    console.log(`[swap.video] ${url}: lettura del video intero non riuscita, si ripiega: ${e.message}`);
  }
  const t0 = Date.now();
  let video;
  try {
    video = await downloadVideo(url);
  } catch (e) {
    if (!(e instanceof SocialVideoError) || !e.caption) throw e;
    return extractFromPost(uid, url, profile, e);
  }
  const extraction = await generateJSON({
    prompt: buildExtractionPrompt({ sourceType: 'video', caption: video.caption, profile, segments: video.hasPicture }),
    schema: video.hasPicture ? videoExtractionSchema : extractionSchema,
    parts: [videoPart(video.buffer, video.mimeType)],
    temperature: 0.2,
    label: 'swap-extract-video',
    thinkingLevel: 'LOW',
  });
  consumeQuota(uid, 'jobs', 1);
  if (!extraction.found || !extraction.recipe) {
    throw new JobError('no_recipe', "We couldn't find a recipe in that post.");
  }
  const recipe = withoutSegments(extraction.recipe);
  const segments = video.hasPicture ? cleanSegments(extraction.recipe.segments, recipe) : null;
  if (segments) recipe.segments = segments;
  console.log(`[swap.video] ${url}: Gemini ha letto ${video.hasPicture ? 'il VIDEO' : 'solo l’AUDIO'}`
    + ` (${(video.buffer.length / 1024 / 1024).toFixed(1)}MB), ${recipe.steps?.length || 0} step,`
    + ` spezzoni grezzi ${extraction.recipe.segments?.length || 0}, validi ${segments?.length || 0}`
    + ` | tempo ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return {
    recipe,
    thumbnail: (await keepThumbnail(url, video.thumbnail)) || video.thumbnail || null,
    platform: video.platform,
    caption: video.caption || null,
  };
}

/**
 * Il video non si scarica (troppo lungo, CDN che rifiuta, post di sole
 * foto) ma il post si è letto: didascalia e copertina bastano spesso,
 * perché su Instagram la ricetta sta quasi sempre scritta lì sotto.
 */
async function extractFromPost(uid, url, profile, failure) {
  const parts = [];
  if (failure.thumbnail) {
    const cover = await axios.get(failure.thumbnail, { responseType: 'arraybuffer', timeout: 15000 }).catch(() => null);
    const type = String(cover?.headers?.['content-type'] || '').split(';')[0];
    if (cover && type.startsWith('image/')) parts.push(imagePart(Buffer.from(cover.data), type));
  }
  const extraction = await generateJSON({
    prompt: buildExtractionPrompt({ sourceType: 'post', caption: failure.caption, profile }),
    schema: extractionSchema,
    parts,
    temperature: 0.2,
    label: 'swap-extract-caption',
    thinkingLevel: 'LOW',
  });
  consumeQuota(uid, 'jobs', 1);
  if (!extraction.found || !extraction.recipe) {
    // L'errore vero resta quello del video: la didascalia era un tentativo in più.
    throw failure;
  }
  return {
    recipe: extraction.recipe,
    thumbnail: (await keepThumbnail(url, failure.thumbnail)) || failure.thumbnail || null,
    platform: detectPlatform(url),
    caption: failure.caption,
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
    thumbnail: (await keepThumbnail(url, page.thumbnail)) || page.thumbnail || null,
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
      return withLastingThumbnail(source.url, cached, cacheKey);
    }

    // Stesso link già in lettura (anteprima, import in sottofondo, import
    // all'apertura arrivano insieme): si aspetta quella, invece di
    // rifare la chiamata al social e la lettura con Gemini.
    const running = extracting.get(cacheKey);
    if (running) return running;

    // Social: si guarda il video. Qualsiasi altro sito: si legge la
    // pagina, perché le ricette vivono anche fuori da TikTok.
    const work = (async () => {
      const entry =
        detectPlatform(source.url) === 'unknown'
          ? await extractFromWebPage(uid, source.url, profile)
          : await extractFromVideo(uid, source.url, profile);
      await setCached('sourceRecipes', cacheKey, entry);
      return entry;
    })();
    extracting.set(cacheKey, work);
    const clear = () => extracting.delete(cacheKey);
    work.then(clear, clear);
    return work;
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

/**
 * Le voci in cache scritte prima della copia su Storage tengono il link
 * originale della copertina, che può essere scaduto: si copia ora, o se
 * ne chiede uno nuovo al social, e la cache si corregge per tutti.
 */
async function withLastingThumbnail(url, entry, cacheKey) {
  if (!entry.thumbnail || isPersisted(entry.thumbnail)) return entry;
  let thumbnail = await keepThumbnail(url, entry.thumbnail);
  if (!thumbnail && detectPlatform(url) !== 'unknown') {
    const fresh = await resolve(url).catch(() => null);
    if (fresh?.thumbnail) thumbnail = await keepThumbnail(url, fresh.thumbnail);
  }
  if (!thumbnail) return entry;
  await patchCached('sourceRecipes', cacheKey, { thumbnail });
  return { ...entry, thumbnail };
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
      const status = existing.exists ? existing.get('status') : null;
      if (doneStatuses.includes(status)) return;
      // Ledger partito da poco: è il prewarm ancora al lavoro, e la
      // ricetta letta è già lì da mostrare. Ripartire la cancellerebbe.
      const startedAt = existing.exists ? existing.get('createdAt') : null;
      if (status === 'building_ledger' && existing.get('original') && startedAt
        && Date.now() - startedAt.toMillis() < LEDGER_STALE_MS) return;

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
          source: {
            type: source.type,
            url: source.url || null,
            platform: extracted.platform,
            thumbnail: extracted.thumbnail,
          },
        },
        { merge: true }
      );
      if (!goal) return;
      try {
        await buildLedger(uid, swapRef, profile, extracted.recipe, goal);
      } catch (e) {
        // La ricetta letta resta salvabile così com'è: si torna alla
        // scelta, non a un caricamento infinito.
        await swapRef.set({ status: 'extracted', goal: null }, { merge: true }).catch(() => {});
        throw e;
      }
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
    prompt: buildLedgerPrompt(profile, withoutSegments(recipe), goal),
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
      const original = snap.get('original');
      const segments = Array.isArray(original.segments) && original.segments.length ? original.segments : null;
      const result = await generateJSON({
        prompt: buildFinalizePrompt(profile, withoutSegments(original), chosen, goal, { segments }),
        schema: segments ? finalizeWithSegmentsSchema : finalizeSchema,
        temperature: 0.5,
        label: 'swap-finalize',
      });
      consumeQuota(uid, 'jobs', 1);

      // Stesso video, stessi tempi: cambiano solo step e ingredienti sotto.
      if (segments) {
        const remapped = remapSegments(original, result.recipe, result, chosen);
        if (remapped) result.recipe.segments = remapped;
      }

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

// POST /swap/dynamic  { recipeId } | { swapId }
// Vista dinamica a richiesta: per le ricette salvate prima della feature,
// o quando la divisione in import non è riuscita. Si riguarda il video e
// lo si divide sugli step della ricetta così com'è adesso. Esito e stato
// finiscono sul documento che l'app sta già ascoltando.
router.post('/dynamic', (req, res) => {
  const { recipeId, swapId } = req.body || {};
  const id = recipeId || swapId;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'missing_fields', details: 'recipeId o swapId richiesto' });
  }
  startJob(req, res, {
    type: 'swap.dynamic',
    payload: { recipeId: recipeId || null, swapId: swapId || null },
    work: async ({ uid }) => {
      const ref = db().doc(recipeId ? `users/${uid}/savedRecipes/${recipeId}` : `users/${uid}/swaps/${swapId}`);
      const snap = await ref.get();
      if (!snap.exists) throw new JobError('recipe_not_found', 'This recipe is no longer available.');
      const data = snap.data();
      const url = recipeId ? data.sourceUrl : data.source?.url;
      const recipe = recipeId ? data : data.original;

      const fail = async (e) => {
        await ref.set({
          dynamicStatus: 'failed',
          dynamicError: e.userMessage || 'We couldn’t build the dynamic view for this recipe. Try again.',
        }, { merge: true }).catch(() => {});
        throw e;
      };

      if (!url || detectPlatform(url) === 'unknown' || !recipe?.steps?.length) {
        return fail(new JobError('no_video', 'This recipe doesn’t come from a video.'));
      }
      await ref.set({ dynamicStatus: 'generating', dynamicError: FieldValue.delete() }, { merge: true });

      try {
        const result = await watchVideo(url, (await resolve(url)).videoUrls, {
          prompt: buildSegmentsPrompt(recipe),
          schema: segmentsSchema,
          temperature: 0.2,
          label: 'swap-dynamic',
          thinkingLevel: 'LOW',
        });
        if (!result) throw new JobError('no_video', 'We couldn’t get this video. Try again.');
        consumeQuota(uid, 'jobs', 1);
        const segments = cleanSegments(result.segments, recipe);
        console.log(`[swap.dynamic] ${url}: Gemini ha guardato il VIDEO, spezzoni grezzi ${result.segments?.length || 0}, validi ${segments?.length || 0}`);
        if (!segments) throw new JobError('no_segments', 'We couldn’t split this video into steps.');

        // `videoUrl`: il link alla copia salvata dalle versioni di prima.
        const done = { dynamicStatus: FieldValue.delete(), dynamicError: FieldValue.delete() };
        if (recipeId) {
          await ref.set({ segments, videoUrl: FieldValue.delete(), ...done }, { merge: true });
          return;
        }
        const update = { 'source.videoUrl': FieldValue.delete(), 'original.segments': segments, ...done };
        if (data.finalRecipe) {
          const remapped = remapSegments({ ...recipe, segments }, data.finalRecipe);
          if (remapped) update['finalRecipe.segments'] = remapped;
        }
        await ref.update(update);
      } catch (e) {
        return fail(e);
      }
    },
  });
});

/**
 * Il fotogramma del video da cui viene la ricetta, per far vedere a
 * Gemini com'è fatto il piatto. null se non c'è o non si scarica più.
 */
async function loadCoverFrame(recipe) {
  const url = recipe.imageSource === 'ai' ? recipe.originalImageUrl : recipe.imageUrl;
  if (!url) return null;
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 15 * 1024 * 1024 });
    const mimeType = String(res.headers['content-type'] || 'image/jpeg').split(';')[0];
    if (!mimeType.startsWith('image/')) return null;
    return { buffer: Buffer.from(res.data), mimeType };
  } catch (e) {
    console.warn('[swap.cover] fotogramma non disponibile, prompt dalla sola ricetta:', e.message);
    return null;
  }
}

// POST /swap/cover  { recipeId }
// Foto nuova per una ricetta salvata dai social: il fotogramma del video
// è spesso brutto. Esito e stato finiscono sul documento della ricetta,
// che l'app sta già ascoltando. Il fotogramma resta in `originalImageUrl`.
router.post('/cover', (req, res) => {
  const { recipeId } = req.body || {};
  if (!recipeId || typeof recipeId !== 'string') {
    return res.status(400).json({ error: 'missing_fields', details: 'recipeId richiesto' });
  }
  startJob(req, res, {
    type: 'swap.cover',
    payload: { recipeId },
    work: async ({ uid }) => {
      const ref = db().doc(`users/${uid}/savedRecipes/${recipeId}`);
      const snap = await ref.get();
      if (!snap.exists) throw new JobError('recipe_not_found', 'This recipe is no longer in your collection.');
      const recipe = snap.data();

      const fail = async (e) => {
        await ref.set({ coverStatus: 'failed', coverError: e.userMessage || 'We couldn’t plate a photo right now. Try again.' }, { merge: true }).catch(() => {});
        throw e;
      };

      const { allowed } = await checkQuota(uid, 'images');
      if (!allowed) return fail(new JobError('daily_limit_exceeded', 'You’ve made a lot of photos today. Try again tomorrow.'));

      await ref.set({ coverStatus: 'generating', coverError: FieldValue.delete() }, { merge: true });
      try {
        const frame = await loadCoverFrame(recipe);
        const brief = await generateJSON({
          prompt: buildCoverPrompt(recipe, { hasFrame: !!frame }),
          parts: frame ? [imagePart(frame.buffer, frame.mimeType)] : [],
          schema: coverSchema,
          temperature: 0.4,
          thinkingLevel: 'LOW',
          label: 'swap-cover',
        });
        consumeQuota(uid, 'jobs', 1);
        const imageUrl = await generateRecipeImage({ title: recipe.title, imagePrompt: brief.imagePrompt, cuisine: recipe.cuisine });
        if (!imageUrl) throw new JobError('cover_failed', 'We couldn’t plate a photo right now. Try again.');
        consumeQuota(uid, 'images', 1);
        await ref.set({
          imageUrl,
          imageSource: 'ai',
          // Solo la prima volta: rifare la foto non deve perdere il fotogramma.
          ...(recipe.imageSource !== 'ai' && recipe.imageUrl ? { originalImageUrl: recipe.imageUrl } : {}),
          coverStatus: FieldValue.delete(),
          coverError: FieldValue.delete(),
        }, { merge: true });
      } catch (e) {
        return fail(e);
      }
    },
  });
});

module.exports = router;
