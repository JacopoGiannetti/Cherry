// Spazi condivisi: creazione, ingresso con codice, uscita, e il push
// che tiene allineata la Live Activity dell'altra persona.
//
// A differenza del resto del backend queste rotte NON sono job: sono
// operazioni istantanee e l'app ha bisogno della risposta subito (il
// codice da mostrare, l'errore "codice sbagliato" da leggere).
const express = require('express');
const { db, FieldValue } = require('../lib/firebase');
const {
  createSpace,
  joinSpace,
  leaveSpace,
  renameSpace,
  requireMembership,
} = require('../lib/spaces');
const { updateLiveActivity, startLiveActivity, isConfigured } = require('../services/apns');

const router = express.Router();

/** Le rotte spazi rispondono subito: qui si traduce l'errore in HTTP. */
function handle(res, work) {
  Promise.resolve()
    .then(work)
    .then((result) => res.json({ ok: true, ...(result || {}) }))
    .catch((e) => {
      const code = e.code || 'internal';
      const status = code === 'internal' ? 500 : 400;
      if (status === 500) console.error('[spaces]', e);
      res.status(status).json({ error: code, details: e.userMessage || e.message });
    });
}

// POST /spaces/create  { name, displayName }
router.post('/create', (req, res) => {
  const { name, displayName } = req.body || {};
  handle(res, () => createSpace(req.uid, { name, displayName }));
});

// POST /spaces/join  { code, displayName }
router.post('/join', (req, res) => {
  const { code, displayName } = req.body || {};
  handle(res, () => joinSpace(req.uid, { code, displayName }));
});

// POST /spaces/leave  { spaceId }
router.post('/leave', (req, res) => {
  const { spaceId } = req.body || {};
  if (!spaceId) return res.status(400).json({ error: 'missing_fields', details: 'spaceId richiesto' });
  handle(res, () => leaveSpace(req.uid, spaceId));
});

// POST /spaces/rename  { spaceId, name }
router.post('/rename', (req, res) => {
  const { spaceId, name } = req.body || {};
  if (!spaceId) return res.status(400).json({ error: 'missing_fields', details: 'spaceId richiesto' });
  handle(res, () => renameSpace(req.uid, spaceId, name));
});

/**
 * POST /spaces/activity/broadcast
 * { spaceId, runId, checkedCount, totalCount, spentUsd, actorName,
 *   itemName?, listTitle?, budgetUsd? }
 *
 * Tiene allineata la Live Activity di TUTTI i membri, incluso chi ha
 * appena spuntato. La propria scheda a lock screen è spesso nata da un
 * push dell'altra persona: senza un update APNs (e senza agganciarsi a
 * quell'istanza in app) resta ferma, mentre il partner vede il numero
 * giusto. L'alert resta solo sulla nascita, non su ogni spunta.
 *
 * Se qualcuno ha già la Live Activity a schermo la si aggiorna; se non
 * ce l'ha, la si fa nascere con il push-to-start — tranne chi ha fatto
 * la chiamata: quella nasce in locale con Activity.request, un secondo
 * start impilerebbe una scheda duplicata.
 */
router.post('/activity/broadcast', (req, res) => {
  const {
    spaceId, runId, checkedCount, totalCount, spentUsd,
    actorName, itemName, listTitle, budgetUsd,
  } = req.body || {};
  if (!spaceId || !runId) {
    return res.status(400).json({ error: 'missing_fields', details: 'spaceId e runId richiesti' });
  }

  handle(res, async () => {
    const { space } = await requireMembership(req.uid, spaceId);
    if (!isConfigured()) return { delivered: 0, reason: 'apns_not_configured' };

    const members = space.memberUids || [];
    if (!members.length) return { delivered: 0 };

    const contentState = {
      checkedCount: Number(checkedCount) || 0,
      totalCount: Number(totalCount) || 0,
      spentUsd: Number(spentUsd) || 0,
      lastActorName: actorName || null,
      lastItemName: itemName || null,
    };
    // Un banner per ogni spunta trasformava una spesa in una raffica di
    // notifiche: la Live Activity esiste apposta per raccontare il
    // progresso in silenzio. Si avvisa solo quando la spesa parte —
    // cioè quando non c'è un articolo appena preso.
    const announcement = {
      title: `${actorName || 'Someone'} started the shopping`,
      body: space.name || 'Shared list',
    };
    const alert = itemName ? null : announcement;
    const attributes = {
      runId,
      budgetUsd: Number(budgetUsd) || 0,
      listTitle: listTitle || 'Shared list',
      spaceName: space.name || null,
      spaceId,
    };

    // "Jacopo ha preso il latte" è una notizia per l'altra persona, non
    // per Jacopo: a chi ha spuntato resta il solo conteggio. L'app si
    // guarda già da sé dal raccontarsi le proprie mosse, ma un push
    // scavalca quel controllo — anche sulle versioni già sullo Store.
    const own = { ...contentState, lastActorName: null, lastItemName: null };

    const results = await Promise.all(
      members.map((uid) => {
        const isCaller = uid === req.uid;
        return deliver(uid, {
          runId,
          contentState: isCaller ? own : contentState,
          alert: isCaller ? null : alert,
          announcement,
          attributes,
          allowStart: !isCaller,
        });
      })
    );
    return { delivered: results.filter(Boolean).length };
  });
});

// Un push-to-start non aggiorna niente: fa NASCERE una Live Activity
// nuova. Il token per aggiornarla lo consegna ActivityKit all'app, e
// l'app lo registra solo se è viva: a telefono bloccato può passare
// tutta la spesa prima che arrivi. Ripetere lo start a ogni spunta, in
// quella finestra, impila una scheda per articolo — che è esattamente
// il "arrivano tantissime notifiche" invece di una Live Activity sola.
const START_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Un membro, un push: aggiornamento se la Live Activity esiste già,
 * altrimenti avvio da zero — ma una volta sola per lista.
 */
async function deliver(uid, { runId, contentState, alert, announcement, attributes, allowStart = true }) {
  const liveRef = db().doc(`users/${uid}/liveActivities/${runId}`);
  const liveSnap = await liveRef.get();
  const live = liveSnap.exists ? liveSnap.data() : null;

  if (live && live.token) {
    const result = await updateLiveActivity({ token: live.token, contentState, alert });
    if (result.ok) return true;
    // Token morto: l'attività non c'è più su quel telefono. Si scarta
    // il token ma si tiene memoria dello start, altrimenti chi ha
    // chiuso la Live Activity se la ritrova addosso alla spunta dopo.
    if (result.status === 410 || result.reason === 'BadDeviceToken') {
      await liveRef.set({ token: FieldValue.delete() }, { merge: true }).catch(() => {});
    } else {
      return false;
    }
  }

  if (!allowStart) return false;

  const startedAt =
    live && live.startedAt && typeof live.startedAt.toMillis === 'function'
      ? live.startedAt.toMillis()
      : 0;
  if (Date.now() - startedAt < START_COOLDOWN_MS) return false;

  const startRef = db().doc(`users/${uid}/liveActivityStart/current`);
  const startSnap = await startRef.get();
  if (!startSnap.exists || !startSnap.data().token) return false;

  const started = await startLiveActivity({
    token: startSnap.data().token,
    attributes,
    contentState,
    // La nascita è l'unico momento in cui vale la pena farsi sentire.
    alert: announcement,
  });
  if (started.ok) {
    await liveRef.set({ runId, startedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
  } else if (started.status === 410 || started.reason === 'BadDeviceToken') {
    await startRef.delete().catch(() => {});
  }
  return started.ok;
}

module.exports = router;
