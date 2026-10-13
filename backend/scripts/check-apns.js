// Verifica la configurazione APNs senza bisogno di un telefono.
//
// Si manda un push a un token inventato: se Apple risponde
// "BadDeviceToken" vuol dire che chiave, Key ID e Team ID sono giusti
// (ha accettato il nostro JWT e si è fermata solo sul destinatario).
// Se risponde "InvalidProviderToken" o 403, il problema è nella chiave.
const { keys } = require('../config/keys');
const { updateLiveActivity, isConfigured } = require('../services/apns');

async function main() {
  if (!isConfigured()) {
    console.error('APNs non configurato. Mancano:');
    if (!keys.apns.keyId) console.error('  - APNS_KEY_ID');
    if (!keys.apns.teamId) console.error('  - APNS_TEAM_ID');
    if (!keys.apns.privateKey) console.error('  - APNS_KEY_P8 o APNS_KEY_PATH (chiave .p8 non trovata)');
    process.exit(1);
  }

  console.log('Key ID:  ', keys.apns.keyId);
  console.log('Team ID: ', keys.apns.teamId);
  console.log('Topic:   ', `${keys.apns.bundleId}.push-type.liveactivity`);
  console.log('Ambiente:', keys.apns.production ? 'production' : 'sandbox', '(con fallback automatico)');
  console.log('');

  const fakeToken = 'f'.repeat(64);
  const result = await updateLiveActivity({
    token: fakeToken,
    contentState: { checkedCount: 0, totalCount: 1, spentUsd: 0, lastActorName: null, lastItemName: null },
  });

  if (result.reason === 'BadDeviceToken') {
    console.log('OK — Apple ha accettato la chiave e ha rifiutato solo il token finto.');
    console.log('La configurazione è corretta: i push partiranno appena un telefono registra il suo token.');
    process.exit(0);
  }

  if (result.status === 403 || result.reason === 'InvalidProviderToken') {
    console.error('KO — Apple rifiuta la chiave (403 InvalidProviderToken).');
    console.error('Controlla che APNS_KEY_ID corrisponda al nome del file .p8 e che APNS_TEAM_ID sia quello giusto.');
    process.exit(1);
  }

  console.error('Risposta inattesa da APNs:', result);
  process.exit(1);
}

main().catch((e) => {
  console.error('Errore:', e.message);
  process.exit(1);
});
