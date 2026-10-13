// Contabilità: entrate, uscite e autofatture TD17.
//
// I PDF non arrivano mai qui: li legge il browser, e al server passano
// solo i dati estratti e confermati (soggetto, numero, data, importo).
// Il server tiene l'archivio su Firestore e fa le due cose che non
// possono stare nel browser: rifare i controlli sui doppioni contro
// l'archivio vero, e assegnare i numeri delle TD17 dentro una
// transazione, così due schede aperte non danno mai lo stesso numero.
//
// Collezioni, tutte fuori dalla portata dell'app (le regole Firestore
// negano ciò che non elencano, e la dashboard usa l'Admin SDK):
//   ledger_meta/settings   i tuoi dati, numerazione, modalità TD17
//   ledger_parties/{id}    fornitori e clienti
//   ledger_docs/{id}       un documento per fattura, id = soggetto__numero
//   ledger_selfinvoices    le TD17 emesse, con l'XML dentro
const express = require('express');
const crypto = require('crypto');
const { firestore } = require('../firestore');
const core = require('../public/ledger-core');
const { convertDates } = require('./fx');

const router = express.Router();

const guard = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((error) => {
    const status = error.status || 500;
    if (status >= 500) console.error('[ledger]', error);
    res.status(status).json({ error: error.message || 'errore', details: error.details });
  });
};

function fail(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

const col = {
  settings: () => firestore().collection('ledger_meta').doc('settings'),
  parties: () => firestore().collection('ledger_parties'),
  docs: () => firestore().collection('ledger_docs'),
  selfInvoices: () => firestore().collection('ledger_selfinvoices'),
};

const DEFAULT_SETTINGS = {
  me: { piva: '', cf: '', nome: '', cognome: '', denominazione: '', indirizzo: '', civico: '', cap: '', comune: '', provincia: '', sdi: 'KRRH6B9', pec: '', pivaStart: '' },
  vatRate: 22,
  numbering: { prefix: 'AF', digits: 2, suffix: '', next: {} },
  td17Mode: 'supplierMonth',
  progCounter: 0,
};

// I due soggetti che ci sono di sicuro. Il resto lo crea il primo
// documento che li nomina.
const SEED_PARTIES = [
  {
    id: 'meta', name: 'Meta Platforms Ireland Limited', role: 'supplier', vatMode: 'reverse',
    country: 'IE', vatCode: '9692928F', address: 'Merrion Road', city: 'Dublin 4', cap: '00000',
    aliases: ['Meta Platforms Ireland', 'Facebook Ireland', 'FBADS'], description: 'Servizi pubblicitari Meta Ads', category: 'pubblicita',
  },
  {
    id: 'apple', name: 'Apple Distribution International Ltd', role: 'customer', vatMode: 'none',
    country: 'IE', vatCode: '9700053D', address: 'Hollyhill Industrial Estate, Hollyhill', city: 'Cork', cap: '00000',
    aliases: ['Apple Distribution International'], description: 'Vendite App Store', category: 'vendite',
  },
];

function now() { return new Date().toISOString(); }

function cleanParty(input) {
  const p = input || {};
  const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);
  return {
    name: str(p.name),
    role: p.role === 'customer' ? 'customer' : 'supplier',
    vatMode: ['reverse', 'domestic', 'none'].includes(p.vatMode) ? p.vatMode : 'none',
    country: str(p.country, 2).toUpperCase(),
    vatCode: str(p.vatCode, 28).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    address: str(p.address),
    city: str(p.city, 60),
    cap: str(p.cap, 5),
    description: str(p.description, 120),
    category: core.CATEGORIES[p.category] ? p.category : core.guessCategory({ ...p, aliases: [] }),
    aliases: (Array.isArray(p.aliases) ? p.aliases : String(p.aliases || '').split(','))
      .map((a) => String(a).trim()).filter(Boolean).slice(0, 12),
  };
}

