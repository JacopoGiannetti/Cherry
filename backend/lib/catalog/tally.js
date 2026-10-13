// I voti del ricettario. Non arrivano dall'app: si leggono dalle run.
// Ogni swipe si conta appena l'app avvisa il server: vista più tenuta o
// scarto. Le carte mai toccate si chiudono senza contare nulla quando
// la lista è fatta (o dopo una settimana).
// Stelle e riusi si leggono dalle ricette salvate e dalle liste fatte
// con le ricette salvate, riconosciute dalla foto.
const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const { db, COLLECTIONS } = require('./deps');
const { getParams } = require('./params');
const { invalidatePool } = require('./store');
const { promote } = require('./promote');

const DEBOUNCE_MS = 5_000;
const OPEN_THROTTLE_MS = 6 * 3600_000;
const timers = new Map();
const lastOpen = new Map();

function millis(ts) {
  return ts && ts.toMillis ? ts.toMillis() : 0;
}

/**
 * Incrementi raccolti per ricetta, scritti alla fine in un batch.
 * Oggetti annidati e non chiavi col punto: `set` con merge prende
 * "stats.views" come nome di un campo, non come percorso.
 */
function collector() {
  const byId = new Map();
  const counts = {
    add(catalogId, field, diet, n = 1) {
      if (!catalogId || !n) return;
      const c = byId.get(catalogId) || { totals: {}, groups: {} };
      c.totals[field] = (c.totals[field] || 0) + n;
      if (diet) {
        c.groups[diet] = c.groups[diet] || {};
        c.groups[diet][field] = (c.groups[diet][field] || 0) + n;
      }
      byId.set(catalogId, c);
    },
    size: () => byId.size,
    ids: () => [...byId.keys()],
    /** [ref, dati] da scrivere con `set` e merge. */
    writes() {
      return [...byId.entries()].map(([id, c]) => {
        const stats = {};
        for (const [field, n] of Object.entries(c.totals)) stats[field] = FieldValue.increment(n);
        const groups = {};
        for (const [diet, fields] of Object.entries(c.groups)) {
          groups[diet] = {};
          for (const [field, n] of Object.entries(fields)) groups[diet][field] = FieldValue.increment(n);
        }
        if (Object.keys(groups).length) stats.groups = groups;
        return [db().collection(COLLECTIONS.catalog).doc(id), { stats, updatedAt: FieldValue.serverTimestamp() }];
      });
    },
    async commit() {
      const writes = counts.writes();
      for (let i = 0; i < writes.length; i += 400) {
        const batch = db().batch();
        for (const [ref, data] of writes.slice(i, i + 400)) batch.set(ref, data, { merge: true });
        await batch.commit();
      }
    },
  };
  return counts;
}

/**
 * I conteggi scritti prima della correzione stanno in campi chiamati
 * letteralmente "stats.views", "stats.groups.vegan.keeps"... Qui si
 * sommano nei campi veri e si cancellano, in transazione per ricetta:
 * ripetuto o lanciato da due server insieme non conta niente due volte.
 */
async function repairDottedStats() {
  const snap = await db().collection(COLLECTIONS.catalog).get();
  const broken = snap.docs.filter((doc) => Object.keys(doc.data()).some((k) => k.startsWith('stats.')));
  let fixed = 0;
  for (const doc of broken) {
    await db().runTransaction(async (t) => {
      const fresh = await t.get(doc.ref);
      if (!fresh.exists) return;
      const pairs = [];
      for (const [key, value] of Object.entries(fresh.data())) {
        if (!key.startsWith('stats.')) continue;
        const target = key.split('.');
        if (typeof value === 'number' && value !== 0 && target.every(Boolean)) {
          pairs.push(new FieldPath(...target), FieldValue.increment(value));
        }
        pairs.push(new FieldPath(key), FieldValue.delete());
      }
      if (pairs.length) t.update(doc.ref, ...pairs);
    });
    fixed += 1;
  }
  if (fixed) {
    invalidatePool();
    console.log(`[catalog] conteggi recuperati su ${fixed} ricette`);
  }
  return fixed;
}

/**
 * Conta le carte di una run. Una carta swipata si chiude e si conta
 * subito, nella stessa transazione: il voto non si perde e due trigger
 * insieme non lo contano due volte. Le carte mai toccate si chiudono
 * senza contare solo quando la run è finita o abbandonata.
 * @returns {Promise<{kept: string[], counted: string[]}>} catalogId tenuti (da promuovere) e contati
 */
