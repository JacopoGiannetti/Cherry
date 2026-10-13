// Cancellazione dell'account. Apple la impone (linea guida 5.1.1(v)) a
// ogni app che permetta di crearne uno, e Cherry lo fa con Sign in with
// Apple dopo l'acquisto.
//
// L'ordine conta: gli spazi condivisi vivono FUORI da users/{uid}, e le
// foto su Storage non spariscono cancellando Firestore. Per ultimo va
// l'utente Firebase, così se qualcosa fallisce a metà l'app può
// riprovare invece di restare con un account orfano.
const express = require('express');
const { db, auth, storage } = require('../lib/firebase');
const { purgeMembership } = require('../lib/spaces');
const { forgetUser } = require('../lib/catalog/store');

const router = express.Router();

// POST /account/delete — irreversibile, nessun corpo richiesto.
router.post('/delete', async (req, res) => {
  const uid = req.uid;
  try {
    const spaces = await purgeMembership(uid);
    const files = await purgeStorage(uid);
    await forgetUser(uid).catch((e) => console.error('[account] ricettario non anonimizzato:', e.message));
    await db().recursiveDelete(db().doc(`users/${uid}`));
    await auth().deleteUser(uid);
    // Un job ancora in volo può aver riscritto il ledger di uso mentre
    // cancellavamo: il documento tornerebbe a esistere vuoto.
    await db().doc(`users/${uid}`).delete().catch(() => {});

    console.log(`[account] ${uid} cancellato — spazi: ${spaces}, file: ${files}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[account/delete]', e);
    res.status(500).json({ error: 'delete_failed', details: e.message });
  }
});

/** Foto dei menu e screenshot: stanno su Storage, non su Firestore. */
async function purgeStorage(uid) {
  try {
    const [files] = await storage().bucket().getFiles({ prefix: `users/${uid}/` });
    await Promise.all(files.map((file) => file.delete().catch(() => {})));
    return files.length;
  } catch (e) {
    console.error('[account] pulizia Storage fallita:', e.message);
    return 0;
  }
}

module.exports = router;
