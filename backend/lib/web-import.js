// Import della web app: link TikTok/Instagram → ricetta divisa in passi
// sul video (la Dynamic view), salvata in users/{uid}/savedRecipes.
// Stessa pipeline dello Swap (RapidAPI, Gemini che guarda il video
// intero da Storage, pulizia degli spezzoni), con corsie per chi mangia
// di tutto: carne e pesce, latticini e uova hanno la loro.
const crypto = require('crypto');
const axios = require('axios');
const { db, FieldValue } = require('./firebase');
const { getCached, setCached } = require('./cache');
const { cleanSegments, withoutSegments } = require('./recipe-segments');
const { keepThumbnail } = require('./inbox-preview');
const { generateJSON, videoPart } = require('../services/gemini');
const { stageRemoteVideo } = require('../services/storage');
const { resolve, downloadVideo, detectPlatform } = require('../services/social-video');
const { buildExtractionPrompt, videoExtractionSchema } = require('../prompts/swap');
const { runWith, recordJob, recordJobError } = require('./usage');
const { buildStepFrames } = require('./step-frames');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const WEB_SECTIONS = [
  'produce', 'meat_seafood', 'dairy_eggs', 'bakery', 'grains_pasta',
  'canned_jarred', 'spices_condiments', 'frozen', 'snacks_drinks', 'other',
];

/** Lo schema dello Swap con le corsie della web app. */
const webSchema = (() => {
  const s = JSON.parse(JSON.stringify(videoExtractionSchema));
  s.properties.recipe.properties.ingredients.items.properties.storeSection.enum = WEB_SECTIONS;
  s.properties.recipe.properties.cuisine = { type: 'STRING', description: 'Cuisine in 1-2 words, e.g. "Italian"' };
  return s;
})();

const PROFILE = { dietaryIdentity: 'omnivore', language: 'en', units: 'us', currency: 'USD' };
const LANGS = ['en', 'it', 'es', 'fr', 'de', 'pt'];

/** Lingua e misure scelte nell'account: il modello scrive la ricetta così. */
function profileFor(prefs = {}) {
  const language = LANGS.includes(prefs.language) ? prefs.language : 'en';
  const units = prefs.units === 'metric' || prefs.units === 'us' ? prefs.units : (language === 'en' ? 'us' : 'metric');
  return { ...PROFILE, language, units, currency: language === 'en' ? 'USD' : 'EUR' };
}

function userError(code, message) {
  return Object.assign(new Error(message), { code, userMessage: message });
}

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

/** Id stabile per link: lo stesso post incollato due volte è la stessa ricetta. */
function recipeIdFor(url) {
  return 'w' + crypto.createHash('sha256').update(normalizeUrl(url)).digest('hex').slice(0, 24);
}

function cacheKey(url, profile = PROFILE) {
  // In inglese con misure US la chiave resta quella di prima: la cache esistente vale ancora.
  const variant = profile.language === 'en' && profile.units === 'us' ? 'en' : `${profile.language}-${profile.units}`;
  return crypto.createHash('sha256').update(`web::${normalizeUrl(url)}::${variant}`).digest('hex');
}

// ---------- Il video da mostrare ----------

function tiktokId(link) {
  const s = String(link || '');
  const m = s.match(/\/(?:video|photo|v)\/(\d{8,})/) || s.match(/[?&]item_id=(\d{8,})/);
  return m ? m[1] : null;
}

async function findEmbed(url, platform) {
  if (platform === 'instagram') {
    const m = url.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    return m ? { type: 'instagram', shortcode: m[1] } : null;
  }
  let id = tiktokId(url);
  if (!id) {
    // Link corti (vm.tiktok.com/…): si segue il rimando fino al link completo.
    const r = await axios.get(url, {
      maxRedirects: 5, timeout: 10000, headers: { 'User-Agent': UA }, validateStatus: () => true,
    }).catch(() => null);
    const final = r?.request?.res?.responseUrl || '';
    id = tiktokId(final) || tiktokId(decodeURIComponent(final));
  }
  return id ? { type: 'tiktok', postId: id } : null;
}

// ---------- Estrazione ----------

