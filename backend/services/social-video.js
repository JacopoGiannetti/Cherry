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
  constructor(code, message) {
    super(message);
    this.code = code;
    this.userMessage = message;
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
  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const m of arr) {
      const url = firstString(m.url, m.link, m.src);
      if (!url) continue;
      const isVideo = (m.type || m.videoAvailable || '').toString().toLowerCase().includes('video') || /\.mp4/i.test(url);
      if (isVideo) {
        candidates.push({ url, quality: (m.quality || '').toString().toLowerCase() });
      }
    }
  };
  collect(data.medias);
  collect(data.links);
  collect(data.formats);
  if (typeof data.url === 'string') candidates.push({ url: data.url, quality: '' });

  // Preferisci HD / no-watermark quando dichiarato.
  candidates.sort((a, b) => {
    const score = (c) => (c.quality.includes('hd') ? 2 : 0) + (c.quality.includes('no_watermark') || c.quality.includes('no-watermark') ? 1 : 0);
    return score(b) - score(a);
  });

  return { videoUrl: candidates[0]?.url || null, caption, thumbnail };
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
 * Ritorna { buffer, mimeType, caption, thumbnail, platform }.
 */
async function downloadVideo(url) {
  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    throw new SocialVideoError('unsupported_platform', 'Only TikTok and Instagram links are supported for now.');
  }

  const { videoUrl, caption, thumbnail } = await resolve(url);
  if (!videoUrl) {
    throw new SocialVideoError('no_media', 'No video found at that link.');
  }

  try {
    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxContentLength: MAX_VIDEO_BYTES,
      maxBodyLength: MAX_VIDEO_BYTES,
    });
    const buffer = Buffer.from(response.data);
    if (!buffer.length) throw new SocialVideoError('empty_media', 'The video appears to be empty.');
    if (buffer.length > MAX_VIDEO_BYTES) throw new SocialVideoError('too_large', 'That video is too long to analyze.');

    let mimeType = (response.headers['content-type'] || 'video/mp4').split(';')[0];
    if (!mimeType.startsWith('video/')) mimeType = 'video/mp4';
    return { buffer, mimeType, caption, thumbnail, platform };
  } catch (e) {
    if (e instanceof SocialVideoError) throw e;
    throw new SocialVideoError('download_failed', 'Could not download that video. Try again.');
  }
}

module.exports = { downloadVideo, resolve, detectPlatform, SocialVideoError };
