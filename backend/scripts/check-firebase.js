// Verifica che il progetto Firebase sia pronto: credenziali, Firestore,
// Storage, Authentication. Uso: npm run check:firebase
require('dotenv').config();
const fb = require('../lib/firebase');

const ok = (s) => `  OK    ${s}`;
const ko = (s) => `  MANCA ${s}`;

async function main() {
  if (!fb.isReady()) {
    console.log(ko('service account — FIREBASE_SERVICE_ACCOUNT_JSON assente nel .env'));
    process.exit(1);
  }
  console.log(ok('service account caricato'));

  const ref = fb.db().collection('_healthcheck').doc('backend');
  try {
    await ref.set({ at: fb.FieldValue.serverTimestamp() });
    await ref.delete();
    console.log(ok('Firestore — scrittura e cancellazione riuscite'));
  } catch (e) {
    console.log(ko(`Firestore — ${e.message.split('.')[0]}`));
    console.log('        Console Firebase > Firestore Database > Crea database');
  }

  try {
    const bucket = fb.storage().bucket();
    const [exists] = await bucket.exists();
    console.log(exists ? ok(`Storage — bucket ${bucket.name}`) : ko(`Storage — bucket ${bucket.name} inesistente`));
  } catch (e) {
    console.log(ko(`Storage — ${e.message}`));
  }

  try {
    await fb.auth().listUsers(1);
    console.log(ok('Authentication attivo'));
  } catch (e) {
    console.log(ko('Authentication non inizializzato'));
    console.log('        Console Firebase > Authentication > Inizia, poi abilita Anonimo e Apple');
  }
}

main().catch((e) => {
  console.error('Errore inatteso:', e.message);
  process.exit(1);
});