function slug(name) {
  const base = String(name || 'soggetto').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'soggetto';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

function cleanDoc(input) {
  const d = input || {};
  const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? core.round2(Number(v)) : null);
  const foreign = /^[A-Z]{3}$/.test(String(d.originalCurrency || '').toUpperCase()) && String(d.originalCurrency).toUpperCase() !== 'EUR';
  return {
    // In valuta: conta l'importo originale, gli euro li ricalcola il
    // server al cambio BCE (applyFx), qualunque cosa mandi il browser.
    originalCurrency: foreign ? String(d.originalCurrency).toUpperCase() : null,
    originalAmount: foreign ? num(d.originalAmount) : null,
    originalVat: foreign ? num(d.originalVat) || 0 : null,
    treatment: core.TREATMENTS[d.treatment] ? d.treatment : '',
    category: core.CATEGORIES[d.category] ? d.category : null,
    paidDate: core.isIsoDate(d.paidDate) ? d.paidDate : null,
    ref: String(d.ref ?? ''),
    partyId: String(d.partyId || ''),
    number: String(d.number || '').trim().slice(0, 60),
    altNumbers: (Array.isArray(d.altNumbers) ? d.altNumbers : []).map((n) => String(n).trim().slice(0, 60)).filter(Boolean).slice(0, 4),
    date: String(d.date || ''),
    amount: num(d.amount),
    vat: num(d.vat) || 0,
    periodFrom: core.isIsoDate(d.periodFrom) ? d.periodFrom : null,
    periodTo: core.isIsoDate(d.periodTo) ? d.periodTo : null,
    currency: foreign ? 'EUR' : String(d.currency || 'EUR').toUpperCase().slice(0, 3),
    vatIds: Array.isArray(d.vatIds) ? d.vatIds.map(String).slice(0, 6) : [],
    notes: Array.isArray(d.notes) ? d.notes.map(String).slice(0, 6) : [],
    fileName: String(d.fileName || '').slice(0, 200),
    // Il report CSV da cui viene la riga, se c'è: tra righe dello stesso
    // report "stessa data e stesso importo" non è un sospetto doppione.
    source: String(d.source || '').slice(0, 200),
    blockers: Array.isArray(d.blockers) ? d.blockers.map(String).slice(0, 6) : [],
    // Gli avvisi che hai visto e confermato, testuali. Uno nuovo, che
    // il server trova e tu non hai visto, ferma la registrazione.
    confirmedWarnings: Array.isArray(d.confirmedWarnings) ? d.confirmedWarnings.map(String).slice(0, 20) : [],
  };
}

/**
 * Converte in euro i documenti in valuta, al cambio BCE del loro giorno.
 * Scrive su ogni documento amount, fxRate, fxRateDate, fxProvisional.
 * Va chiamata fuori dalle transazioni: fa richieste di rete.
 */
async function applyFx(docs) {
  const byCurrency = new Map();
  for (const d of docs) {
    if (!d.originalCurrency || !(d.originalAmount > 0) || !core.isIsoDate(d.date)) continue;
    if (!byCurrency.has(d.originalCurrency)) byCurrency.set(d.originalCurrency, []);
    byCurrency.get(d.originalCurrency).push(d);
  }
  for (const [currency, list] of byCurrency) {
    let rates;
    try {
      rates = await convertDates(currency, list.map((d) => d.date));
    } catch (error) {
      throw fail(502, `Cambio BCE ${currency} non disponibile (${error.message}). Riprova tra poco.`);
    }
    for (const d of list) {
      const r = rates[d.date];
      Object.assign(d, {
        amount: core.round2(d.originalAmount / r.rate),
        vat: core.round2((Number(d.originalVat) || 0) / r.rate),
        fxRate: r.rate, fxRateDate: r.rateDate, fxProvisional: r.provisional,
      });
    }
  }
}

function fxFields(d) {
  return d.originalCurrency
    ? { originalCurrency: d.originalCurrency, originalAmount: d.originalAmount, originalVat: Number(d.originalVat) || 0, fxRate: d.fxRate || null, fxRateDate: d.fxRateDate || null, fxProvisional: Boolean(d.fxProvisional) }
    : { originalCurrency: null, originalAmount: null, originalVat: null, fxRate: null, fxRateDate: null, fxProvisional: false };
}

