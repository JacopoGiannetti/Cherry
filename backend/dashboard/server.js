// Dashboard analytics di Vego — strumento interno, NON parte del
// servizio pubblico: `server.js` del backend non la monta mai, quindi
// il web service su Render non la espone.
//
//   locale:     cd backend && npm run dashboard
//   Cloud Run:  vedi README, sezione "Dashboard analytics"
const path = require('path');

// `config/keys.js` legge .env dalla cwd, e nel .env il service account
// ha un path relativo al backend. Spostarsi qui evita che la dashboard
// "non trovi le chiavi" solo perché lanciata da un'altra cartella.
process.chdir(path.resolve(__dirname, '..'));

const express = require('express');
const { firestore, auth, describe } = require('./firestore');
const { build } = require('./aggregate');

// Cloud Run popola sempre K_SERVICE e PORT.
const hosted = Boolean(process.env.K_SERVICE);
const PORT = parseInt(process.env.PORT || process.env.DASHBOARD_PORT || '4000', 10);
const HOST = hosted ? '0.0.0.0' : '127.0.0.1';

// Il database di Vego si chiama "vego", non "(default)". In locale lo
// dice il .env; su Cloud Run non c'è .env, e senza questa variabile
// leggeremmo un database vuoto mostrando zeri ovunque invece di un
// errore — il tipo di guasto che si scopre dopo un'ora.
if (hosted && !process.env.FIREBASE_DATABASE_ID) {
  console.error('Manca FIREBASE_DATABASE_ID. Su Cloud Run: --set-env-vars FIREBASE_DATABASE_ID=vego');
  process.exit(1);
}

const app = express();

// Tripwire, non serratura: la protezione vera è il servizio privato più
// IAP. Ma se un deploy finisse per sbaglio pubblico e senza IAP, da qui
// uscirebbe l'anagrafica di tutti gli utenti a chiunque indovini l'URL.
// Una richiesta che non porta né l'asserzione di IAP né un token non
// viene servita.
app.use((req, res, next) => {
  if (!hosted) return next();
  if (req.get('x-goog-iap-jwt-assertion') || req.get('authorization')) return next();
  res.status(403).send('Richiesta non autenticata. Abilita IAP su questo servizio Cloud Run.');
});

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Sei pagine, una domanda ciascuna: Oggi (/), Soldi, Persone,
// Onboarding, Costi AI, Utenti. Più Distribution, che non è analytics:
// è uno strumento di produzione e si prende lo schermo intero.
const pages = {
  '/money': 'money.html',
  '/people': 'people.html',
  '/onboarding': 'onboarding.html',
  '/product': 'product.html',
  '/users': 'users.html',
  '/distribution': 'distribution.html',
  // Contabilità: entrate, uscite, autofatture TD17. Amministrazione,
  // non analytics, ma sta dietro lo stesso IAP.
  '/contabilita': 'ledger.html',
  // Il ricettario condiviso: ricette, foto, classifica, parametri.
  '/ricettario': 'catalog.html',
};

Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (req, res) => res.sendFile(path.join(publicDir, file)));
});

// Distribution: produzione di contenuti, non lettura di dati. Vive in un
// suo modulo perché non condivide niente con l'aggregazione — solo il
// guscio, il tema e il fatto di stare dietro allo stesso IAP.
app.use('/api/distribution', require('./distribution/routes'));
app.use('/api/ledger', require('./ledger/routes'));
app.use('/api/catalog', require('./catalog/routes'));

// Gli interruttori dell'app: li legge GET /config del backend all'avvio,
// quindi un cambio vale per chi apre l'app dopo, senza update.
const appConfig = require('../lib/app-config');

