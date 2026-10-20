// Foto ricette con fal.ai FLUX.1 [schnell] — stesso modello del Gut Shop
// di GutSense. Uno style prompt FISSO garantisce che tutte le foto
// dell'app sembrino scattate dallo stesso fotografo (§10.5 blueprint).
const crypto = require('crypto');
const axios = require('axios');
const { keys } = require('../config/keys');
const { recordFal } = require('../lib/usage');
const { persistImage } = require('./storage');

const FAL_ENDPOINT = 'https://fal.run/fal-ai/flux/schnell';
const REQUEST_TIMEOUT_MS = 60000;
const MAX_ATTEMPTS = 3;
const MAX_CONCURRENCY = 6;

// Lo stile unico di Cherry: una vera foto, non un render. Luce naturale,
// piatto protagonista, texture vere (bruciature, lucido della salsa,
// briciole) — è quello che fa venire fame. Il "cosa" c'è nel piatto lo
// decide Gemini nell'imagePrompt; qui c'è solo il "come" lo fotografiamo.
// Niente nomi di cibi qui: FLUX li disegna in ogni piatto (la frase sulla
// pasta metteva tagliatelle sotto i peperoni ripieni).
const STYLE_PROMPT =
  'Photorealistic food photography, shot on a full-frame camera with an 85mm lens, f/2.8, ' +
  'natural soft window light from the left with gentle shadows, 45-degree angle, ' +
  'a single plate or bowl holding one serving is the only subject, centred, on a warm neutral wooden or linen table, ' +
  'freshly served and appetizing, food glistening where it is moist, a gentle wisp of steam, ' +
  'true-to-life colours, natural matte ceramic, no over-saturation, no plastic-looking CGI sheen, ' +
  'no second plate, no pot or pan, no people, no hands, no text, no watermark, no cutlery clutter';

let active = 0;
const queue = [];
function acquire() {
  return new Promise((resolve) => {
    if (active < MAX_CONCURRENCY) {
      active++;
      resolve();
    } else {
      queue.push(resolve);
    }
  });
}
function release() {
  active--;
  const next = queue.shift();
  if (next) {
    active++;
    next();
  }
}

/**
 * Genera la foto di una ricetta e la copia nel nostro Storage. Ritorna
 * l'URL stabile, quello temporaneo di fal se la copia non riesce, o null
 * se la generazione fallisce: le immagini sono best-effort, la ricetta
 * resta usabile senza.
 */
async function generateRecipeImage({ title, imagePrompt, cuisine }) {
  if (!keys.fal.apiKey) {
    console.warn('[fal] FAL_KEY mancante: nessuna immagine generata');
    return null;
  }
  const subject = imagePrompt || `${title}, ${cuisine || 'plant-based'} dish`;
  const url = await requestImage(`${subject}. ${STYLE_PROMPT}`);
  if (!url) return null;
  try {
    return await persistImage(url, `recipe-images/${crypto.randomUUID()}.jpg`);
  } catch (e) {
    console.warn('[fal] foto non copiata su Storage, resta il link fal:', e.message);
    return url;
  }
}

async function requestImage(prompt) {
  await acquire();
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await axios.post(
          FAL_ENDPOINT,
          {
            prompt,
            image_size: 'landscape_4_3',
            num_inference_steps: 4,
            num_images: 1,
            output_format: 'jpeg',
          },
          {
            headers: { Authorization: `Key ${keys.fal.apiKey}` },
            timeout: REQUEST_TIMEOUT_MS,
          }
        );
        const url = response.data?.images?.[0]?.url || null;
        if (url) {
          recordFal(1);
          return url;
        }
        throw new Error('risposta fal senza immagine');
      } catch (e) {
        const status = e.response && e.response.status;
        const retriable = !status || status === 429 || status >= 500 || e.code === 'ECONNABORTED';
        console.error(`[fal] tentativo ${attempt}/${MAX_ATTEMPTS} fallito:`, status || e.message);
        if (!retriable || attempt === MAX_ATTEMPTS) return null;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    return null;
  } finally {
    release();
  }
}

module.exports = { generateRecipeImage };
