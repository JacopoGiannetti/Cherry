// Autenticazione di ogni richiesta app -> backend:
// 1. HMAC-SHA256 del path firmato con il segreto condiviso (header x-signature)
// 2. Token Firebase dell'utente (header Authorization: Bearer <idToken>)
// L'uid verificato finisce in req.uid e vale come identità per tutto il resto.
const crypto = require('crypto');
const { keys } = require('../config/keys');
const { auth, isReady } = require('./firebase');

function verifyHmac(req, res, next) {
  if (!keys.hmacSecret) {
    // Chiave non ancora configurata: non blocchiamo lo sviluppo locale,
    // ma lo segnaliamo a ogni richiesta.
    console.warn('[auth] HMAC_SECRET mancante: firma non verificata');
    return next();
  }
  const signature = req.get('x-signature') || '';
  // originalUrl coincide col path firmato dall'app (/spaces/create, …)
  // indipendentemente da come Express monta i router annidati.
  const path = (req.originalUrl || req.path).split('?')[0];
  const expected = crypto
    .createHmac('sha256', keys.hmacSecret)
    .update(path)
    .digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  next();
}

async function verifyFirebaseUser(req, res, next) {
  if (!isReady()) {
    return res.status(503).json({
      error: 'backend_not_configured',
      details: 'Firebase service account mancante nel .env',
    });
  }
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'missing_token' });
  }
  try {
    const decoded = await auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token', details: e.message });
  }
}

module.exports = { verifyHmac, verifyFirebaseUser };
