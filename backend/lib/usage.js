// Ledger costi e uso per utente, sul documento users/{uid}.usage.
// Lo scrive SOLO il backend (Admin SDK): le rules bloccano il client.
//
// Ogni chiamata AI (Gemini, fal, RapidAPI) e ogni job finisce qui, così
// da Firestore si vede quanto costa un utente, quali feature usa, e
// con `scripts/usage-report.js` la media su tutti.
const { AsyncLocalStorage } = require('async_hooks');
const { db, FieldValue } = require('./firebase');
const { keys } = require('../config/keys');

const als = new AsyncLocalStorage();

/// L'apertura dell'app. Vive qui perché la scrivono le rotte, la legge
/// il webhook (per sapere a quale apertura uno ha pagato) e la conta la
/// dashboard: tre posti, un nome solo.
const APP_OPEN_EVENT = 'app.open';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function roundUsd(n) {
  if (!Number.isFinite(n) || n === 0) return 0;
  return Math.round(n * 1e6) / 1e6;
}

/** Prezzi Gemini 3.8 Flash ($/1M token). */
function geminiRates() {
  const input = parseFloat(process.env.GEMINI_INPUT_USD_PER_MILLION || '') || 0.75;
  const output = parseFloat(process.env.GEMINI_OUTPUT_USD_PER_MILLION || '') || 3.75;
  return { input, output };
}

/** FLUX.2 klein 4B su fal: $0.005/MP, landscape_4_3 ≈ 0,8 MP. */
function falUsdPerImage() {
  return parseFloat(process.env.FAL_USD_PER_IMAGE || '') || 0.005;
}

/** RapidAPI social download: stima per chiamata (il piano è a quota). */
function rapidUsdPerCall() {
  return parseFloat(process.env.RAPIDAPI_USD_PER_CALL || '') || 0.002;
}

function geminiCost(usage) {
  const input = usage.promptTokenCount || 0;
  const thoughts = usage.thoughtsTokenCount || 0;
  const output = (usage.candidatesTokenCount || 0) + thoughts;
  const rates = geminiRates();
  const usd = (input / 1e6) * rates.input + (output / 1e6) * rates.output;
  return { input, output, thoughts, usd: roundUsd(usd) };
}

function incrementMap(values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'number' && value !== 0) out[key] = FieldValue.increment(value);
  }
  return out;
}

/**
 * Esegue `fn` con uid+feature nel contesto: generateJSON / fal / RapidAPI
 * registrano da soli, senza toccare ogni call site.
 */
function runWith(uid, feature, fn, extra = {}) {
  return als.run({ uid, feature: feature || 'unknown', ...extra }, fn);
}

function ctx() {
  return als.getStore() || null;
}

/**
 * Scrive il patch su users/{uid}.usage, sul giorno, e sui totali app.
 * Fire-and-forget: un fallimento di analytics non deve far cadere il job.
 */
function apply(uid, patch) {
  if (!uid) return;
  Promise.resolve()
    .then(() => write(uid, patch))
    .catch((e) => console.error('[usage]', e.message));
}