async function readSettings(tx) {
  const snap = tx ? await tx.get(col.settings()) : await col.settings().get();
  const s = snap.exists ? snap.data() : {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    me: { ...DEFAULT_SETTINGS.me, ...(s.me || {}) },
    numbering: { ...DEFAULT_SETTINGS.numbering, ...(s.numbering || {}), next: { ...((s.numbering || {}).next || {}) } },
  };
}

function mapById(snap) {
  const out = {};
  snap.forEach((d) => { out[d.id] = { id: d.id, ...d.data() }; });
  return out;
}

/**
 * Crea le TD17 per i documenti dati, dentro la transazione aperta.
 * Legge già fatte le letture (settings, parties): qui si scrive e basta.
 */
function issueTd17(tx, { settings, parties, docs, docsAreNew = false }) {
  const problems = core.meProblems(settings.me);
  if (Object.keys(problems).length) {
    throw fail(400, `Prima di generare una TD17 completa i tuoi dati: ${Object.values(problems).join('; ')}.`);
  }
  const early = docs.filter((d) => d.fxProvisional && core.docNeedsTd17(d, parties[d.partyId]));
  if (early.length) {
    throw fail(409, `Il cambio BCE del ${early.map((d) => core.itDate(d.date)).filter((v, i, a) => a.indexOf(v) === i).join(', ')} non è ancora pubblicato (esce verso le 16): ${early.map((d) => d.number).join(', ')}. Registra e basta, la TD17 generala più tardi.`);
  }
  const groups = core.td17Groups(docs, parties, settings.td17Mode);
  const issued = [];
  for (const g of groups) {
    const party = parties[g.partyId];
    const partyIssues = core.partyProblems(party);
    if (partyIssues.length) throw fail(400, `${party.name}: ${partyIssues.join('; ')}.`);
    const year = g.date.slice(0, 4);
    const seq = parseInt(settings.numbering.next[year], 10) || 1;
    settings.numbering.next[year] = seq + 1;
    settings.progCounter = (parseInt(settings.progCounter, 10) || 0) + 1;
    const number = core.formatNumber(settings.numbering, seq);
    const prog = core.progressivo(settings.progCounter);
    const xml = core.buildTd17Xml({ me: settings.me, party, docs: g.docs, number, date: g.date, prog, vatRate: settings.vatRate });
    const base = g.base;
    const vat = core.round2(base * Number(settings.vatRate) / 100);
    const ref = col.selfInvoices().doc();
    const record = {
      number, year, seq, date: g.date, month: g.month, partyId: g.partyId, partyName: party.name,
      docIds: g.docs.map((d) => d.id), docNumbers: g.docs.map((d) => d.number),
      base, vat, total: core.round2(base + vat), vatRate: Number(settings.vatRate),
      prog, fileName: core.td17FileName(settings.me, prog), xml, createdAt: now(),
    };
    tx.set(ref, record);
    // I documenti appena creati prendono il riferimento prima di essere
    // scritti; quelli già in archivio si aggiornano.
    for (const d of g.docs) {
      if (docsAreNew) Object.assign(d, { selfInvoiceId: ref.id, selfInvoiceNumber: number });
      else tx.update(col.docs().doc(d.id), { selfInvoiceId: ref.id, selfInvoiceNumber: number, amount: d.amount, vat: d.vat || 0, ...fxFields(d) });
    }
    issued.push({ id: ref.id, ...record });
  }
  tx.set(col.settings(), { numbering: settings.numbering, progCounter: settings.progCounter }, { merge: true });
  return issued;
}

function withoutXml(s) { const { xml, ...rest } = s; return rest; }

// ---------------------------------------------------------------------

