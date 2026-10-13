// Anteprima leggera per i link in inbox: thumbnail e titolo dal
// provider social (RapidAPI) o dalla pagina web, senza scaricare il
// video né chiamare Gemini. Così l'utente capisce subito cosa c'è
// in coda, e il veganize completo resta un tap.
const crypto = require('crypto');
const { db, FieldValue } = require('./firebase');
const { detectPlatform, resolve } = require('../services/social-video');
const { fetchWebRecipe } = require('../services/web-recipe');

// Stesso algoritmo di swap.js così client e server concordano sull'id.
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

function previewId(url) {
  return crypto.createHash('sha256').update(normalizeUrl(url)).digest('hex');
}

function cleanTitle(text, fallback) {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  const title = line.slice(0, 100);
  return title || fallback;
}

/** Solo metadati pubblici: niente quota Gemini, niente download video. */
async function fetchPreview(url) {
  const platform = detectPlatform(url);

  if (platform !== 'unknown') {
    const { caption, thumbnail } = await resolve(url);
    return {
      title: cleanTitle(caption, `Recipe from ${platform}`),
      thumbnail: thumbnail || null,
      platform,
    };
  }

  const page = await fetchWebRecipe(url);
  return {
    title: cleanTitle(page.title, 'Recipe from the web'),
    thumbnail: page.thumbnail || null,
    platform: 'web',
  };
}

async function writePreview(uid, url, data) {
  const id = previewId(url);
  // Solo i campi che hanno un valore: un re-fetch andato peggio del
  // primo (social che throttla) non deve cancellare titolo o foto
  // già buoni con null o col fallback generico.
  const payload = {
    url,
    platform: data.platform,
    status: 'ready',
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (data.title) payload.title = data.title;
  if (data.thumbnail) payload.thumbnail = data.thumbnail;
  await db().doc(`users/${uid}/inboxPreviews/${id}`).set(payload, { merge: true });
  return id;
}

async function markPreviewFailed(uid, url, message) {
  const id = previewId(url);
  await db().doc(`users/${uid}/inboxPreviews/${id}`).set({
    url,
    status: 'failed',
    errorMessage: message,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

module.exports = {
  previewId,
  normalizeUrl,
  fetchPreview,
  writePreview,
  markPreviewFailed,
};
