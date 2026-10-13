// Con cosa è entrato ogni utente: Apple oppure niente (anonimo).
//
// L'app calcola già la stessa cosa (`AuthService.isAppleLinked`) ma la
// tiene in memoria e non la scrive mai su Firestore. Chiederla a Firebase
// Auth invece di aggiungere un campo all'app ha due vantaggi che pesano:
// vale per tutti gli utenti già registrati, e non richiede una nuova
// versione su App Store per iniziare a misurare.
//
// Nel flusso di Vego il Sign in with Apple è obbligatorio DOPO l'acquisto,
// quindi ogni account Apple dovrebbe essere un pagante. Se non lo è, o il
// webhook Superwall non ha scritto il pagamento sul documento giusto, o
// quell'utente ha un abbonamento che non stiamo attribuendo a nessuno.

const PAGE_SIZE = 1000;

/**
 * uid → { apple, providers, createdAt, lastSignInAt }.
 *
 * Una pagina copre mille utenti: sotto quella soglia è una sola chiamata.
 * Se il service account non ha i permessi su Auth la funzione alza, e chi
 * la chiama decide se è un guasto o solo una colonna in meno.
 */
async function loadProviders(authAdmin) {
  const out = new Map();
  let pageToken;

  do {
    const page = await authAdmin.listUsers(PAGE_SIZE, pageToken);
    for (const user of page.users) {
      const providers = (user.providerData || []).map((p) => p.providerId);
      out.set(user.uid, {
        apple: providers.includes('apple.com'),
        providers,
        createdAt: user.metadata ? user.metadata.creationTime : null,
        lastSignInAt: user.metadata ? user.metadata.lastSignInTime : null,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);

  return out;
}

module.exports = { loadProviders };
