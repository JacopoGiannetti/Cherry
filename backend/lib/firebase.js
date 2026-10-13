// Firebase Admin SDK: è così che il backend scrive su Firestore.
// L'Admin SDK bypassa le security rules, quindi le rules possono
// restare strette (l'app legge solo il proprio albero utente).
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { keys } = require('../config/keys');

let initialized = false;

function init() {
  if (initialized) return true;
  if (!keys.firebase.serviceAccount) return false;
  admin.initializeApp({
    credential: admin.credential.cert(keys.firebase.serviceAccount),
    storageBucket: keys.firebase.storageBucket || undefined,
  });
  initialized = true;
  return true;
}

function isReady() {
  return init();
}

// Il database del progetto si chiama "cherry", non "(default)": senza
// passarne il nome l'SDK cercherebbe un database inesistente.
function db() {
  if (!init()) throw new Error('Firebase non configurato (service account mancante)');
  const id = keys.firebase.databaseId;
  return id && id !== '(default)' ? getFirestore(admin.app(), id) : getFirestore(admin.app());
}

function auth() {
  if (!init()) throw new Error('Firebase non configurato (service account mancante)');
  return admin.auth();
}

function storage() {
  if (!init()) throw new Error('Firebase non configurato (service account mancante)');
  return admin.storage();
}

const FieldValue = admin.firestore.FieldValue;

module.exports = { isReady, db, auth, storage, FieldValue };
