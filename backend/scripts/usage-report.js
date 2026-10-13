// Report costi/uso: un utente, oppure la media su tutti.
//   node scripts/usage-report.js
//   node scripts/usage-report.js <uid>
require('dotenv').config();
const fb = require('../lib/firebase');
const { geminiRates, falUsdPerImage, rapidUsdPerCall } = require('../lib/usage');

function money(n) {
  return `$${(Number(n) || 0).toFixed(4)}`;
}

function printUsage(label, usage) {
  if (!usage) {
    console.log(label, '— nessun usage ancora');
    return;
  }
  const costs = usage.costs || {};
  console.log(`\n=== ${label} ===`);
  console.log('jobs AI:', usage.jobs || 0, '| failed:', usage.jobsFailed || 0);
  console.log('Gemini  calls:', costs.geminiCalls || 0,
    '| in:', costs.geminiInputTokens || 0,
    '| out:', costs.geminiOutputTokens || 0,
    '| think:', costs.geminiThoughtsTokens || 0,
    '|', money(costs.geminiUsd));
  console.log('fal     images:', costs.falImages || 0, '|', money(costs.falUsd));
  console.log('RapidAPI calls:', costs.rapidCalls || 0, '|', money(costs.rapidUsd));
  console.log('TOTALE         ', money(costs.totalUsd));
  const social = usage.social || {};
  console.log('link previewed:', social.linksPreviewed || 0,
    '| imported:', social.linksImported || 0,
    '| screenshot:', social.screenshots || 0,
    '| text:', social.pastedText || 0);
  const spaces = usage.spaces || {};
  console.log('spazi created:', spaces.created || 0,
    '| joined:', spaces.joined || 0,
    '| left:', spaces.left || 0,
    '| current:', spaces.current ?? '—');
  const features = usage.features || {};
  const ranked = Object.entries(features).sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    console.log('feature calls:');
    for (const [name, count] of ranked) console.log(`  ${name}: ${count}`);
  }
}

(async () => {
  const db = fb.db();
  const uid = process.argv[2];
  const rates = geminiRates();
  console.log(`prezzi: Gemini in $${rates.input}/M out $${rates.output}/M | fal $${falUsdPerImage()}/img | RapidAPI $${rapidUsdPerCall()}/call`);

  if (uid) {
    const snap = await db.doc(`users/${uid}`).get();
    printUsage(uid, snap.get('usage'));
    process.exit(0);
  }

  const totals = await db.doc('analytics/totals').get();
  printUsage('APP (analytics/totals)', totals.data());

  const users = await db.collection('users').get();
  let withUsage = 0;
  let sumUsd = 0;
  let sumJobs = 0;
  for (const doc of users.docs) {
    const usage = doc.get('usage');
    if (!usage || !usage.costs) continue;
    withUsage += 1;
    sumUsd += usage.costs.totalUsd || 0;
    sumJobs += usage.jobs || 0;
  }
  console.log('\n=== MEDIE ===');
  console.log('utenti totali:', users.size, '| con usage:', withUsage);
  if (withUsage) {
    console.log('costo medio / utente:', money(sumUsd / withUsage));
    console.log('job medi / utente:   ', (sumJobs / withUsage).toFixed(1));
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