async function write(uid, patch) {
  const feature = patch.feature || null;
  const gemini = patch.gemini ? geminiCost(patch.gemini) : null;
  const falImages = patch.falImages || 0;
  const falUsd = roundUsd(falImages * falUsdPerImage());
  const rapidCalls = patch.rapidCalls || 0;
  const rapidUsd = roundUsd(rapidCalls * rapidUsdPerCall());
  const totalUsd = roundUsd((gemini ? gemini.usd : 0) + falUsd + rapidUsd);

  const usage = {
    lastAt: FieldValue.serverTimestamp(),
  };
  if (patch.job) usage.jobs = FieldValue.increment(1);
  if (patch.failed) usage.jobsFailed = FieldValue.increment(1);

  if (feature && patch.count) {
    usage.features = { [feature]: FieldValue.increment(1) };
  }
  if (feature && patch.failed) {
    usage.featureErrors = { [feature]: FieldValue.increment(1) };
  }

  const costs = incrementMap({
    geminiCalls: gemini ? 1 : 0,
    geminiInputTokens: gemini ? gemini.input : 0,
    geminiOutputTokens: gemini ? gemini.output : 0,
    geminiThoughtsTokens: gemini ? gemini.thoughts : 0,
    geminiUsd: gemini ? gemini.usd : 0,
    falImages,
    falUsd,
    rapidCalls,
    rapidUsd,
    totalUsd,
  });
  if (Object.keys(costs).length) usage.costs = costs;

  if (feature && (gemini || falImages || rapidCalls || patch.count || patch.failed)) {
    usage.byFeature = {
      [feature]: incrementMap({
        jobs: patch.job ? 1 : 0,
        calls: patch.count ? 1 : 0,
        errors: patch.failed ? 1 : 0,
        geminiCalls: gemini ? 1 : 0,
        inputTokens: gemini ? gemini.input : 0,
        outputTokens: gemini ? gemini.output : 0,
        geminiUsd: gemini ? gemini.usd : 0,
        falImages,
        falUsd,
        rapidCalls,
        rapidUsd,
        usd: totalUsd,
      }),
    };
  }

  if (patch.social) usage.social = incrementMap(patch.social);
  if (patch.spaces) {
    usage.spaces = {};
    for (const [key, value] of Object.entries(patch.spaces)) {
      if (key === 'current' && typeof value === 'number') usage.spaces.current = value;
      else if (typeof value === 'number') usage.spaces[key] = FieldValue.increment(value);
    }
  }

  const day = { ...usage, day: todayKey() };
  const totals = {
    lastAt: FieldValue.serverTimestamp(),
  };
  if (patch.job) totals.jobs = FieldValue.increment(1);
  if (patch.failed) totals.jobsFailed = FieldValue.increment(1);
  Object.assign(totals, incrementMap({
    geminiCalls: gemini ? 1 : 0,
    falImages,
    rapidCalls,
    totalUsd,
    geminiUsd: gemini ? gemini.usd : 0,
    falUsd,
    rapidUsd,
  }));
  if (feature && patch.count) totals.features = { [feature]: FieldValue.increment(1) };

  const writes = [
    db().doc(`users/${uid}`).set({ usage }, { merge: true }),
    db().doc(`users/${uid}/usageDays/${todayKey()}`).set(day, { merge: true }),
  ];
  // `skipTotals`: gli eventi che arrivano a raffica (gli step
  // dell'onboarding) restano fuori dal documento unico dei totali, che
  // regge circa una scrittura al secondo. I contatori per utente ci
  // sono comunque, ed è da quelli che si costruisce il funnel.
  if (!patch.skipTotals) {
    writes.push(db().doc('analytics/totals').set(totals, { merge: true }));
  }

  await Promise.all(writes);
}

function recordJob(uid, feature) {
  apply(uid, { feature, job: true, count: true });
}

function recordJobError(uid, feature) {
  apply(uid, { feature, failed: true });
}

function resolveGeminiModel() {
  return keys.gemini.model;
}

function recordGemini(usageMetadata) {
  const current = ctx();
  if (!current || !usageMetadata) return;
  apply(current.uid, { feature: current.feature, gemini: usageMetadata });
}

function recordFal(count = 1) {
  const current = ctx();
  if (!current || !count) return;
  apply(current.uid, { feature: current.feature, falImages: count });
}

function recordRapid(count = 1) {
  const current = ctx();
  if (!current || !count) return;
  apply(current.uid, { feature: current.feature, rapidCalls: count });
}

function recordSocial(uid, social) {
  apply(uid, { social });
}

function recordEvent(uid, feature, extra = {}) {
  apply(uid, { feature, count: true, ...extra });
}

async function snapshotSpaces(uid) {
  try {
    const snap = await db().collection('spaces').where('memberUids', 'array-contains', uid).get();
    apply(uid, { spaces: { current: snap.size } });
  } catch (e) {
    console.error('[usage] snapshot spazi fallito:', e.message);
  }
}

module.exports = {
  APP_OPEN_EVENT,
  runWith,
  recordJob,
  recordJobError,
  recordGemini,
  recordFal,
  recordRapid,
  recordSocial,
  recordEvent,
  snapshotSpaces,
  resolveGeminiModel,
  geminiRates,
  falUsdPerImage,
  rapidUsdPerCall,
};