async function closeRun(root, runId, exposureIds, params) {
  const runRef = db().doc(`${root}/runs/${runId}`);
  const refs = exposureIds.map((id) => db().collection(COLLECTIONS.exposures).doc(id));
  let result = { kept: [], counted: [] };

  await db().runTransaction(async (t) => {
    result = { kept: [], counted: [] };
    const [runSnap, ...snaps] = await t.getAll(runRef, ...refs);
    const open = snaps.filter((s) => s.exists && s.get('status') === 'open');
    if (!open.length) return;

    const run = runSnap.exists ? runSnap.data() : null;
    const age = run ? Date.now() - millis(run.createdAt) : Infinity;
    const live = run && (run.status === 'swiping' || run.status === 'generating') && age < params.openDays * 86400000;

    const recipeSnaps = run ? await t.getAll(...open.map((s) => runRef.collection('recipes').doc(s.id))) : [];
    let keptTotal = 0;
    recipeSnaps.forEach((r) => { if (r.exists && r.get('decision') === 'kept') keptTotal += r.get('costUsd') || 0; });
    const room = (run && run.budgetUsd ? run.budgetUsd : 0) - keptTotal;

    const counts = collector();
    open.forEach((snap, i) => {
      const e = snap.data();
      const recipe = recipeSnaps[i];
      const decision = recipe && recipe.exists ? recipe.get('decision') : null;
      let outcome;
      if (decision === 'kept' || decision === 'passed') {
        outcome = decision;
        counts.add(e.catalogId, 'views', e.userDiet);
        counts.add(e.catalogId, decision === 'kept' ? 'keeps' : 'passes', e.userDiet);
        result.counted.push(e.catalogId);
        if (decision === 'kept') result.kept.push(e.catalogId);
      } else if (live) {
        return;
      } else {
        outcome = !recipe || !recipe.exists ? 'gone' : (e.costLocal || 0) > room ? 'forced' : 'unseen';
      }
      t.update(snap.ref, { status: 'closed', outcome, closedAt: FieldValue.serverTimestamp() });
    });
    for (const [ref, data] of counts.writes()) t.set(ref, data, { merge: true });
  });

  return result;
}

/**
 * Stelle e riusi. Una ricetta salvata porta con sé l'URL della foto: è
 * così che la si riconosce, anche dall'app di oggi che non sa nulla del
 * ricettario. Una stella tolta si toglie; un riuso conta una volta per
 * persona.
 */
