// Una volta sola: rifà la copertina delle ricette salvate PRIMA che Gemini la scegliesse
// (prima era il primo fotogramma del post, da cui spesso non si capiva il piatto).
// Gira sul server perché serve il video (RapidAPI). Una ricetta alla volta, con calma.
// Ogni ricetta trattata prende `coverAuto` ('done' | 'kept'): se il server riparte a metà
// riprende da dove era, e a lavoro finito non trova più niente da fare.
const { db, FieldValue } = require('./firebase');
const { runWith } = require('./usage');
const { keys } = require('../config/keys');
const { resolve, detectPlatform } = require('../services/social-video');
const { buildSmartCover } = require('./step-frames');

// Le ricette importate da qui in poi hanno già la copertina scelta all'import.
const BEFORE = Date.parse('2026-11-28T03:30:00Z');
const PAUSE_MS = 4000;
const ownPhoto = (url) => /%2Fphotos%2F|\/photos\//.test(String(url || ''));

async function run() {
  const snap = await db().collectionGroup('savedRecipes').get();
  const todo = snap.docs.filter((d) => {
    const r = d.data();
    const at = r.createdAt?.toMillis?.() || 0;
    return r.sourceUrl && !r.coverAuto && r.status !== 'importing' && r.status !== 'failed'
      && at < BEFORE && detectPlatform(r.sourceUrl) !== 'unknown' && !ownPhoto(r.imageUrl);
  });
  if (!todo.length) return;
  console.log(`[cover-backfill] ${todo.length} ricette da rifare`);
  const byUrl = new Map(); // lo stesso video salvato da più persone si legge una volta
  let done = 0; let kept = 0;
  for (const d of todo) {
    const r = d.data();
    const uid = d.ref.parent.parent.id;
    const url = r.sourceUrl.split('?')[0];
    try {
      if (!byUrl.has(url)) {
        byUrl.set(url, await runWith(uid, 'web.cover', async () => {
          const post = await resolve(r.sourceUrl);
          const videoUrl = (post.videoUrls || [])[0];
          return videoUrl ? buildSmartCover({ videoUrl, key: `b-${d.id}`, title: r.title }) : null;
        }));
        await new Promise((ok) => setTimeout(ok, PAUSE_MS));
      }
      const cover = byUrl.get(url);
      await d.ref.set({
        ...(cover ? { imageUrl: cover, coverBefore: r.imageUrl || null } : {}),
        coverAuto: cover ? 'done' : 'kept',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      cover ? done++ : kept++;
      console.log(`[cover-backfill] ${r.title}: ${cover ? 'nuova copertina' : 'resta quella di prima'}`);
    } catch (e) {
      // Un errore può essere passeggero (il servizio dei video occupato): un secondo tentativo
      // al prossimo avvio, poi basta.
      const again = !(r.coverTries >= 1);
      await d.ref.set({ coverTries: FieldValue.increment(1), ...(again ? {} : { coverAuto: 'kept' }) }, { merge: true }).catch(() => {});
      if (!again) kept++;
      console.warn(`[cover-backfill] ${r.title}: ${e.message}`);
    }
  }
  console.log(`[cover-backfill] finito: ${done} nuove, ${kept} lasciate com'erano`);
}

/** All'avvio del server, dopo un minuto (che gli import veri non aspettino). */
function start() {
  // Senza la chiave per scaricare i video (in locale) non si parte: segnerebbe tutto come fallito.
  if (!keys.rapidApi.apiKey) return;
  setTimeout(() => run().catch((e) => console.error('[cover-backfill]', e.message)), 60000);
}

module.exports = { start, run };