router.get('/', guard(async (req, res) => {
  let [settings, partiesSnap, docsSnap, selfSnap] = await Promise.all([
    readSettings(), col.parties().get(), col.docs().get(), col.selfInvoices().get(),
  ]);
  if (partiesSnap.empty && !settings.seeded) {
    const batch = firestore().batch();
    for (const { id, ...p } of SEED_PARTIES) batch.set(col.parties().doc(id), { ...cleanParty(p), createdAt: now() });
    batch.set(col.settings(), { seeded: true }, { merge: true });
    await batch.commit();
    partiesSnap = await col.parties().get();
    settings = await readSettings();
  }
  // Cambi provvisori: appena la BCE pubblica, diventano definitivi. Se
  // la BCE non risponde restano provvisori, e si riprova alla prossima.
  const provisional = docsSnap.docs.filter((s) => s.data().fxProvisional).map((s) => ({ id: s.id, ...s.data() }));
  if (provisional.length) {
    try {
      await applyFx(provisional);
      const settled = provisional.filter((d) => !d.fxProvisional);
      if (settled.length) {
        await firestore().runTransaction(async (tx) => {
          const snaps = await Promise.all(settled.map((d) => tx.get(col.docs().doc(d.id))));
          snaps.forEach((s, i) => {
            const d = settled[i];
            if (s.exists && s.data().fxProvisional && !s.data().selfInvoiceId && s.data().originalAmount === d.originalAmount) {
              tx.update(s.ref, { amount: d.amount, vat: d.vat, fxRate: d.fxRate, fxRateDate: d.fxRateDate, fxProvisional: false });
            }
          });
        });
        docsSnap = await col.docs().get();
      }
    } catch (error) {
      console.warn('[ledger] cambi provvisori:', error.message);
    }
  }
  res.json({
    settings,
    parties: Object.values(mapById(partiesSnap)),
    docs: Object.values(mapById(docsSnap)),
    selfInvoices: Object.values(mapById(selfSnap)).map(withoutXml),
  });
}));

router.put('/settings', express.json(), guard(async (req, res) => {
  const body = req.body || {};
  const update = {};
  if (body.me) {
    const keys = Object.keys(DEFAULT_SETTINGS.me);
    update.me = Object.fromEntries(keys.map((k) => [k, String(body.me[k] ?? '').trim().slice(0, 120)]));
    if (!core.isIsoDate(update.me.pivaStart)) update.me.pivaStart = '';
  }
  if (body.vatRate !== undefined) {
    const rate = Number(body.vatRate);
    if (!(rate >= 0 && rate <= 100)) throw fail(400, 'aliquota non valida');
    update.vatRate = rate;
  }
  if (body.td17Mode) update.td17Mode = body.td17Mode === 'invoice' ? 'invoice' : 'supplierMonth';
  await firestore().runTransaction(async (tx) => {
    const current = await readSettings(tx);
    if (body.numbering) {
      const n = body.numbering;
      const numbering = {
        prefix: String(n.prefix ?? current.numbering.prefix).slice(0, 10),
        digits: Math.min(6, Math.max(1, parseInt(n.digits, 10) || current.numbering.digits)),
        suffix: String(n.suffix ?? current.numbering.suffix).slice(0, 10),
        next: { ...current.numbering.next },
      };
      // Il prossimo numero si può spostare solo in avanti rispetto a
      // quelli già emessi: indietro vorrebbe dire due TD17 con lo stesso.
      if (n.year && n.next !== undefined) {
        const year = String(n.year);
        const wanted = parseInt(n.next, 10);
        const issued = await tx.get(col.selfInvoices().where('year', '==', year));
        const maxSeq = issued.docs.reduce((m, d) => Math.max(m, d.data().seq || 0), 0);
        if (!(wanted >= 1)) throw fail(400, 'prossimo numero non valido');
        if (wanted <= maxSeq) throw fail(400, `Nel ${year} è già emessa la TD17 numero ${maxSeq}: il prossimo deve essere almeno ${maxSeq + 1}.`);
        numbering.next[year] = wanted;
      }
      update.numbering = numbering;
    }
    tx.set(col.settings(), update, { merge: true });
  });
  res.json({ settings: await readSettings() });
}));

router.post('/parties', express.json(), guard(async (req, res) => {
  const body = req.body || {};
  const party = cleanParty(body);
  const problems = core.partyProblems(party);
  if (problems.length) throw fail(400, problems.join('; '));
  const id = body.id && /^[a-z0-9-]{2,60}$/.test(body.id) ? body.id : slug(party.name);
  const ref = col.parties().doc(id);
  const snap = await ref.get();
  await ref.set({ ...party, ...(snap.exists ? {} : { createdAt: now() }), updatedAt: now() }, { merge: true });
  res.json({ party: { id, ...(await ref.get()).data() } });
}));

