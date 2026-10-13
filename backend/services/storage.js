// Download dei file che l'app carica su Firebase Storage
// (foto dei menu, screenshot di ricette). Al backend arriva solo il path.
const { storage } = require('../lib/firebase');

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

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

module.exports = { downloadImage };
