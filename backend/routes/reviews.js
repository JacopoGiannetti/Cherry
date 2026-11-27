// Recensioni della web app: cinque stelle e, se vuole, due righe.
// Si monta su /v1 DOPO routes/web.js, che ha già fatto CORS e verificato il token (req.uid).
// Una recensione per account (reviews/{uid}): le stelle si salvano subito al tocco,
// il testo arriva con un secondo invio e aggiorna lo stesso documento.
// Le legge la dashboard (Cherry → Recensioni).
const express = require('express');
const { db, auth, FieldValue } = require('../lib/firebase');

const router = express.Router();
const TRIGGERS = new Set(['cook', 'visit', 'settings']);

router.post('/review', express.json({ limit: '4kb' }), async (req, res) => {
  if (!req.uid) return res.status(401).json({ error: 'unauthorized' });
  const b = req.body || {};
  const stars = Number(b.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: 'bad_stars' });
  const text = typeof b.text === 'string' ? b.text.trim().slice(0, 1200) : undefined;
  try {
    const ref = db().doc(`reviews/${req.uid}`);
    const [snap, record] = await Promise.all([ref.get(), auth().getUser(req.uid).catch(() => null)]);
    const doc = {
      uid: req.uid,
      stars,
      trigger: TRIGGERS.has(b.trigger) ? b.trigger : 'cook',
      // Mostrarla con il nome è una sua scelta, e vale solo insieme a un testo.
      allowPublic: Boolean(b.allowPublic) && Boolean(text),
      email: record?.email || null,
      name: record?.displayName || null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (text !== undefined) doc.text = text;
    if (!snap.exists) doc.createdAt = FieldValue.serverTimestamp();
    await ref.set(doc, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('[review]', e.message);
    res.status(500).json({ error: 'not_saved' });
  }
});

module.exports = router;
