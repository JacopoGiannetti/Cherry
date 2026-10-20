// Download dei file che l'app carica su Firebase Storage
// (foto dei menu, screenshot di ricette). Al backend arriva solo il path.
// E il contrario: le foto che arrivano da fuori (fal, copertine dei
// social) si copiano qui, perché i loro link scadono.
const crypto = require('crypto');
const axios = require('axios');
const { storage } = require('../lib/firebase');
const { bucket } = require('../lib/catalog/deps');

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const PERSIST_TIMEOUT_MS = 30000;

async function downloadImage(storagePath) {
  const file = storage().bucket().file(storagePath);
  const [meta] = await file.getMetadata();
  const size = parseInt(meta.size || '0', 10);
  if (size > MAX_IMAGE_BYTES) {
    const e = new Error(`Immagine troppo grande: ${size} byte`);
    e.code = 'image_too_large';
    e.userMessage = 'That photo is too large. Please retake it.';
    throw e;
  }
  const [buffer] = await file.download();
  const mimeType = meta.contentType || 'image/jpeg';
  return { buffer, mimeType };
}

function isPersisted(url) {
  return typeof url === 'string' && url.includes('firebasestorage.googleapis.com');
}

function downloadUrl(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/**
 * Copia un'immagine remota nel bucket e ritorna un URL che non scade.
 * I file di fal e le copertine firmate di TikTok/Instagram hanno una
 * scadenza: salvarne il link vuol dire perdere la foto, e
 * sul telefono resta solo finché iOS non svuota la cache.
 *
 * Se il file c'è già si riusa col suo token: riscriverlo ne genererebbe
 * uno nuovo e invaliderebbe gli URL già salvati nei documenti.
 * Lancia se non riesce: chi chiama decide il ripiego.
 */
async function persistImage(url, path) {
  if (!url) return null;
  if (isPersisted(url)) return url;

  const b = bucket();
  const file = b.file(path);
  const [exists] = await file.exists();
  if (exists) {
    const [meta] = await file.getMetadata();
    const token = String(meta.metadata?.firebaseStorageDownloadTokens || '').split(',')[0];
    if (token) return downloadUrl(b.name, path, token);
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: PERSIST_TIMEOUT_MS,
    maxContentLength: MAX_IMAGE_BYTES,
    // Alcuni CDN social rispondono 403 senza un user agent da browser.
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
  });
  const contentType = String(response.headers['content-type'] || 'image/jpeg').split(';')[0];
  if (!contentType.startsWith('image/')) throw new Error(`non è un'immagine: ${contentType}`);

  const token = crypto.randomUUID();
  await file.save(Buffer.from(response.data), {
    contentType,
    metadata: { cacheControl: 'public, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
  });
  return downloadUrl(b.name, path, token);
}

module.exports = { downloadImage, persistImage, isPersisted };
