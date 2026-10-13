// Pubblica firestore.rules e storage.rules dal repo, che restano la
// fonte di verità: copiarle a mano dalla chat o dalla console porta a
// versioni troncate e a permessi che sembrano casuali.
// Uso: npm run deploy:rules
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const { keys } = require('../config/keys');

const PROJECT = (keys.firebase.serviceAccount || {}).project_id;
const DATABASE = keys.firebase.databaseId || '(default)';
const BUCKET = keys.firebase.storageBucket;

const TARGETS = [
  { file: 'firestore.rules', release: `cloud.firestore/${DATABASE}` },
  { file: 'storage.rules', release: `firebase.storage/${BUCKET}` },
];

async function main() {
  if (!PROJECT) throw new Error('Service account mancante nel .env');
  const auth = new GoogleAuth({
    credentials: keys.firebase.serviceAccount,
    scopes: ['https://www.googleapis.com/auth/firebase'],
  });
  const client = await auth.getClient();
  const base = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;

  for (const target of TARGETS) {
    const content = fs.readFileSync(path.join(__dirname, '..', target.file), 'utf8');

    const ruleset = await client.request({
      url: `${base}/rulesets`,
      method: 'POST',
      data: { source: { files: [{ name: target.file, content }] } },
    });

    const releaseName = `projects/${PROJECT}/releases/${target.release}`;
    const body = { release: { name: releaseName, rulesetName: ruleset.data.name } };
    try {
      await client.request({ url: `https://firebaserules.googleapis.com/v1/${releaseName}`, method: 'PATCH', data: body });
    } catch (e) {
      // Prima pubblicazione: il release non esiste ancora.
      if (e.response && e.response.status === 404) {
        await client.request({ url: `${base}/releases`, method: 'POST', data: body.release });
      } else {
        throw e;
      }
    }
    console.log(`  pubblicate ${target.file} su ${target.release}`);
  }
}

main().catch((e) => {
  const detail = e.response && e.response.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message;
  console.error('deploy fallito:', detail);
  process.exit(1);
});
