// ============================================================
// UNICO punto del backend che legge le chiavi.
// I valori arrivano da `.env` in locale o dalle Environment
// Variables su Render. Nessun altro file deve toccare process.env.
// ============================================================
require('dotenv').config();

const fs = require('fs');
const nodePath = require('path');

/**
 * Chiave APNs (.p8) per aggiornare le Live Activity da remoto: si può
 * incollare inline nel .env (con \n al posto degli a capo) o tenerla
 * su disco.
 */
function readApnsKey() {
  const inline = process.env.APNS_KEY_P8;
  if (inline && inline.trim()) return inline.replace(/\\n/g, '\n');

  const configured = process.env.APNS_KEY_PATH;
  if (!configured) return '';
  // Il path nel .env è relativo alla cartella del backend: risolverlo
  // qui evita che la chiave "sparisca" avviando il server da altrove.
  const full = nodePath.isAbsolute(configured)
    ? configured
    : nodePath.resolve(__dirname, '..', configured);
  if (!fs.existsSync(full)) {
    console.warn('[keys] chiave APNs non trovata in', full);
    return '';
  }
  try {
    return fs.readFileSync(full, 'utf8');
  } catch (e) {
    console.error('[keys] Impossibile leggere la chiave APNs da', full, e.message);
    return '';
  }
}

function readServiceAccount() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline && inline.trim()) {
    try {
      return JSON.parse(inline);
    } catch (e) {
      console.error('[keys] FIREBASE_SERVICE_ACCOUNT_JSON non è JSON valido:', e.message);
      return null;
    }
  }
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && fs.existsSync(path)) {
    try {
      return JSON.parse(fs.readFileSync(path, 'utf8'));
    } catch (e) {
      console.error('[keys] Impossibile leggere il service account da', path, e.message);
      return null;
    }
  }
  return null;
}

const keys = {
  firebase: {
    serviceAccount: readServiceAccount(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    // Progetto GCP dove vive Firestore (Firebase "Cherry"). Senza, ADC
    // usa il progetto del servizio e il database "cherry" non c'è: NOT_FOUND.
    projectId: process.env.FIREBASE_PROJECT_ID || 'cherry-662ac',
    // Nome del database Firestore. Vuoto = "(default)".
    databaseId: process.env.FIREBASE_DATABASE_ID || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  },
  fal: {
    apiKey: process.env.FAL_KEY || '',
  },
  rapidApi: {
    apiKey: process.env.RAPIDAPI_KEY || '',
    socialHost: 'social-download-all-in-one.p.rapidapi.com',
    socialPath: '/v1/social/autolink',
  },
  superwall: {
    webhookSecret: process.env.SUPERWALL_WEBHOOK_SECRET || '',
  },
  apns: {
    keyId: process.env.APNS_KEY_ID || '',
    teamId: process.env.APNS_TEAM_ID || '',
    privateKey: readApnsKey(),
    bundleId: process.env.APNS_BUNDLE_ID || 'com.cherry.jacopogiannetti.app',
    // Le build da Xcode usano l'ambiente sandbox; TestFlight e App
    // Store quello di produzione.
    production: String(process.env.APNS_PRODUCTION || '').toLowerCase() === 'true',
  },
  // Ricettario condiviso e classifica. Spento di default: il server di
  // produzione resta sul flusso di prima finché non lo si accende.
  catalog: {
    enabled: String(process.env.CATALOG_ENABLED || '').toLowerCase() === 'true',
    // Il passaggio periodico che chiude i voti rimasti aperti. Con due
    // server sullo stesso database deve girare su uno solo.
    sweep: String(process.env.CATALOG_SWEEP || 'true').toLowerCase() !== 'false',
    // Vuoto = stesso modello delle ricette.
    criticModel: process.env.CATALOG_CRITIC_MODEL || '',
  },
  hmacSecret: process.env.HMAC_SECRET || '',
  appsFlyer: {
    // Opzionale: l'app la pesca da GET /config. Vuota = SDK spento.
    // La metti su Render quando hai l'account, senza un update dell'app.
    devKey: process.env.APPSFLYER_DEV_KEY || '',
    appleAppID: process.env.APPLE_APP_ID || '',
  },
  openFoodFacts: {
    userAgent: process.env.OFF_USER_AGENT || 'Vego/1.0',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    dailyJobLimit: parseInt(process.env.DAILY_JOB_LIMIT || '100', 10),
    dailyImageLimit: parseInt(process.env.DAILY_IMAGE_LIMIT || '60', 10),
    // Override opzionali dei prezzi usati dal ledger usage (default in lib/usage.js).
    // GEMINI_INPUT_USD_PER_MILLION / GEMINI_OUTPUT_USD_PER_MILLION
    // FAL_USD_PER_IMAGE  RAPIDAPI_USD_PER_CALL
  },
};

/** Elenco leggibile di cosa manca, per il log di avvio e /health. */
function missingKeys() {
  const missing = [];
  if (!keys.firebase.serviceAccount) missing.push('FIREBASE_SERVICE_ACCOUNT_JSON (o _PATH)');
  if (!keys.firebase.storageBucket) missing.push('FIREBASE_STORAGE_BUCKET');
  if (!keys.gemini.apiKey) missing.push('GEMINI_API_KEY');
  if (!keys.fal.apiKey) missing.push('FAL_KEY');
  if (!keys.rapidApi.apiKey) missing.push('RAPIDAPI_KEY');
  if (!keys.hmacSecret) missing.push('HMAC_SECRET');
  return missing;
}

/** Chiavi non indispensabili: senza, l'app funziona con una capacità in meno. */
function optionalMissingKeys() {
  const missing = [];
  if (!keys.superwall.webhookSecret) {
    missing.push('SUPERWALL_WEBHOOK_SECRET (lo stato abbonamento su Firestore non viene aggiornato dal server)');
  }
  if (!keys.apns.privateKey || !keys.apns.keyId || !keys.apns.teamId) {
    missing.push('APNS_KEY_P8 + APNS_KEY_ID + APNS_TEAM_ID (le Live Activity condivise non si aggiornano a schermo bloccato)');
  }
  if (!keys.appsFlyer.devKey) {
    missing.push('APPSFLYER_DEV_KEY (attribution spenta finché non la metti; l\'app la legge da /config)');
  }
  if (!keys.appsFlyer.appleAppID) {
    missing.push('APPLE_APP_ID (numero App Store Connect, senza "id"; serve ad AppsFlyer insieme alla dev key)');
  }
  return missing;
}

module.exports = { keys, missingKeys, optionalMissingKeys };
