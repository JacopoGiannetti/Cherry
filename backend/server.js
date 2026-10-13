// Vego backend — fire-and-forget: ogni endpoint avvia un lavoro,
// risponde 202 { jobId } e scrive i risultati su Firestore.
// L'app legge sempre e solo da Firestore.
const express = require('express');
const { keys, missingKeys, optionalMissingKeys } = require('./config/keys');
const { verifyHmac, verifyFirebaseUser } = require('./lib/middleware');
const { jobQuotaGate } = require('./lib/rate-limit');

const app = express();
app.use(express.json({ limit: '1mb' }));

// --- Rotte pubbliche -----------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'vego-backend',
    missingKeys: missingKeys(), // vuoto quando tutte le chiavi sono a posto
  });
});

// Chiavi pubbliche per l'SDK client. Vuote = relativa feature spenta.
// L'app le cache-a, così AppsFlyer si accende al prossimo avvio dopo
// che hai messo APPSFLYER_DEV_KEY su Render, senza un update dello store.
// Più gli interruttori della dashboard (`lib/app-config.js`).
const appConfig = require('./lib/app-config');
const { db, isReady } = require('./lib/firebase');
const REMOTE_TTL_MS = 30_000;
let remote = { value: appConfig.DEFAULTS, at: 0 };

async function remoteConfig() {
  if (Date.now() - remote.at < REMOTE_TTL_MS) return remote.value;
  try {
    if (!isReady()) return remote.value;
    const snap = await db().doc(appConfig.DOC).get();
    remote = { value: appConfig.normalize(snap.exists ? snap.data() : {}), at: Date.now() };
  } catch (e) {
    console.warn('[config] interruttori non leggibili, resta l’ultimo valore:', e.message);
  }
  return remote.value;
}

app.get('/config', async (req, res) => {
  res.json({
    appsFlyerDevKey: keys.appsFlyer.devKey,
    appleAppID: keys.appsFlyer.appleAppID,
    ...(await remoteConfig()),
  });
});

app.use('/webhooks', require('./routes/webhooks'));

// --- Rotte app (HMAC + token Firebase + quota giornaliera) ---------------
const api = express.Router();
api.use(verifyHmac, verifyFirebaseUser, jobQuotaGate);
api.use('/runs', require('./routes/runs'));
api.use('/scan', require('./routes/scan'));
api.use('/swap', require('./routes/swap'));
api.use('/grocery', require('./routes/grocery'));
app.use(api);

// Analytics client (keep/pass, onboarding): niente quota AI.
app.use('/usage', verifyHmac, verifyFirebaseUser, require('./routes/usage'));

// Spazi condivisi: risposta immediata, fuori dalla quota AI.
app.use('/spaces', verifyHmac, verifyFirebaseUser, require('./routes/spaces'));

// Cancellazione account: mai soggetta a quota, deve funzionare sempre.
app.use('/account', verifyHmac, verifyFirebaseUser, require('./routes/account'));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

const missing = missingKeys();
const optional = optionalMissingKeys();
app.listen(keys.server.port, () => {
  console.log(`Vego backend in ascolto sulla porta ${keys.server.port}`);
  if (missing.length) {
    console.warn('ATTENZIONE — chiavi mancanti nel .env:', missing.join(', '));
    console.warn('Il server risponde, ma gli endpoint che le richiedono falliranno in modo esplicito.');
  } else {
    console.log('Tutte le chiavi obbligatorie configurate.');
  }
  optional.forEach((k) => console.log('Opzionale non configurata:', k));
  if (keys.catalog.enabled) {
    console.log(`Ricettario attivo${keys.catalog.sweep ? ' (con passaggio periodico)' : ''}.`);
    const tally = require('./lib/catalog/tally');
    if (keys.catalog.sweep) tally.startSweep();
    else tally.repairDottedStats().catch((e) => console.warn('[catalog] recupero conteggi fallito:', e.message));
  }
});
