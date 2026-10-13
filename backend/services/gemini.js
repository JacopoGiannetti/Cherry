// Client Gemini su Vertex AI (express mode): sempre output JSON vincolato
// da responseSchema. Timeout esplicito e retry con backoff (in GutSense
// mancava il timeout e una richiesta poteva restare appesa per sempre).
//
// Si usa aiplatform.googleapis.com e NON generativelanguage.googleapis.com:
// la chiave Vertex è abilitata solo sul primo endpoint.
const axios = require('axios');
const { keys } = require('../config/keys');
const { recordGemini, resolveGeminiModel } = require('../lib/usage');

const BASE = 'https://aiplatform.googleapis.com/v1/publishers/google/models';
const REQUEST_TIMEOUT_MS = 120000;
const MAX_ATTEMPTS = 3;

// Vertex rifiuta le richieste oltre ~20MB: si tiene un margine per prompt e overhead.
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

function assertConfigured() {
  if (!keys.gemini.apiKey) {
    const e = new Error('GEMINI_API_KEY mancante nel .env');
    e.code = 'not_configured';
    e.userMessage = 'The kitchen is not set up yet. Please try again later.';
    throw e;
  }
}

function stripJsonFences(text) {
  return text
    .replace(/^```(json)?/gm, '')
    .replace(/```$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

/**
 * Chiamata testo/vision con output JSON strutturato.
 *
 * @param {object} opts
 * @param {string} opts.prompt        testo del prompt
 * @param {object} opts.schema        responseSchema Gemini
 * @param {Array}  [opts.parts]       parti extra: { inlineData }
 * @param {number} [opts.temperature]
 * @param {string} [opts.label]       etichetta per i log di costo
 * @returns {Promise<object>} JSON già parsato
 */
async function generateJSON({ prompt, schema, parts = [], temperature = 0.7, label = 'gemini', thinkingLevel, model: modelOverride }) {
  assertConfigured();
  const model = modelOverride || resolveGeminiModel();
  const url = `${BASE}/${model}:generateContent`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, ...parts] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: schema,
      // Trascrizioni e letture di menu sono compiti meccanici: meno
      // ragionamento significa meno token di output e meno attesa.
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
    },
    safetySettings: [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ].map((category) => ({ category, threshold: 'OFF' })),
  };

  const config = {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'x-goog-api-key': keys.gemini.apiKey, 'Content-Type': 'application/json' },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  };

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await axios.post(url, body, config);
      const candidate = response.data.candidates && response.data.candidates[0];
      // Con i modelli "thinking" alcune parti sono pensieri: si tiene solo l'output.
      const text = candidate && candidate.content && candidate.content.parts
        ? candidate.content.parts.filter((p) => !p.thought).map((p) => p.text || '').join('')
        : null;
      if (!text) throw new Error(`Risposta Gemini vuota (finishReason: ${candidate?.finishReason})`);

      const usage = response.data.usageMetadata;
      if (usage) {
        console.log(
          `[gemini ${label} ${model}] tokens in=${usage.promptTokenCount} out=${usage.candidatesTokenCount} think=${usage.thoughtsTokenCount || 0} tot=${usage.totalTokenCount}`
        );
        recordGemini(usage);
      }
      return JSON.parse(stripJsonFences(text));
    } catch (e) {
      lastError = e;
      const status = e.response && e.response.status;
      const retriable = !status || status === 429 || status >= 500 || e.code === 'ECONNABORTED' || e instanceof SyntaxError;
      const detail = e.response && e.response.data && e.response.data.error
        ? e.response.data.error.message
        : e.message;
      console.error(`[gemini ${label}] tentativo ${attempt}/${MAX_ATTEMPTS} fallito:`, status || '', detail);
      if (!retriable || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  const err = new Error(`Gemini ha fallito dopo ${MAX_ATTEMPTS} tentativi: ${lastError.message}`);
  err.code = 'ai_failed';
  err.userMessage = 'The kitchen hit a snag. Please try again.';
  throw err;
}

/** Parte inline per un'immagine scaricata (Buffer). */
function imagePart(buffer, mimeType = 'image/jpeg') {
  return { inlineData: { mimeType, data: buffer.toString('base64') } };
}

/**
 * Parte inline per un video (Buffer). Vertex non ha la Files API, quindi
 * i byte viaggiano nella richiesta: oltre il limite si fallisce in modo
 * esplicito invece di far scadere la chiamata.
 */
function videoPart(buffer, mimeType = 'video/mp4') {
  if (buffer.length > MAX_INLINE_BYTES) {
    const e = new Error(`Video troppo grande per l'analisi inline: ${Math.round(buffer.length / 1e6)}MB`);
    e.code = 'video_too_large';
    e.userMessage = 'That video is too long for us to read. Try a shorter post.';
    throw e;
  }
  return { inlineData: { mimeType, data: buffer.toString('base64') } };
}

module.exports = { generateJSON, imagePart, videoPart, MAX_INLINE_BYTES };