async function extract(url, profile = PROFILE) {
  const t0 = Date.now();
  const post = await resolve(url);
  const request = {
    prompt: buildExtractionPrompt({ sourceType: 'video', caption: post.caption, profile, segments: true })
      + '\nAlso return the cuisine in 1-2 words.',
    schema: webSchema,
    temperature: 0.2,
    label: 'web-extract-video',
    thinkingLevel: 'LOW',
  };
  let extraction = null;
  for (const remote of post.videoUrls || []) {
    let staged;
    try {
      staged = await stageRemoteVideo(remote);
    } catch (e) {
      console.log(`[web] ${url}: video non caricato su Storage: ${e.message}`);
      continue;
    }
    try {
      extraction = await generateJSON({ ...request, parts: [{ fileData: { fileUri: staged.gsUri, mimeType: 'video/mp4' } }] });
      break;
    } catch (e) {
      console.log(`[web] ${url}: Gemini da Storage fallito: ${e.message}`);
    } finally {
      await staged.discard();
    }
  }
  if (!extraction) {
    const video = await downloadVideo(url);
    if (!video.hasPicture) throw userError('no_video', 'This post has no video we can turn into steps.');
    extraction = await generateJSON({ ...request, parts: [videoPart(video.buffer, video.mimeType)] });
  }
  if (!extraction.found || !extraction.recipe) {
    throw userError('no_recipe', "We couldn't find a recipe in that video.");
  }
  const recipe = withoutSegments(extraction.recipe);
  const segments = cleanSegments(extraction.recipe.segments, recipe);
  if (segments) recipe.segments = segments;
  const thumbnail = (await keepThumbnail(url, post.thumbnail)) || post.thumbnail || null;
  console.log(`[web] ${url}: ${recipe.steps?.length || 0} step, spezzoni ${segments?.length || 0},`
    + ` ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { recipe, thumbnail, caption: post.caption || null };
}

/** Link → { embed, entry }: dalla cache se c'è, altrimenti Gemini guarda il video. */
async function readRecipe(url, onStage = () => {}, profile = PROFILE) {
  const platform = detectPlatform(url);
  const embed = await findEmbed(url, platform);
  if (!embed) throw userError('no_embed', "We couldn't find the video in that link.");
  await onStage('watching', embed);
  const key = cacheKey(url, profile);
  let entry = await getCached('sourceRecipes', key);
  if (!entry) {
    entry = await extract(url, profile);
    await setCached('sourceRecipes', key, entry);
  }
  return { embed, entry, platform };
}

/** I fotogrammi degli step, una volta per link e lingua: si salvano anche in cache. */
async function addStepFrames(url, entry, profile) {
  const post = await resolve(url);
  const videoUrl = (post.videoUrls || [])[0];
  if (!videoUrl) return null;
  const key = cacheKey(url, profile);
  const frames = await buildStepFrames({ videoUrl, recipe: entry.recipe, key: key.slice(0, 24) });
  if (frames) await setCached('sourceRecipes', key, { ...entry, stepFrames: frames });
  return frames;
}

/** La forma che la web app mostra e salva. */
function recipeDoc(entry) {
  const r = entry.recipe;
  return {
    title: r.title || 'Untitled recipe',
    cuisine: r.cuisine || null,
    servings: r.servings || 2,
    cookMinutes: r.cookMinutes || 0,
    costUsd: (r.ingredients || []).reduce((sum, g) => sum + (g.costUsd || 0), 0),
    ingredients: r.ingredients || [],
    steps: r.steps || [],
    segments: r.segments || null,
    stepFrames: entry.stepFrames || null,
    imageUrl: entry.thumbnail || null,
  };
}

/**
 * Il lavoro completo, scritto man mano sul documento della ricetta:
 * la pagina lo ascolta in tempo reale (status importing → ready/failed).
 */
async function importInto(uid, url) {
  const platform = detectPlatform(url);
  const id = recipeIdFor(url);
  const ref = db().doc(`users/${uid}/savedRecipes/${id}`);

  const existing = await ref.get();
  if (existing.exists && existing.get('status') !== 'failed' && existing.get('status') !== 'importing') {
    return { id, existing: true };
  }

  await ref.set({
    title: 'Reading the video…',
    status: 'importing',
    importStage: 'reading',
    sourceUrl: url,
    platform,
    origin: 'imported',
    ingredients: [],
    steps: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: false });

  // Dentro runWith: Gemini e RapidAPI scrivono il loro costo su questo account (feature web.import).
  runWith(uid, 'web.import', async () => {
    const user = await db().doc(`users/${uid}`).get();
    const profile = profileFor(user.get('recipePrefs') || {});
    const { entry } = await readRecipe(url, (stage, embed) =>
      ref.update({ embed, importStage: stage, updatedAt: FieldValue.serverTimestamp() }), profile);
    await ref.set({
      ...recipeDoc(entry),
      status: 'ready',
      importStage: 'done',
      caption: entry.caption ? entry.caption.slice(0, 2000) : null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    recordJob(uid, 'web.import');
    // Instagram non lascia mandare in loop lo step: al suo posto i fotogrammi.
    // Dopo il "ready": la ricetta si apre subito, le immagini arrivano in pochi secondi.
    if (platform === 'instagram' && !entry.stepFrames) {
      await addStepFrames(url, entry, profile).then((frames) => frames
        && ref.set({ stepFrames: frames, updatedAt: FieldValue.serverTimestamp() }, { merge: true }))
        .catch((e) => console.warn(`[frames] ${url}: ${e.message}`));
    }
  }).catch(async (e) => {
    recordJobError(uid, 'web.import');
    console.error(`[web] import ${url}: ${e.message}`);
    await ref.set({
      status: 'failed',
      error: e.userMessage || 'Something went wrong reading that video. Try again.',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
  });

  return { id, existing: false };
}

module.exports = {
  profileFor, importInto, readRecipe, recipeDoc, recipeIdFor, findEmbed, addStepFrames, WEB_SECTIONS };
