// Letture e scritture del ricettario su Firestore.
//
// catalog/{id}            una ricetta: canonica, traduzioni, contatori
// catalogExposures/{id}   una ricetta servita a qualcuno (id = doc della run)
// catalogUsers/{uid}      cosa di quell'utente è già stato contato
// catalogTerms/{hash}     esclusioni scritte a mano → parole inglesi
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { db, COLLECTIONS } = require('./deps');
const { generateJSON } = require('../../services/gemini');
const { buildTranslatePrompt, translateSchema, buildTermsPrompt, termsSchema } = require('../../prompts/catalog');
const { tokensOf } = require('./units');
const { EXCLUSION_MAP, normalize } = require('./ingredients');

const POOL_TTL_MS = 60_000;
let pool = null;
let poolAt = 0;

/** Le ricette in classifica, lette tutte e tenute in memoria un minuto. */
async function rankedPool() {
  if (pool && Date.now() - poolAt < POOL_TTL_MS) return pool;
  const snap = await db().collection(COLLECTIONS.catalog).where('status', '==', 'ranked').get();
  pool = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  poolAt = Date.now();
  return pool;
}

function invalidatePool() {
  pool = null;
}

/** Quante ricette sono uscite dalla classifica, per piatto e dieta. */
async function retiredByDish() {
  const snap = await db().collection(COLLECTIONS.catalog).where('status', '==', 'retired').select('dishKey', 'diet').get();
  const counts = new Map();
  snap.forEach((doc) => {
    const { dishKey, diet } = doc.data();
    const key = `${dishKey}|${diet}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

/** Quante ricette (in classifica o candidate) esistono per piatto e dieta. */
async function coverageByDish() {
  const snap = await db()
    .collection(COLLECTIONS.catalog)
    .where('status', 'in', ['ranked', 'candidate', 'reviewing', 'seed_review'])
    .select('dishKey', 'diet')
    .get();
  const counts = new Map();
  snap.forEach((doc) => {
    const { dishKey, diet } = doc.data();
    const key = `${dishKey}|${diet}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

/**
 * Cosa ha già visto questo utente: per non ripetere piatti e per capire
 * quali tipi di ricetta tiene di più.
 */
async function userHistory(uid) {
  const snap = await db().collection(COLLECTIONS.exposures).where('uid', '==', uid).get();
  return snap.docs.map((doc) => {
    const e = doc.data();
    return {
      dishKey: e.dishKey,
      diet: e.diet,
      format: e.format,
      outcome: e.outcome || null,
      status: e.status,
      createdAt: e.createdAt && e.createdAt.toMillis ? e.createdAt.toMillis() : 0,
    };
  });
}

function newCatalogRef() {
  return db().collection(COLLECTIONS.catalog).doc();
}

function exposureRef(id) {
  return db().collection(COLLECTIONS.exposures).doc(id);
}

function emptyStats() {
  const group = { views: 0, keeps: 0, stars: 0, reuses: 0 };
  return {
    views: 0, keeps: 0, passes: 0, stars: 0, reuses: 0,
    groups: { vegan: { ...group }, vegetarian: { ...group }, pescatarian: { ...group } },
  };
}

function validTranslation(entry, t) {
  const steps = entry.recipe.steps || [];
  if (!t || !t.title || !Array.isArray(t.steps) || t.steps.length !== steps.length) return false;
  if (!Array.isArray(t.ingredients) || t.ingredients.length !== (entry.recipe.ingredients || []).length) return false;
  return steps.every((s, i) => tokensOf(s).join('|') === tokensOf(t.steps[i]).join('|'));
}

/**
 * Traduce le ricette che non hanno ancora la lingua richiesta. Le nuove
 * (non ancora salvate) ricevono la traduzione nell'oggetto; quelle già nel
 * ricettario la ricevono anche su Firestore, così si paga una volta sola.
 */
async function ensureTranslations(entries, lang) {
  if (lang === 'en') return;
  const missing = entries.filter((e) => !(e.translations && e.translations[lang]));
  if (!missing.length) return;
  let result;
  try {
    result = await generateJSON({
      prompt: buildTranslatePrompt(lang, missing),
      schema: translateSchema,
      temperature: 0.2,
      thinkingLevel: 'LOW',
      label: 'catalog-translate',
    });
  } catch (e) {
    console.warn('[catalog] traduzione fallita, resta in inglese:', e.message);
    return;
  }
  const byId = new Map((result.recipes || []).map((r) => [r.id, r]));
  const writes = [];
  for (const entry of missing) {
    const t = byId.get(entry.id);
    if (!validTranslation(entry, t)) {
      console.warn(`[catalog] traduzione ${lang} scartata per ${entry.id}`);
      continue;
    }
    const value = { title: t.title, oneLiner: t.oneLiner, cuisine: t.cuisine, ingredients: t.ingredients, steps: t.steps };
    entry.translations = { ...(entry.translations || {}), [lang]: value };
    if (entry.saved) {
      writes.push(db().collection(COLLECTIONS.catalog).doc(entry.id).update({ [`translations.${lang}`]: value }).catch(() => {}));
    }
  }
  await Promise.all(writes);
}

/**
 * Esclusioni scritte a mano ("peperoni", "Pilze") → parole inglesi.
 * Quelle del quiz sono già mappate nel codice e non costano nulla.
 */
async function translateExclusions(exclusions = []) {
  const free = [...new Set(exclusions.map(normalize).filter((e) => e && !EXCLUSION_MAP[e]))];
  if (!free.length) return {};
  const id = (term) => crypto.createHash('sha1').update(term).digest('hex').slice(0, 20);
  const col = db().collection(COLLECTIONS.terms);
  const snaps = await db().getAll(...free.map((t) => col.doc(id(t))));
  const out = {};
  const unknown = [];
  snaps.forEach((snap, i) => {
    if (snap.exists) out[free[i]] = snap.get('english') || [];
    else unknown.push(free[i]);
  });
  if (unknown.length) {
    try {
      const result = await generateJSON({
        prompt: buildTermsPrompt(unknown),
        schema: termsSchema,
        temperature: 0.1,
        thinkingLevel: 'LOW',
        label: 'catalog-terms',
      });
      const batch = db().batch();
      for (const row of result.terms || []) {
        const key = normalize(row.input);
        if (!unknown.includes(key)) continue;
        out[key] = (row.english || []).map(normalize).filter(Boolean);
        batch.set(col.doc(id(key)), { input: key, english: out[key], createdAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();
    } catch (e) {
      console.warn('[catalog] esclusioni non tradotte:', e.message);
    }
  }
  return out;
}

/**
 * Account cancellato: le ricette restano nel ricettario (i voti sono
 * anonimi), ma nulla deve più ricondurre a quella persona.
 */
async function forgetUser(uid) {
  const [exposures, created] = await Promise.all([
    db().collection(COLLECTIONS.exposures).where('uid', '==', uid).get(),
    db().collection(COLLECTIONS.catalog).where('createdBy', '==', uid).select().get(),
  ]);
  const refs = [
    ...exposures.docs.map((d) => [d.ref, { uid: null, root: null, runId: null, status: 'closed', outcome: d.get('outcome') || 'gone' }]),
    ...created.docs.map((d) => [d.ref, { createdBy: null }]),
  ];
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db().batch();
    for (const [ref, patch] of refs.slice(i, i + 400)) batch.update(ref, patch);
    await batch.commit();
  }
  await db().collection(COLLECTIONS.users).doc(uid).delete();
  return refs.length;
}

module.exports = {
  forgetUser,
  rankedPool,
  invalidatePool,
  coverageByDish,
  retiredByDish,
  userHistory,
  newCatalogRef,
  exposureRef,
  emptyStats,
  ensureTranslations,
  translateExclusions,
};
