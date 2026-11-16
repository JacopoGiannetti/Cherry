// Cherry web: prototipo della Dynamic view nel browser, montato su /web.
// Incolli un link TikTok o Instagram e ottieni la ricetta divisa in passi,
// col video che salta al pezzo giusto. Riusa la pipeline dello Swap
// (RapidAPI, Gemini che guarda il video intero, pulizia degli spezzoni).
//
// Pagina pubblica, senza login: i limiti qui sotto evitano che un link
// girato in giro consumi Gemini e RapidAPI senza freno.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');

const { generateJSON, videoPart } = require('../services/gemini');
const { stageRemoteVideo } = require('../services/storage');
const { resolve, downloadVideo, detectPlatform } = require('../services/social-video');
const { cleanSegments, withoutSegments } = require('../lib/recipe-segments');
const { getCached, setCached } = require('../lib/cache');
const { buildExtractionPrompt, videoExtractionSchema } = require('../prompts/swap');

const PROFILE = { dietaryIdentity: 'omnivore', language: 'en', units: 'us', currency: 'USD' };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const router = express.Router();
router.use(express.static(path.join(__dirname, 'public')));

// ---------- Limiti (in memoria: bastano per un prototipo) ----------

const PER_IP_PER_HOUR = 12;
const GLOBAL_PER_DAY = 150;
const hits = new Map(); // ip → [timestamp]
let day = { key: '', count: 0 };

function allow(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  const today = new Date().toISOString().slice(0, 10);
  if (day.key !== today) day = { key: today, count: 0 };
  if (recent.length >= PER_IP_PER_HOUR || day.count >= GLOBAL_PER_DAY) return false;
  recent.push(now);
  hits.set(ip, recent);
  day.count += 1;
  return true;
}

// ---------- Import (job in memoria, la pagina chiede lo stato) ----------

const jobs = new Map();

router.post('/api/import', express.json(), (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    return res.status(400).json({ error: 'Paste a TikTok or Instagram link.' });
  }
  if (!allow(req)) {
    return res.status(429).json({ error: 'Too many recipes for now. Try again later.' });
  }
  const id = crypto.randomUUID();
  const job = { status: 'running', stage: 'Reading the post', result: null, error: null, at: Date.now() };
  jobs.set(id, job);
  for (const [k, j] of jobs) if (Date.now() - j.at > 3600_000) jobs.delete(k);
  importLink(url, platform, (stage) => { job.stage = stage; })
    .then((result) => { job.status = 'done'; job.result = result; })
    .catch((e) => {
      console.error(`[web] ${url}: ${e.message}`);
      job.status = 'error';
      job.error = e.userMessage || 'Import failed. Try again.';
    });
  res.status(202).json({ id });
});

router.get('/api/import/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  res.json(job);
});

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

/** Stessa chiave della cache dello Swap: un link già importato nell'app torna gratis. */
function cacheKey(url) {
  return crypto.createHash('sha256').update(`${normalizeUrl(url)}::en`).digest('hex');
}

function userError(message) {
  return Object.assign(new Error(message), { userMessage: message });
}

async function importLink(url, platform, setStage) {
  const embed = await findEmbed(url, platform);
  if (!embed) throw userError("We couldn't find the video in that link.");

  const key = cacheKey(url);
  let entry = await getCached('sourceRecipes', key);
  if (entry?.recipe?.segments?.length) {
    console.log(`[web] ${url}: dalla cache`);
  } else {
    setStage('Watching the video');
    entry = await extract(url);
    await setCached('sourceRecipes', key, entry);
  }
  if (!entry.recipe.segments?.length) {
    throw userError('We read the recipe, but could not split this video into steps.');
  }
  return { url, platform, embed, recipe: entry.recipe, caption: entry.caption || null };
}