async function syncSignals(uid, exposures, counts) {
  const byImage = new Map();
  let userDiet = null;
  for (const e of exposures) {
    if (e.imageUrl) byImage.set(e.imageUrl, e.catalogId);
    userDiet = e.userDiet || userDiet;
  }
  if (!byImage.size) return;

  const userRef = db().collection(COLLECTIONS.users).doc(uid);
  const roots = [...new Set([`users/${uid}`, ...exposures.map((e) => e.root).filter(Boolean)])];
  const [userSnap, savedSnap, ...runSnaps] = await Promise.all([
    userRef.get(),
    db().collection(`users/${uid}/savedRecipes`).select('imageUrl').get(),
    ...roots.map((root) => db().collection(`${root}/runs`).orderBy('createdAt', 'desc').limit(15).get().catch(() => ({ docs: [] }))),
  ]);
  const runsSnap = { docs: runSnaps.flatMap((s) => s.docs) };
  const before = userSnap.exists ? userSnap.data() : {};

  const savedById = new Map();
  savedSnap.forEach((doc) => {
    const id = byImage.get(doc.get('imageUrl'));
    if (id) savedById.set(doc.id, id);
  });
  const starred = new Set(savedById.values());

  const reused = new Set(before.reused || []);
  const newlyReused = [];
  const recipeSnaps = await Promise.all(
    runsSnap.docs.map((run) => run.ref.collection('recipes').where('savedRecipeId', '!=', null).get().catch(() => ({ docs: [] })))
  );
  for (const snap of recipeSnaps) {
    for (const doc of snap.docs) {
      const id = savedById.get(doc.get('savedRecipeId')) || byImage.get(doc.get('imageUrl'));
      if (id && !reused.has(id)) {
        reused.add(id);
        newlyReused.push(id);
      }
    }
  }

  const prevStarred = new Set(before.starred || []);
  for (const id of starred) if (!prevStarred.has(id)) counts.add(id, 'stars', userDiet, 1);
  for (const id of prevStarred) if (!starred.has(id)) counts.add(id, 'stars', userDiet, -1);
  for (const id of newlyReused) counts.add(id, 'reuses', userDiet, 1);

  const changed = newlyReused.length || starred.size !== prevStarred.size || [...starred].some((id) => !prevStarred.has(id));
  if (changed) {
    await userRef.set({ starred: [...starred], reused: [...reused], updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

/** La regola di uscita di `params.retire` su una ricetta in classifica. */
function retireReason(entry, rule) {
  if (entry.status !== 'ranked' || entry.keptByHand) return null;
  const stats = entry.stats || {};
  if ((stats.stars || 0) > 0 || (stats.reuses || 0) > 0) return null;
  const views = stats.views || 0;
  const keeps = stats.keeps || 0;
  if (views >= rule.earlyViews && keeps <= rule.earlyMaxKeeps) return `${keeps} tenute su ${views} viste`;
  if (views >= rule.lateViews && keeps / views < rule.lateMinKeepRate) return `${Math.round((keeps / views) * 100)}% di tenute su ${views} viste`;
  return null;
}

/**
 * Toglie dalla classifica le ricette che non piacciono. Senza `ids`
 * guarda tutta la classifica (il passaggio periodico).
 */
async function retireLosers(ids) {
  const params = await getParams();
  const col = db().collection(COLLECTIONS.catalog);
  const docs = ids
    ? (await Promise.all([...new Set(ids)].map((id) => col.doc(id).get()))).filter((d) => d.exists)
    : (await col.where('status', '==', 'ranked').get()).docs;
  let retired = 0;
  for (const doc of docs) {
    const reason = retireReason(doc.data(), params.retire);
    if (!reason) continue;
    await doc.ref.update({
      status: 'retired',
      retiredBy: 'auto',
      retiredReason: reason,
      retiredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    retired += 1;
    console.log(`[catalog] ${doc.id} esce dalla classifica: ${reason}`);
  }
  if (retired) invalidatePool();
  return retired;
}

/** Conta tutto quello che c'è da contare per una persona. */
async function tallyUser(uid) {
  const params = await getParams();
  const snap = await db().collection(COLLECTIONS.exposures).where('uid', '==', uid).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const groups = new Map();
  for (const e of all) {
    if (e.status !== 'open') continue;
    const key = `${e.root}|${e.runId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.id);
  }
  const kept = [];
  const counted = [];
  for (const [key, ids] of groups) {
    const [root, runId] = key.split('|');
    for (let i = 0; i < ids.length; i += 200) {
      const r = await closeRun(root, runId, ids.slice(i, i + 200), params);
      kept.push(...r.kept);
      counted.push(...r.counted);
    }
  }

  const counts = collector();
  await syncSignals(uid, all, counts);
  if (counts.size()) await counts.commit();
  const touched = [...counted, ...counts.ids()];
  if (touched.length) {
    invalidatePool();
    await retireLosers(touched).catch((e) => console.warn('[catalog] uscita dalla classifica fallita:', e.message));
  }
  // Il primo like porta una candidata dal critico.
  for (const id of new Set(kept)) promote(id).catch(() => {});
}

/** Dall'app: keep, pass, lista finita, salvataggio, apertura. */
function onEvent(uid, event) {
  if (!uid) return;
  if (event === 'app.open') {
    const last = lastOpen.get(uid) || 0;
    if (Date.now() - last < OPEN_THROTTLE_MS) return;
    lastOpen.set(uid, Date.now());
  }
  clearTimeout(timers.get(uid));
  timers.set(uid, setTimeout(() => {
    timers.delete(uid);
    tallyUser(uid).catch((e) => console.warn(`[catalog] conteggio fallito per ${uid}:`, e.message));
  }, DEBOUNCE_MS));
}

/**
 * Ogni 15 minuti: chiude le carte delle run abbandonate, riprova il
 * critico sulle candidate già tenute e fa scadere quelle che nessuno ha
 * tenuto. Con `all` (all'avvio) conta anche gli swipe di tutte le run
 * aperte: gli avvisi arrivati durante un riavvio si perdono.
 */
async function sweep({ all = false } = {}) {
  await repairDottedStats().catch((e) => console.warn('[catalog] recupero conteggi fallito:', e.message));
  await retireLosers().catch((e) => console.warn('[catalog] uscita dalla classifica fallita:', e.message));
  const params = await getParams();
  const open = await db().collection(COLLECTIONS.exposures).where('status', '==', 'open').select('uid', 'createdAt').limit(2000).get();
  const cutoff = Date.now() - params.openDays * 86400000;
  const uids = new Set();
  open.forEach((doc) => { if (all || millis(doc.get('createdAt')) < cutoff) uids.add(doc.get('uid')); });
  for (const uid of uids) if (uid) await tallyUser(uid).catch((e) => console.warn('[catalog] sweep:', e.message));

  const old = Date.now() - params.candidateDays * 86400000;
  const candidates = await db().collection(COLLECTIONS.catalog).where('status', '==', 'candidate').select('createdAt', 'stats').get();
  const batch = db().batch();
  let n = 0;
  for (const doc of candidates.docs) {
    if (doc.get('stats.keeps') > 0) {
      await promote(doc.id).catch(() => {});
    } else if (millis(doc.get('createdAt')) < old && n < 400) {
      batch.update(doc.ref, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
      n += 1;
    }
  }
  if (n) await batch.commit();
}

function startSweep() {
  const run = (opts) => sweep(opts).catch((e) => console.warn('[catalog] sweep fallito:', e.message));
  setTimeout(() => run({ all: true }), 60_000);
  setInterval(run, 15 * 60_000).unref();
}

module.exports = { onEvent, tallyUser, sweep, startSweep, repairDottedStats, retireLosers, retireReason };