router.delete('/parties/:id', guard(async (req, res) => {
  const used = await col.docs().where('partyId', '==', req.params.id).limit(1).get();
  if (!used.empty) throw fail(409, 'Ha dei documenti registrati: togli prima quelli.');
  await col.parties().doc(req.params.id).delete();
  res.json({ ok: true });
}));

/**
 * Registra un lotto. Il browser ha già mostrato tutto; qui si rifà ogni
 * controllo contro l'archivio letto nella stessa transazione, e se
 * qualcosa non torna non si scrive niente: o tutto il lotto, o nulla.
 */
router.post('/commit', express.json({ limit: '4mb' }), guard(async (req, res) => {
  const body = req.body || {};
  const input = (Array.isArray(body.docs) ? body.docs : []).map(cleanDoc);
  const newParties = Array.isArray(body.newParties) ? body.newParties : [];
  if (!input.length) throw fail(400, 'nessun documento da registrare');
  if (input.length > 300) throw fail(400, 'al massimo 300 documenti per volta');
  await applyFx(input);

  const out = await firestore().runTransaction(async (tx) => {
    const settings = await readSettings(tx);
    const parties = mapById(await tx.get(col.parties()));
    const archive = Object.values(mapById(await tx.get(col.docs())));

    // Soggetti nuovi: se la partita IVA c'è già in anagrafica si usa
    // quello, invece di crearne un doppione.
    const created = [];
    const tempMap = {};
    for (const np of newParties) {
      const party = cleanParty(np);
      const problems = core.partyProblems(party);
      if (problems.length) throw fail(400, `${party.name || 'nuovo soggetto'}: ${problems.join('; ')}.`);
      const existing = party.vatCode
        ? Object.values(parties).find((p) => core.vatKey(p.country, p.vatCode) === core.vatKey(party.country, party.vatCode))
        : null;
      if (existing) { tempMap[np.tempId] = existing.id; continue; }
      const id = slug(party.name);
      parties[id] = { id, ...party, createdAt: now() };
      tempMap[np.tempId] = id;
      created.push(parties[id]);
    }
    for (const d of input) if (tempMap[d.partyId]) d.partyId = tempMap[d.partyId];
    for (const d of input) if (d.partyId && !parties[d.partyId]) throw fail(400, `soggetto sconosciuto per ${d.number || d.fileName}`);

    const results = core.review(input, archive, parties, settings.me);
    const problems = [];
    results.forEach((r, i) => {
      const d = input[i];
      const label = `${d.number || d.fileName || `riga ${i + 1}`}`;
      const unseen = r.warns.filter((w) => !d.confirmedWarnings.includes(w));
      if (r.blocks.length) problems.push({ ref: d.ref, label, level: 'block', messages: r.blocks });
      else if (unseen.length) problems.push({ ref: d.ref, label, level: 'warn', messages: unseen });
    });
    if (problems.length) {
      throw fail(409, `${problems.length} documenti non si possono registrare così. Niente è stato salvato.`, problems);
    }

    const stored = input.map((d) => {
      const party = parties[d.partyId];
      const id = core.docId(d.partyId, d.number);
      const record = {
        partyId: d.partyId, direction: party.role === 'customer' ? 'in' : 'out',
        number: d.number, numberKey: core.numberKey(d.number), altNumbers: d.altNumbers, date: d.date, month: d.date.slice(0, 7),
        amount: d.amount, vat: d.vat, currency: 'EUR', ...fxFields(d), periodFrom: d.periodFrom, periodTo: d.periodTo,
        treatment: d.treatment, paidDate: d.paidDate,
        category: core.categoryOf(d, party), deductPct: core.deductPctOf({ category: core.categoryOf(d, party) }, party),
        fileName: d.fileName, source: d.source || null, warningsConfirmed: results[input.indexOf(d)].warns,
        selfInvoiceId: null, selfInvoiceNumber: null, createdAt: now(),
      };
      return { id, ...record };
    });

    const issued = body.generate ? issueTd17(tx, { settings, parties, docs: stored, docsAreNew: true }) : [];
    for (const p of created) { const { id, ...data } = p; tx.set(col.parties().doc(id), data); }
    for (const { id, ...data } of stored) tx.create(col.docs().doc(id), data);
    return { created, stored, issued };
  });

  res.json({ parties: out.created, docs: out.stored, selfInvoices: out.issued });
}));