app.get('/api/app-config', async (req, res) => {
  try {
    const snap = await firestore().doc(appConfig.DOC).get();
    res.json(appConfig.normalize(snap.exists ? snap.data() : {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/app-config', express.json(), async (req, res) => {
  try {
    const patch = {};
    for (const key of Object.keys(appConfig.DEFAULTS)) {
      if (typeof (req.body || {})[key] === 'boolean') patch[key] = req.body[key];
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'niente da cambiare' });
    const ref = firestore().doc(appConfig.DOC);
    await ref.set({ ...patch, updatedAt: new Date() }, { merge: true });
    const snap = await ref.get();
    res.json(appConfig.normalize(snap.data()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Le rotte della dashboard precedente: chi ha un segnalibro atterra
// sulla pagina che ha assorbito quel contenuto.
const moved = { '/spend': '/money', '/audience': '/people', '/features': '/product', '/spaces': '/product', '/dashboard': '/money' };
Object.entries(moved).forEach(([from, to]) => {
  app.get(from, (req, res) => res.redirect(301, to));
});

// Il giorno da cui contare. Prima c'era il vecchio onboarding e mezza
// app diversa, quindi mischiare i due periodi dava numeri che non
// significavano niente. I dati vecchi restano su Firestore: qui si
// scelgono, non si cancellano.
//
// Il 18 e non il 17: la 1.1 è diventata live a giornata iniziata, e chi
// è arrivato nelle ore prima ha visto il vecchio onboarding.
const RESET_DAY = process.env.DASHBOARD_SINCE || '2026-09-18';

app.get('/api/data', async (req, res) => {
  try {
    const since = RESET_DAY;
    res.json(await build(firestore(), auth(), { since }));
  } catch (error) {
    console.error('[dashboard]', error);
    res.status(500).json({ error: error.message });
  }
});

// La scheda di un singolo utente. `/api/data` porta al browser una
// sintesi per utente; qui serve il documento com'è su Firestore, con
// dentro le risposte ai questionari, così la scheda resta completa
// anche quando l'app aggiunge un campo nuovo senza dirlo a nessuno.
app.get('/api/user/:uid', async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid || uid.length > 128 || uid.includes('/')) {
    return res.status(400).json({ error: 'uid non valido' });
  }
  try {
    const store = firestore();
    const ref = store.collection('users').doc(uid);
    const [snap, daysSnap] = await Promise.all([
      ref.get(),
      // Ordinati per id, che è il giorno: gli ultimi sessanta bastano
      // a capire se una persona è sparita o sta ancora usando l'app.
      ref.collection('usageDays').get(),
    ]);
    if (!snap.exists) return res.status(404).json({ error: 'utente non trovato' });

    let account = null;
    try {
      const record = await auth().getUser(uid);
      account = {
        providers: (record.providerData || []).map((p) => p.providerId),
        apple: (record.providerData || []).some((p) => p.providerId === 'apple.com'),
        createdAt: record.metadata ? record.metadata.creationTime : null,
        lastSignInAt: record.metadata ? record.metadata.lastSignInTime : null,
        email: record.email || null,
      };
    } catch (error) {
      // Utente cancellato da Auth, o service account senza permessi:
      // la scheda perde una sezione, non si rompe.
      account = { error: error.message };
    }

    const days = daysSnap.docs
      .map((d) => ({ day: d.id, ...d.data() }))
      .sort((a, b) => String(b.day).localeCompare(String(a.day)))
      .slice(0, 60);

    res.json({ uid, doc: snap.data() || {}, days, account });
  } catch (error) {
    console.error('[dashboard]', error);
    res.status(500).json({ error: error.message });
  }
});

// Maschio o femmina, indovinato dal nome. L'app non chiede il genere e
// non ha intenzione di farlo, quindi l'unico indizio è il nome scritto
// in onboarding: un modello lo legge e dice cosa gli sembra, con
// "incerto" come risposta legittima per i nomi ambigui o inventati.
// È una stima, non un dato: serve a sapere a chi si sta parlando, non
// a marcare le persone, e infatti il risultato non torna su Firestore.
//
// Gira solo quando si preme il pulsante, e i nomi già visti restano in
// cache finché il processo è vivo: premerlo due volte di fila non
// ricompra le stesse risposte.
const genderCache = new Map();

app.post('/api/gender', async (req, res) => {
  try {
    const snap = await firestore().collection('users').get();
    const seen = new Map();
    for (const doc of snap.docs) {
      const name = String((doc.data() || {}).displayName || '').trim();
      if (!name) continue;
      // Un nome vale una persona: due Marco contano due volte nel
      // totale, ma al modello si chiede una volta sola.
      const key = name.toLowerCase();
      seen.set(key, { name, count: (seen.get(key)?.count || 0) + 1 });
    }

    const missing = [...seen.values()].filter((e) => !genderCache.has(e.name.toLowerCase()));
    if (missing.length) {
      const { generateJSON } = require('../services/gemini');
      // A blocchi: una lista lunghissima in un colpo solo aumenta le
      // probabilità che il modello salti righe o perda l'allineamento.
      for (let i = 0; i < missing.length; i += 120) {
        const chunk = missing.slice(i, i + 120);
        const out = await generateJSON({
          label: 'dashboard.gender',
          temperature: 0,
          prompt: [
            'Per ogni nome dell\'elenco dici se chi lo porta è con ogni probabilità un uomo o una donna.',
            'Sono nomi propri scritti da persone reali durante la registrazione a un\'app, in lingue diverse.',
            'Rispondi "unknown" quando il nome è unisex, è un soprannome, non è un nome di persona, o è troppo raro per decidere: tirare a indovinare vale meno di ammettere che non si sa.',
            'Rispetta l\'ordine e restituisci esattamente un risultato per ogni nome ricevuto.',
            '',
            chunk.map((e, k) => `${k + 1}. ${e.name}`).join('\n'),
          ].join('\n'),
          schema: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    gender: { type: 'string', enum: ['male', 'female', 'unknown'] },
                  },
                  required: ['name', 'gender'],
                },
              },
            },
            required: ['results'],
          },
        });
        const results = Array.isArray(out.results) ? out.results : [];
        chunk.forEach((entry, k) => {
          const guess = results[k] && results[k].gender;
          genderCache.set(entry.name.toLowerCase(), ['male', 'female'].includes(guess) ? guess : 'unknown');
        });
      }
    }

    const counts = { male: 0, female: 0, unknown: 0 };
    const samples = { male: [], female: [], unknown: [] };
    for (const [key, entry] of seen) {
      const guess = genderCache.get(key) || 'unknown';
      counts[guess] += entry.count;
      if (samples[guess].length < 8) samples[guess].push(entry.name);
    }

    const named = counts.male + counts.female + counts.unknown;
    res.json({
      counts,
      samples,
      named,
      // Chi non ha scritto il nome non entra nella stima, ma va detto
      // quanti sono: se sono la metà, la percentuale parla di poca gente.
      anonymous: snap.size - named,
      askedModel: missing.length,
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[dashboard]', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, HOST, () => {
  const { project, database, credentials } = describe();
  console.log(`Firestore: progetto ${project}, database "${database}" via ${credentials}`);
  console.log(`Conteggi dal ${RESET_DAY} (DASHBOARD_SINCE per cambiarlo)`);
  console.log(hosted ? `In ascolto sulla porta ${PORT}` : `Vego analytics → http://localhost:${PORT}`);

  if (hosted) {
    const { capabilities } = require('./distribution/media');
    capabilities()
      .then((ff) => {
        if (ff.ffmpeg && ff.drawtext) console.log('[distribution] ffmpeg ok, drawtext ok');
        else if (ff.ffmpeg) {
          console.warn(
            '[distribution] ffmpeg senza freetype: niente drawtext, il nodo Testo non funziona. ' +
              'Ridistribuisci col Dockerfile (apt installa una build completa).'
          );
        } else {
          console.warn(
            '[distribution] ffmpeg assente: né sul sistema né scaricabile. ' +
              'In locale: brew install ffmpeg. Su Cloud Run riparte il download al prossimo avvio.'
          );
        }
      })
      .catch(() => {});
  }
});
