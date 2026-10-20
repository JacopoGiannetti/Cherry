// Recupero delle foto salvate coi link temporanei (fal, copertine dei
// social) prima che il backend le copiasse su Storage.
//
// Uso:
//   node scripts/persist-images.js                 prova a secco: conta e basta
//   node scripts/persist-images.js --apply         copia su Storage e aggiorna i documenti
//   node scripts/persist-images.js --apply --regenerate
//        in più: per le ricette salvate con la foto ormai scaduta, una
//        foto nuova da fal (costa come una generazione normale)
//
// Copertina scaduta di un post: se ne chiede una nuova al social (RapidAPI).
// Si può rilanciare: i file hanno un path fisso e quelli già copiati si riusano.
require('dotenv').config();
const crypto = require('crypto');
const fb = require('../lib/firebase');
const { persistImage, isPersisted } = require('../services/storage');
const { resolve, detectPlatform } = require('../services/social-video');
const { generateRecipeImage } = require('../services/fal-image');
const { previewId } = require('../lib/inbox-preview');

const apply = process.argv.includes('--apply');
const regenerate = process.argv.includes('--regenerate');

const stats = { seen: 0, kept: 0, refreshed: 0, regenerated: 0, lost: 0 };
const done = new Map();

const isRemote = (url) => typeof url === 'string' && url.startsWith('http') && !isPersisted(url);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** URL stabile per un'immagine remota, o null se non è più raggiungibile. */
async function keep(url, path) {
  if (done.has(url)) return done.get(url);
  const result = apply
    ? await persistImage(url, path).catch(() => null)
    : (await reachable(url)) ? url : null;
  done.set(url, result);
  return result;
}

async function reachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Copertina di un post: il link salvato, o uno nuovo chiesto al social. */
async function keepThumbnail(thumbnail, sourceUrl) {
  const path = sourceUrl ? `thumbnails/${previewId(sourceUrl)}` : `thumbnails/${sha(thumbnail)}`;
  const kept = await keep(thumbnail, path);
  if (kept) return { url: kept, how: 'kept' };
  if (!sourceUrl || detectPlatform(sourceUrl) === 'unknown') return null;
  if (!apply) return { url: null, how: 'refreshed' };
  const fresh = await resolve(sourceUrl).catch(() => null);
  if (!fresh?.thumbnail) return null;
  const url = await persistImage(fresh.thumbnail, path).catch(() => null);
  return url ? { url, how: 'refreshed' } : null;
}

async function keepRecipePhoto(url) {
  const kept = await keep(url, `recipe-images/${sha(url)}.jpg`);
  return kept ? { url: kept, how: 'kept' } : null;
}

function count(result) {
  if (!result) stats.lost += 1;
  else stats[result.how] += 1;
}

async function savedRecipes(db) {
  const snap = await db.collectionGroup('savedRecipes').get();
  for (const doc of snap.docs) {
    const r = doc.data();
    if (!isRemote(r.imageUrl)) continue;
    stats.seen += 1;
    let result = r.origin === 'imported'
      ? await keepThumbnail(r.imageUrl, r.sourceUrl)
      : await keepRecipePhoto(r.imageUrl);
    if (!result && regenerate && r.origin !== 'imported') {
      const url = apply ? await generateRecipeImage({ title: r.title, cuisine: r.cuisine }) : null;
      result = { url, how: 'regenerated' };
    }
    count(result);
    if (apply && result?.url) await doc.ref.update({ imageUrl: result.url });
  }
}

async function runRecipes(db) {
  const snap = await db.collectionGroup('recipes').get();
  for (const doc of snap.docs) {
    if (!doc.ref.path.includes('/runs/')) continue;
    const r = doc.data();
    if (!isRemote(r.imageUrl)) continue;
    stats.seen += 1;
    const result = await keepRecipePhoto(r.imageUrl);
    count(result);
    if (apply && result?.url) await doc.ref.update({ imageUrl: result.url });
  }
}

async function swaps(db) {
  const snap = await db.collectionGroup('swaps').get();
  for (const doc of snap.docs) {
    const s = doc.data();
    const update = {};
    if (isRemote(s.source?.thumbnail)) {
      stats.seen += 1;
      const result = await keepThumbnail(s.source.thumbnail, s.source.url);
      count(result);
      if (result?.url) update['source.thumbnail'] = result.url;
    }
    if (isRemote(s.finalRecipe?.imageUrl)) {
      stats.seen += 1;
      const result = await keepRecipePhoto(s.finalRecipe.imageUrl);
      count(result);
      if (result?.url) update['finalRecipe.imageUrl'] = result.url;
    }
    if (apply && Object.keys(update).length) await doc.ref.update(update);
  }
}

async function inboxPreviews(db) {
  const snap = await db.collectionGroup('inboxPreviews').get();
  for (const doc of snap.docs) {
    const p = doc.data();
    if (!isRemote(p.thumbnail)) continue;
    stats.seen += 1;
    const result = await keepThumbnail(p.thumbnail, p.url);
    count(result);
    if (apply && result?.url) await doc.ref.update({ thumbnail: result.url });
  }
}

(async () => {
  const db = fb.db();
  console.log(apply ? 'Copia su Storage in corso…' : 'Prova a secco (aggiungi --apply per scrivere)');
  await savedRecipes(db);
  await runRecipes(db);
  await swaps(db);
  await inboxPreviews(db);
  console.log(`foto con link temporaneo: ${stats.seen}`);
  console.log(`  ancora raggiungibili${apply ? ' e copiate' : ''}: ${stats.kept}`);
  console.log(`  copertine da richiedere al social: ${stats.refreshed}`);
  if (regenerate) console.log(`  rigenerate: ${stats.regenerated}`);
  console.log(`  perse: ${stats.lost}${regenerate ? '' : ' (le ricette salvate si possono rigenerare con --regenerate)'}`);
  process.exit(0);
})().catch((e) => {
  console.error('errore:', e.message);
  process.exit(1);
});