/** Come extractWatchingVideo dello Swap: Gemini guarda il video intero da Storage, poi lo si cancella. */
async function extract(url) {
  const t0 = Date.now();
  const post = await resolve(url);
  const request = {
    prompt: buildExtractionPrompt({ sourceType: 'video', caption: post.caption, profile: PROFILE, segments: true }),
    schema: videoExtractionSchema,
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
    // Ripiego dello Swap: il video scaricato e mandato dentro la richiesta.
    const video = await downloadVideo(url);
    if (!video.hasPicture) throw userError('This post has no video we can split into steps.');
    extraction = await generateJSON({ ...request, parts: [videoPart(video.buffer, video.mimeType)] });
  }
  if (!extraction.found || !extraction.recipe) throw userError("We couldn't find a recipe in that post.");
  const recipe = withoutSegments(extraction.recipe);
  const segments = cleanSegments(extraction.recipe.segments, recipe);
  if (segments) recipe.segments = segments;
  console.log(`[web] ${url}: ${recipe.steps?.length || 0} step, spezzoni ${segments?.length || 0}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { recipe, thumbnail: post.thumbnail || null, platform: detectPlatform(url), caption: post.caption || null };
}

// ---------- Il video da mostrare ----------

async function findEmbed(url, platform) {
  if (platform === 'instagram') {
    const m = url.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    return m ? { type: 'instagram', shortcode: m[1] } : null;
  }
  let id = tiktokId(url);
  if (!id) {
    // Link corti (vm.tiktok.com/…): si segue il rimando fino al link completo.
    const r = await axios.get(url, { maxRedirects: 5, timeout: 10000, headers: { 'User-Agent': UA }, validateStatus: () => true }).catch(() => null);
    const final = r?.request?.res?.responseUrl || '';
    id = tiktokId(final) || tiktokId(decodeURIComponent(final));
  }
  return id ? { type: 'tiktok', postId: id } : null;
}

function tiktokId(link) {
  const s = String(link || '');
  const m = s.match(/\/(?:video|photo|v)\/(\d{8,})/) || s.match(/[?&]item_id=(\d{8,})/);
  return m ? m[1] : null;
}

// ---------- Instagram: il video passa da qui, a flusso ----------
//
// L'embed di Instagram non ha comandi e in un browser non si può toccare
// (è un altro sito). Allora il file del reel, dal CDN di Instagram, si fa
// suonare in un <video> nostro: passa da qui a pezzi (Range), senza mai
// salvarlo, così si può saltare al secondo giusto.

const mediaCache = new Map(); // link del post → { urls, at }
const MEDIA_TTL_MS = 30 * 60 * 1000;

async function cdnUrls(postUrl, fresh) {
  const hit = mediaCache.get(postUrl);
  if (!fresh && hit && Date.now() - hit.at < MEDIA_TTL_MS) return hit.urls;
  if (!hit && !allow({ headers: {}, ip: 'media' })) throw userError('busy');
  const post = await resolve(postUrl);
  mediaCache.set(postUrl, { urls: post.videoUrls || [], at: Date.now() });
  return post.videoUrls || [];
}

router.get('/api/media', async (req, res) => {
  const postUrl = String(req.query.u || '');
  if (detectPlatform(postUrl) !== 'instagram') return res.status(400).end();
  const headers = { 'User-Agent': UA };
  if (req.headers.range) headers.Range = req.headers.range;

  for (const fresh of [false, true]) {
    let urls;
    try {
      urls = await cdnUrls(postUrl, fresh);
    } catch (e) {
      return res.status(502).json({ error: e.userMessage || 'video unavailable' });
    }
    for (const cdn of urls) {
      const upstream = await axios.get(cdn, { responseType: 'stream', headers, timeout: 30000, validateStatus: () => true }).catch(() => null);
      if (!upstream || upstream.status >= 400) { upstream?.data?.destroy(); continue; }
      const type = String(upstream.headers['content-type'] || '');
      if (!type.startsWith('video/')) { upstream.data.destroy(); continue; }
      res.status(upstream.status);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
      }
      res.setHeader('Cache-Control', 'private, max-age=600');
      req.on('close', () => upstream.data.destroy());
      return upstream.data.pipe(res);
    }
    // Nessun link valido: forse scaduti, si chiede di nuovo al social una volta.
  }
  res.status(502).json({ error: 'video unavailable' });
});

module.exports = router;