/** TD17 per documenti già registrati che non ce l'hanno ancora. */
router.post('/generate', express.json(), guard(async (req, res) => {
  const ids = Array.isArray((req.body || {}).docIds) ? req.body.docIds.map(String) : [];
  if (!ids.length) throw fail(400, 'nessun documento scelto');
  // I cambi provvisori si rifanno adesso, fuori dalla transazione: se
  // nel frattempo la BCE ha pubblicato, la TD17 usa quello ufficiale.
  const before = await Promise.all(ids.map((id) => col.docs().doc(id).get()));
  const refresh = before.filter((s) => s.exists && s.data().fxProvisional).map((s) => ({ id: s.id, ...s.data() }));
  await applyFx(refresh);
  const refreshed = Object.fromEntries(refresh.map((d) => [d.id, d]));

  const issued = await firestore().runTransaction(async (tx) => {
    const settings = await readSettings(tx);
    const parties = mapById(await tx.get(col.parties()));
    const snaps = await Promise.all(ids.map((id) => tx.get(col.docs().doc(id))));
    const docs = snaps.map((s) => {
      if (!s.exists) throw fail(404, `documento ${s.id} non trovato`);
      const d = { id: s.id, ...s.data() };
      const r = refreshed[s.id];
      if (d.fxProvisional && r && r.originalAmount === d.originalAmount && r.date === d.date) {
        Object.assign(d, { amount: r.amount, vat: r.vat, fxRate: r.fxRate, fxRateDate: r.fxRateDate, fxProvisional: r.fxProvisional });
      }
      if (d.selfInvoiceId) throw fail(409, `${d.number} è già nella TD17 ${d.selfInvoiceNumber}`);
      if (!core.docNeedsTd17(d, parties[d.partyId])) throw fail(400, `${d.number}: il suo binario non prevede la TD17`);
      if (core.beforePiva(d, settings.me)) throw fail(400, `${d.number}: è di prima dell'apertura della partita IVA, niente TD17`);
      return d;
    });
    return issueTd17(tx, { settings, parties, docs });
  });
  res.json({ selfInvoices: issued });
}));

/** Anteprima dei cambi per il browser: ?currency=USD&dates=2026-09-04,2026-09-24 */
router.get('/fx', guard(async (req, res) => {
  const dates = String(req.query.dates || '').split(',').filter(core.isIsoDate).slice(0, 400);
  try {
    res.json({ rates: await convertDates(String(req.query.currency || ''), dates) });
  } catch (error) {
    throw fail(502, `Cambio BCE non disponibile: ${error.message}`);
  }
}));

router.get('/selfinvoices/:id/xml', guard(async (req, res) => {
  const snap = await col.selfInvoices().doc(req.params.id).get();
  if (!snap.exists) throw fail(404, 'TD17 non trovata');
  const s = snap.data();
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${s.fileName}"`);
  res.send(s.xml);
}));

router.post('/selfinvoices/xml', express.json(), guard(async (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String).slice(0, 300) : [];
  const snaps = await Promise.all(ids.map((id) => col.selfInvoices().doc(id).get()));
  res.json({ files: snaps.filter((s) => s.exists).map((s) => ({ name: s.data().fileName, xml: s.data().xml })) });
}));

/**
 * Una TD17 numerata non si cancella: se è andata allo SdI esiste. Si
 * può togliere solo l'ultima emessa nell'anno, e il numero torna libero,
 * per il caso di un errore scoperto prima di caricarla su Aruba.
 */
