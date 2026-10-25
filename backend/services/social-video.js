// Risoluzione e download dei video TikTok/Instagram per lo Swap engine.
// Provider: RapidAPI "Social Download All In One" (stesso di GutSense,
// account nuovo). Il video resta in memoria, mai su disco.
const axios = require('axios');
const { keys } = require('../config/keys');
const { recordRapid } = require('../lib/usage');

const RESOLVE_TIMEOUT_MS = 45000;
const DOWNLOAD_TIMEOUT_MS = 90000;
// Allineato al limite inline di Vertex: inutile scaricare un video
// che poi non entrerebbe nella richiesta di analisi.
const { MAX_INLINE_BYTES } = require('./gemini');
const MAX_VIDEO_BYTES = MAX_INLINE_BYTES;

class SocialVideoError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.userMessage = message;
    // Didascalia e copertina, quando il post si è letto ma il video no:
    // chi chiama può ancora provare a ricavarne la ricetta.
    this.caption = extra.caption || null;
    this.thumbnail = extra.thumbnail || null;
  }
}

function detectPlatform(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com') || u.includes('instagr.am')) return 'instagram';
  return 'unknown';
}

function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function pickBestMedia(data) {
  const caption = firstString(data.title, data.caption, data.description, data.text, data.meta?.title);
  const thumbnail = firstString(data.thumbnail, data.cover, data.thumb, data.picture, data.image, data.meta?.thumbnail);

  const candidates = [];
  const audioUrls = [];
  const seen = new Set();
  const add = (url, quality) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, quality });
  };
  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const m of arr) {
      const url = firstString(m.url, m.link, m.src);
      if (!url) continue;
      // Instagram dà anche la traccia audio da sola, con un link .mp4.
      // Non è un video (niente immagini), ma resta il ripiego per leggere
      // la ricetta quando ogni versione video sfora il limite di Gemini.
      const kind = `${m.type || ''} ${m.quality || ''}`.toLowerCase();
      if (/audio/.test(kind)) {
        if (!seen.has(url)) { seen.add(url); audioUrls.push(url); }
        continue;
      }
      if (/image|photo/.test(kind)) continue;
      const isVideo = (m.type || m.videoAvailable || '').toString().toLowerCase().includes('video') || /\.mp4/i.test(url);
      if (isVideo) add(url, (m.quality || '').toString().toLowerCase());
    }
  };
  collect(data.medias);
  collect(data.links);
  collect(data.formats);
  // `url` a volte è il link del post stesso: una pagina, non un video.
  if (typeof data.url === 'string' && detectPlatform(data.url) === 'unknown') add(data.url, '');

  // Per leggere la ricetta basta la definizione normale, e l'HD di un
  // reel lungo sfora il limite inline di Gemini: prima la versione più
  // leggera, l'HD resta come seconda scelta. Senza watermark a parità.
  const score = (c) =>
    (c.quality.includes('hd') ? 0 : 2) +
    (c.quality.includes('no_watermark') || c.quality.includes('no-watermark') ? 1 : 0);
  candidates.sort((a, b) => score(b) - score(a));

  return { videoUrls: candidates.map((c) => c.url), audioUrls, caption, thumbnail };
}

async function resolve(url) {
  if (!keys.rapidApi.apiKey) {
    throw new SocialVideoError('not_configured', 'Video import is not set up yet.');
  }
  try {
    const response = await axios.post(
      `https://${keys.rapidApi.socialHost}${keys.rapidApi.socialPath}`,
      { url },
      {
        headers: {
          'x-rapidapi-key': keys.rapidApi.apiKey,
          'x-rapidapi-host': keys.rapidApi.socialHost,
          'content-type': 'application/json',
        },
        timeout: RESOLVE_TIMEOUT_MS,
      }
    );
    recordRapid(1);
    return pickBestMedia(response.data || {});
  } catch (e) {
    const status = e.response && e.response.status;
    if (status === 429) throw new SocialVideoError('provider_rate_limited', 'Too many imports right now. Try again in a minute.');
    throw new SocialVideoError('provider_error', 'Could not read that link. Make sure it is a public TikTok or Instagram post.');
  }
}

/**
 * Ritorna { buffer, mimeType, caption, thumbnail, platform, hasPicture }.
 * `hasPicture` false: è arrivata solo la traccia audio, buona per leggere
 * la ricetta ma non per la vista dinamica.
 */
async function downloadVideo(url) {
  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    throw new SocialVideoError('unsupported_platform', 'Only TikTok and Instagram links are supported for now.');
  }

  const { videoUrls, audioUrls, caption, thumbnail } = await resolve(url);
  if (!videoUrls.length && !audioUrls.length) {
    // Post di sole foto, o carosello: niente video, ma la didascalia c'è.
    throw new SocialVideoError('no_media', 'No video found at that link.', { caption, thumbnail });
  }

  // Si provano tutte le versioni: una può sforare il limite o avere il
  // link del CDN già scaduto, e la successiva andare benissimo.
  const reasons = [];
  for (const videoUrl of videoUrls) {
    try {
      return { ...(await fetchVideo(videoUrl)), caption, thumbnail, platform, hasPicture: true };
    } catch (e) {
      reasons.push(e.message);
    }
  }
  for (const audioUrl of audioUrls) {
    try {
      return { ...(await fetchVideo(audioUrl)), caption, thumbnail, platform, hasPicture: false };
    } catch (e) {
      reasons.push(e.message);
    }
  }
  console.warn(`[social] nessun video scaricabile per ${url}: ${reasons.join(' | ')}`);
  const tooLarge = reasons.every((r) => /maxContentLength|troppo grande/i.test(r));
  throw tooLarge
    ? new SocialVideoError('too_large', 'That video is too long for us to read. Try a shorter post.', { caption, thumbnail })
    : new SocialVideoError('download_failed', 'Could not download that video. Try again.', { caption, thumbnail });
}

async function fetchVideo(videoUrl) {
  const response = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxContentLength: MAX_VIDEO_BYTES,
    maxBodyLength: MAX_VIDEO_BYTES,
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
  });
  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error('video vuoto');
  if (buffer.length > MAX_VIDEO_BYTES) throw new Error(`video troppo grande: ${buffer.length} byte`);

  const contentType = String(response.headers['content-type'] || 'video/mp4').split(';')[0];
  // Un CDN che risponde con una pagina d'errore non è un video.
  if (/^(text|application\/json)/.test(contentType)) throw new Error(`non è un video: ${contentType}`);
  const mimeType = contentType.startsWith('video/') ? contentType : 'video/mp4';
  return { buffer, mimeType };
}

module.exports = { downloadVideo, resolve, detectPlatform, SocialVideoError };
