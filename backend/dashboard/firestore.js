// Da dove arrivano le credenziali dipende da dove gira la dashboard.
//
// In locale: il service account nel .env del backend, lo stesso del
// server. Su Cloud Run: nessuna chiave da nessuna parte, si usa
// l'identità del servizio (Application Default Credentials). Una chiave
// dentro un'immagine è una chiave che prima o poi esce, e comunque il
// service account del backend può scrivere — questa dashboard deve solo
// leggere.
//
// Non passa da lib/firebase.js proprio per questo: quello pretende un
// service account e senza si dichiara "non pronto".
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { keys } = require('../config/keys');

let store = null;
let app = null;

// Il bucket dove Distribution tiene i file caricati e quelli generati.
// Il nome sta nel .env; senza, si ricava dal progetto Firebase, che è la
// convenzione dei progetti creati negli ultimi anni.
function bucketName() {
  return keys.firebase.storageBucket || `${keys.firebase.projectId}.firebasestorage.app`;
}

function ensureApp() {
  if (app) return app;
  const account = keys.firebase.serviceAccount;
  const projectId = keys.firebase.projectId;
  app = admin.initializeApp({
    ...(account ? { credential: admin.credential.cert(account) } : {}),
    projectId,
    storageBucket: bucketName(),
  });
  return app;
}

/** Firebase Storage: i byte dei contenuti di Distribution. */
function bucket() {
  ensureApp();
  return admin.storage().bucket();
}

function firestore() {
  if (store) return store;
  ensureApp();
  const id = keys.firebase.databaseId;
  store = id && id !== '(default)' ? getFirestore(admin.app(), id) : getFirestore(admin.app());
  return store;
}

/// Firebase Auth, per sapere con cosa è entrato ognuno. Il dato non sta
/// su Firestore: `providerData` vive solo nell'utente Auth, e leggerlo
/// da qui è l'unico modo di averlo anche per chi si è registrato prima
/// che la domanda ci venisse in mente.
function auth() {
  ensureApp();
  return admin.auth();
}

/** Per il log di avvio: sapere subito cosa sta leggendo evita mezz'ora di dubbi. */
function describe() {
  return {
    project: keys.firebase.projectId,
    database: keys.firebase.databaseId || '(default)',
    credentials: keys.firebase.serviceAccount ? 'service account da .env' : 'identità del servizio (ADC)',
  };
}

module.exports = { firestore, auth, bucket, bucketName, describe };