router.delete('/selfinvoices/:id', guard(async (req, res) => {
  await firestore().runTransaction(async (tx) => {
    const ref = col.selfInvoices().doc(req.params.id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail(404, 'TD17 non trovata');
    const s = snap.data();
    const settings = await readSettings(tx);
    const next = parseInt(settings.numbering.next[s.year], 10) || 1;
    if (s.seq !== next - 1) throw fail(409, `Si può togliere solo l'ultima TD17 del ${s.year}. Questa (${s.number}) è già seguita da altre.`);
    settings.numbering.next[s.year] = s.seq;
    for (const id of s.docIds || []) tx.update(col.docs().doc(id), { selfInvoiceId: null, selfInvoiceNumber: null });
    tx.set(col.settings(), { numbering: settings.numbering }, { merge: true });
    tx.delete(ref);
  });
  res.json({ ok: true });
}));

/**
 * Correzioni a un documento già registrato: binario, imponibile e IVA
 * (nella valuta della fattura), categoria, percentuale deducibile, data
 * di pagamento. Binario e importi restano fermi quando il documento è
 * già in una TD17 numerata.
 */
router.patch('/docs/:id', express.json(), guard(async (req, res) => {
  const b = req.body || {};
  const out = await firestore().runTransaction(async (tx) => {
    const settings = await readSettings(tx);
    const ref = col.docs().doc(req.params.id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail(404, 'documento non trovato');
    const d = { id: snap.id, ...snap.data() };
    const partySnap = await tx.get(col.parties().doc(d.partyId));
    const party = { id: partySnap.id, ...(partySnap.data() || {}) };
    const update = {};
    if (b.category !== undefined) {
      if (!core.CATEGORIES[b.category]) throw fail(400, 'categoria non valida');
      update.category = b.category;
    }
    if (b.deductPct !== undefined) {
      const pct = Number(b.deductPct);
      if (!(pct >= 0 && pct <= 100)) throw fail(400, 'percentuale deducibile tra 0 e 100');
      update.deductPct = pct;
    }
    if (b.paidDate !== undefined) update.paidDate = core.isIsoDate(b.paidDate) ? b.paidDate : null;
    if (b.treatment !== undefined || b.vat !== undefined || b.net !== undefined) {
      const foreign = Boolean(d.originalCurrency);
      if (foreign && !(d.fxRate > 0)) throw fail(409, 'manca il cambio BCE di questo documento');
      const treatment = b.treatment !== undefined ? String(b.treatment) : core.treatmentOf(d, party);
      if (!core.TREATMENTS[treatment]) throw fail(400, 'binario non valido');
      const curNet = Number(foreign ? d.originalAmount : d.amount) || 0;
      const curTax = Number(foreign ? d.originalVat : d.vat) || 0;
      const tax = b.vat !== undefined ? core.round2(Number(b.vat)) : curTax;
      const net = b.net !== undefined ? core.round2(Number(b.net)) : curNet;
      if (!(tax >= 0)) throw fail(400, 'IVA non valida');
      if (!(net > 0)) throw fail(400, 'imponibile non valido');
      const changed = treatment !== core.treatmentOf(d, party) || tax !== core.round2(curTax) || net !== core.round2(curNet);
      if (changed && d.selfInvoiceId) throw fail(409, `È nella TD17 ${d.selfInvoiceNumber}: binario e importi non si cambiano più.`);
      update.treatment = treatment;
      if (foreign) Object.assign(update, { originalAmount: net, originalVat: tax, amount: core.round2(net / d.fxRate), vat: core.round2(tax / d.fxRate) });
      else Object.assign(update, { amount: net, vat: tax });
    }
    const next = { ...d, ...update, ref: d.id };
    next.treatment = core.treatmentOf(next, party);
    const [r] = core.review([next], [], { [party.id]: party }, settings.me);
    if (r.blocks.length) throw fail(400, r.blocks.join('; '));
    tx.update(ref, { ...update, updatedAt: now() });
    return { doc: next, warns: r.warns };
  });
  res.json(out);
}));

router.delete('/docs/:id', guard(async (req, res) => {
  await firestore().runTransaction(async (tx) => {
    const ref = col.docs().doc(req.params.id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail(404, 'documento non trovato');
    if (snap.data().selfInvoiceId) throw fail(409, `È nella TD17 ${snap.data().selfInvoiceNumber}: togli prima quella, se si può.`);
    tx.delete(ref);
  });
  res.json({ ok: true });
}));

module.exports = router;
