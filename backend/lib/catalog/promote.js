// Una candidata entra in classifica al primo like, dopo il critico.
// Lì la foto passa da fal (link temporaneo) al nostro Storage.
const crypto = require('crypto');
const axios = require('axios');
const { FieldValue } = require('firebase-admin/firestore');
const { db, bucket, COLLECTIONS } = require('./deps');
const { keys } = require('../../config/keys');
const { generateJSON } = require('../../services/gemini');
const { buildCriticPrompt, criticSchema } = require('../../prompts/catalog');
const { problemsOf, toEntry } = require('./generate');
const atlas = require('./atlas');
const { invalidatePool } = require('./store');

/** Il giudizio del critico, con la ricetta corretta già controllata nel codice. */
async function critique(entry) {
  const dish = atlas.dish(entry.dishKey);
  const review = await generateJSON({
    prompt: buildCriticPrompt({ recipe: entry.recipe, dish, diet: entry.diet }),
    schema: criticSchema,
    temperature: 0.2,
    model: keys.catalog.criticModel || undefined,
    label: 'catalog-critic',
  });
  const out = {
    verdict: review.verdict === 'pass' || review.verdict === 'fix' ? review.verdict : 'reject',
    score: Number(review.score) || 0,
    issues: (review.issues || []).slice(0, 8),
    recipe: entry.recipe,
  };
  if (out.verdict === 'fix') {
    const brief = { diet: entry.diet, dish: dish || { name: entry.recipe.title, cuisine: entry.cuisine } };
    const problem = review.fixed ? problemsOf(review.fixed, brief, { rules: [], appliances: [] }) : 'no fixed recipe';
    if (problem || !dish) {
      out.verdict = 'reject';
      out.issues.push(`correzione non valida: ${problem || 'piatto non in atlante'}`);
    } else {
      out.recipe = toEntry(review.fixed, brief, {}).recipe;
    }
  }
  return out;
}

/** Copia la foto nel bucket e ritorna un URL stabile; null se non riesce. */
async function persistImage(id, url) {
  if (!url || url.includes('firebasestorage.googleapis.com')) return url || null;
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    const b = bucket();
    const path = `catalog/${id}.jpg`;
    const token = crypto.randomUUID();
    await b.file(path).save(Buffer.from(response.data), {
      contentType: 'image/jpeg',
      metadata: { cacheControl: 'public, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
    });
    return `https://firebasestorage.googleapis.com/v0/b/${b.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  } catch (e) {
    console.warn(`[catalog] foto non copiata per ${id}:`, e.message);
    return null;
  }
}

/** Primo like su una candidata: critico, foto, classifica. Mai bloccante. */
async function promote(id) {
  const ref = db().collection(COLLECTIONS.catalog).doc(id);
  const entry = await db().runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists || snap.get('status') !== 'candidate') return null;
    t.update(ref, { status: 'reviewing', firstLikeAt: FieldValue.serverTimestamp() });
    return { id, ...snap.data() };
  });
  if (!entry) return;

  try {
    const review = await critique(entry);
    const changed = review.recipe !== entry.recipe;
    const critic = { verdict: review.verdict, score: review.score, issues: review.issues, at: new Date().toISOString() };
    if (review.verdict === 'reject') {
      await ref.update({ status: 'rejected', critic, updatedAt: FieldValue.serverTimestamp() });
      console.log(`[catalog] ${id} scartata dal critico: ${review.issues.join(' | ')}`);
      return;
    }
    const imageUrl = (await persistImage(id, entry.imageUrl)) || entry.imageUrl;
    await ref.update({
      status: 'ranked',
      critic,
      recipe: review.recipe,
      ...(changed ? { translations: {}, previousRecipe: entry.recipe } : {}),
      imageUrl,
      imageUrls: FieldValue.arrayUnion(...[entry.imageUrl, imageUrl].filter(Boolean)),
      promotedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    invalidatePool();
    console.log(`[catalog] ${id} in classifica (${review.verdict}, ${review.score}/10)`);
  } catch (e) {
    console.warn(`[catalog] promozione di ${id} fallita, torna candidata:`, e.message);
    await ref.update({ status: 'candidate' }).catch(() => {});
  }
}

module.exports = { promote, critique, persistImage };
