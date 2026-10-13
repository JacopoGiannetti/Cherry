// Diagnostica: cosa ha davvero scritto il backend per una run.
// Uso: npm run inspect:run -- <uid> <runId>
require('dotenv').config();
const fb = require('../lib/firebase');

const [uid, runId] = process.argv.slice(2);
if (!uid) {
  console.log('Uso: node scripts/inspect-run.js <uid> [runId]');
  process.exit(1);
}

(async () => {
  const db = fb.db();

  const user = await db.doc(`users/${uid}`).get();
  console.log('utente esiste:', user.exists);

  const runs = await db.collection(`users/${uid}/runs`).get();
  console.log('run totali:', runs.size);
  for (const doc of runs.docs) {
    const d = doc.data();
    const recipes = await db.collection(`users/${uid}/runs/${doc.id}/recipes`).get();
    console.log(`  run ${doc.id} | status=${d.status} | craving=${d.craving} | servings=${d.servings} | ricette=${recipes.size}`);
  }

  const jobs = await db.collection(`users/${uid}/jobs`).orderBy('createdAt', 'desc').limit(5).get().catch(() => null);
  if (jobs) {
    console.log('ultimi job:', jobs.size);
    jobs.forEach((doc) => {
      const j = doc.data();
      console.log(`  ${doc.id} | type=${j.type} | status=${j.status} | error=${j.error || j.errorCode || '-'}`);
    });
  }
  process.exit(0);
})().catch((e) => {
  console.error('errore:', e.message);
  process.exit(1);
});
