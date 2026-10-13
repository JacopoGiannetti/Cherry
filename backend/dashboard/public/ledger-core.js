/* Contabilità: la logica condivisa fra browser e server.

   Lo stesso file gira in due posti. Il browser lo usa per mostrare
   subito, mentre carichi, cosa è pronto e cosa no; il server lo riusa
   al momento di registrare, sugli stessi dati letti da Firestore dentro
   una transazione. Così l'anteprima e la decisione finale non possono
   divergere: se il server rifiuta, è per qualcosa che nel frattempo è
   cambiato (un'altra scheda ha registrato la stessa fattura). */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LedgerCore = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const EU = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);

  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function fixed2(n) { return round2(n).toFixed(2); }
  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function isIsoDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
  function itDate(iso) {
    if (!isIsoDate(iso)) return iso || '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  function monthEnd(iso) {
    const [y, m] = iso.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  }

  /* Due scritture dello stesso numero ("FBADS-123-45", "fbads 123 45")
     sono la stessa fattura: il confronto si fa solo su lettere e cifre. */
  function numberKey(number) { return String(number || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  /* La "forma" di un numero: FBADS-123-45 → AAAAA-999-99. Serve a
     notare un numero letto male, non a vietarlo. */
  function numberShape(number) { return String(number || '').toUpperCase().replace(/[A-Z]/g, 'A').replace(/\d/g, '9'); }
  function docId(partyId, number) { return `${partyId}__${numberKey(number)}`; }
  /* Una fattura può avere più nomi: il numero stampato (3DF07870-0059)
     e l'ID del sistema di pagamento che compare nei report
     (in_1UH0a6…). È la stessa fattura con l'uno o con l'altro. */
  function docKeys(d) {
    return [d.number, ...(Array.isArray(d.altNumbers) ? d.altNumbers : [])].map(numberKey).filter(Boolean);
  }

  function vatKey(country, code) { return `${String(country || '').toUpperCase()}${String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`; }

  /* ---------------------------------------------------------------- */
  /* I tuoi dati                                                       */
  /* ---------------------------------------------------------------- */

  function validPiva(p) {
    if (!/^\d{11}$/.test(p)) return false;
    let sum = 0;
    for (let i = 0; i < 11; i += 1) {
      let d = Number(p[i]);
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return sum % 10 === 0;
  }
  const CF_ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
  function validCf(cf) {
    if (/^\d{11}$/.test(cf)) return validPiva(cf);
    if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
    let sum = 0;
    for (let i = 0; i < 15; i += 1) {
      const ch = cf[i];
      if (i % 2 === 0) sum += CF_ODD[ch];
      else sum += /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
    }
    return String.fromCharCode(65 + (sum % 26)) === cf[15];
  }

  /** Cosa manca ai tuoi dati per emettere un'autofattura: campo → motivo. */
  function meProblems(me) {
    const m = me || {};
    const out = {};
    if (!validPiva(String(m.piva || ''))) out.piva = 'partita IVA non valida';
    if (!validCf(String(m.cf || '').toUpperCase())) out.cf = 'codice fiscale non valido';
    if (!m.denominazione && !(m.nome && m.cognome)) out.nome = 'serve la denominazione, oppure nome e cognome';
    if (!m.indirizzo) out.indirizzo = 'indirizzo mancante';
    if (!/^\d{5}$/.test(m.cap || '')) out.cap = 'CAP a 5 cifre';
    if (!m.comune) out.comune = 'comune mancante';
    if (!/^[A-Za-z]{2}$/.test(m.provincia || '')) out.provincia = 'provincia a 2 lettere';
    if (!/^[A-Za-z0-9]{6,7}$/.test(m.sdi || '')) out.sdi = 'codice destinatario di 6 o 7 caratteri';
    if (/^0+$/.test(m.sdi || '') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.pec || '')) out.pec = 'con destinatario 0000000 serve la PEC';
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Binario IVA e registro dei costi                                  */
  /* ---------------------------------------------------------------- */

  /* Il binario di ogni documento: decide se serve la TD17 e quanto
     costa davvero. Si sceglie per documento, non per fornitore: lo
     stesso fornitore estero può fatturare senza IVA (TD17) e, se non ha
     riconosciuto la partita IVA, con l'IVA già dentro (niente TD17). */
  const TREATMENTS = {
    reverse: { label: 'Estero senza IVA → TD17', short: 'TD17' },
    foreignVat: { label: 'IVA estera già pagata → niente TD17', short: 'IVA già pagata' },
    domestic: { label: 'Italiano con IVA → niente TD17', short: 'italiano' },
    noVat: { label: 'Senza IVA → niente TD17', short: 'senza IVA' },
    income: { label: 'Entrata', short: 'entrata' },
  };

  const CATEGORIES = {
    pubblicita: { label: 'Pubblicità e marketing', pct: 100 },
    software: { label: 'Software e servizi online', pct: 100 },
    collaboratori: { label: 'Influencer e collaboratori', pct: 100 },
    consulenze: { label: 'Commercialista e consulenze', pct: 100 },
    commissioni: { label: 'Commissioni e spese bancarie', pct: 100 },
    telefono: { label: 'Telefono e internet', pct: 80 },
    beni: { label: 'Computer e beni strumentali', pct: 100 },
    formazione: { label: 'Formazione', pct: 100 },
    altro: { label: 'Altri costi', pct: 100 },
    vendite: { label: 'Vendite app', pct: 100, income: true },
    altriRicavi: { label: 'Altri ricavi', pct: 100, income: true },
  };
  /* Sopra questa cifra un bene strumentale si ammortizza, non si deduce
     tutto nell'anno. */
  const ASSET_LIMIT = 516.46;

  function guessCategory(party) {
    const p = party || {};
    if (p.role === 'customer') return /apple|google play/i.test(p.name || '') ? 'vendite' : 'altriRicavi';
    const text = `${p.name || ''} ${(p.aliases || []).join(' ')} ${p.description || ''}`;
    if (/meta|facebook|instagram|tiktok|google ads|pubblicit|advertis|ads\b/i.test(text)) return 'pubblicita';
    if (/cursor|anysphere|openai|anthropic|github|superwall|appsflyer|revenuecat|google cloud|firebase|vercel|notion|figma|software|developer/i.test(text)) return 'software';
    if (/influencer|creator|ugc/i.test(text)) return 'collaboratori';
    if (/banca|bank|stripe|paypal|commission/i.test(text)) return 'commissioni';
    return 'altro';
  }
  function categoryOf(doc, party) {
    const c = (doc && doc.category) || (party && party.category);
    return CATEGORIES[c] ? c : guessCategory(party);
  }

  /* Il binario proposto per un documento nuovo. `fromReport`: la riga
     viene da un report CSV, che non dice se nell'importo c'è IVA; per
     i fornitori esteri allora non si propone niente, si sceglie. */
  function defaultTreatment(party, { vat = 0, fromReport = false } = {}) {
    if (!party) return '';
    if (party.role === 'customer') return 'income';
    if (party.vatMode === 'domestic') return 'domestic';
    if (party.vatMode === 'none') return 'noVat';
    if (Number(vat) > 0) return 'foreignVat';
    return fromReport ? '' : 'reverse';
  }
  /* I documenti registrati prima che esistesse il binario lo ricavano
     dal soggetto, come faceva il sistema allora. */
  function treatmentOf(doc, party) {
    if (doc && TREATMENTS[doc.treatment]) return doc.treatment;
    return defaultTreatment(party, { vat: doc && doc.vat }) || 'reverse';
  }
  function docNeedsTd17(doc, party) {
    return Boolean(party && party.role !== 'customer' && treatmentOf(doc, party) === 'reverse');
  }
  /* Quanto pesa un documento: il costo (o il ricavo) che va nel
     registro. L'IVA estera già pagata non si recupera, quindi è costo;
     quella italiana si detrae, quindi no. */
  function costOf(doc, party) {
    const t = treatmentOf(doc, party);
    const amount = Number(doc.amount) || 0;
    const vat = Number(doc.vat) || 0;
    return round2(t === 'foreignVat' || t === 'noVat' ? amount + vat : amount);
  }
  function vatDeductibleOf(doc, party) { return treatmentOf(doc, party) === 'domestic' ? round2(Number(doc.vat) || 0) : 0; }
  function deductPctOf(doc, party) {
    const raw = doc ? doc.deductPct : null;
    if (raw !== null && raw !== undefined && raw !== '' && Number(raw) >= 0 && Number(raw) <= 100) return Number(raw);
    return CATEGORIES[categoryOf(doc, party)].pct;
  }
  function beforePiva(doc, me) { return Boolean(me && isIsoDate(me.pivaStart) && isIsoDate(doc.date) && doc.date < me.pivaStart); }
  function deductibleOf(doc, party, me) {
    if (beforePiva(doc, me) || (party && party.role === 'customer')) return 0;
    return round2(costOf(doc, party) * deductPctOf(doc, party) / 100);
  }

  function partyProblems(p) {
    const out = [];
    if (!p || !p.name) out.push('nome mancante');
    if (!/^[A-Z]{2}$/.test(String((p || {}).country || '').toUpperCase())) out.push('paese a 2 lettere');
    if (p && p.vatMode === 'reverse') {
      if (EU.has(String(p.country).toUpperCase()) && !p.vatCode) out.push('partita IVA mancante (serve per la TD17)');
      if (!p.address || !p.city) out.push('indirizzo o città mancanti (servono per la TD17)');
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Controlli su un lotto di documenti                                */
  /* ---------------------------------------------------------------- */

  /**
   * Per ogni documento del lotto dice cosa lo blocca e cosa va guardato.
   *   rows:    [{ ref, partyId, number, date, amount, periodFrom, periodTo, vatIds, currency }]
   *   archive: documenti già registrati, stessa forma più { id, selfInvoiceId }
   *   parties: { [id]: party }
   * Un blocco non si supera; un avviso sì, ma va confermato a mano.
   */
  function review(rows, archive, parties, me) {
    const today = todayIso();
    const byParty = new Map();
    for (const d of archive) {
      if (!byParty.has(d.partyId)) byParty.set(d.partyId, []);
      byParty.get(d.partyId).push(d);
    }
    const oldest = new Date(Date.now() - 548 * 86400000).toISOString().slice(0, 10);

    return rows.map((row, index) => {
      const blocks = [];
      const warns = [];
      const party = row.partyId ? parties[row.partyId] : null;
      const key = numberKey(row.number);

      if (!row.partyId) blocks.push('fornitore o cliente da scegliere');
      if (!key) blocks.push('numero mancante');
      if (!isIsoDate(row.date)) blocks.push('data mancante');
      else if (row.date > today) blocks.push('data nel futuro');
      if (!(Number(row.amount) > 0)) blocks.push('importo mancante');
      for (const b of row.blockers || []) blocks.push(b);
      if (row.originalCurrency && !(Number(row.fxRate) > 0)) blocks.push(`importo in ${row.originalCurrency}: manca il cambio BCE per convertirlo`);

      const known = byParty.get(row.partyId) || [];
      if (key && row.partyId) {
        const keys = docKeys(row);
        const overlaps = (d) => docKeys(d).some((k) => keys.includes(k));
        const same = known.find(overlaps);
        if (same) blocks.push(same.selfInvoiceId ? `già registrata come ${same.number}, e già nella TD17 ${same.selfInvoiceNumber || ''}`.trim() : `già registrata come ${same.number} il ${itDate((same.createdAt || '').slice(0, 10))}`);
        // Solo le righe prima di questa: il primo esemplare resta buono, le
        // copie si bloccano e si possono togliere dal lotto.
        const twin = rows.slice(0, index).find((r) => r.partyId === row.partyId && overlaps(r));
        if (twin) blocks.push(`doppione di ${twin.fileName || twin.file || twin.number}, già in questo caricamento`);
      }

      if (row.partyId && isIsoDate(row.date) && Number(row.amount) > 0) {
        // Le righe di uno stesso report CSV sono transazioni distinte per
        // costruzione: due addebiti uguali nello stesso giorno sono normali.
        const lookalike = [...known, ...rows.filter((r) => r !== row && r.partyId === row.partyId && !(row.source && r.source === row.source))]
          .find((d) => d.date === row.date && round2(d.amount) === round2(row.amount) && numberKey(d.number) !== key);
        if (lookalike) warns.push(`stessa data e stesso importo di ${lookalike.number}: controlla che non sia un doppione`);
      }

      if (isIsoDate(row.periodFrom) && isIsoDate(row.periodTo)) {
        const overlap = known.find((d) => isIsoDate(d.periodFrom) && isIsoDate(d.periodTo)
          && numberKey(d.number) !== key
          && row.periodFrom < d.periodTo && row.periodTo > d.periodFrom);
        if (overlap) warns.push(`il periodo ${itDate(row.periodFrom)}–${itDate(row.periodTo)} si sovrappone a ${overlap.number} (${itDate(overlap.periodFrom)}–${itDate(overlap.periodTo)})`);
      }

      // Un numero letto da un PDF può essere sbagliato; uno da un report
      // CSV no, e ha comunque una forma diversa (ID transazione).
      if (key && known.length >= 2 && !row.source) {
        const shapes = new Set(known.map((d) => numberShape(d.number)));
        if (shapes.size === 1 && !shapes.has(numberShape(row.number))) {
          warns.push(`il numero ha una forma diversa dai precedenti (${known[0].number}): forse è letto male`);
        }
      }

      if (party && party.vatCode && Array.isArray(row.vatIds) && row.vatIds.length) {
        const mine = vatKey(party.country, party.vatCode);
        if (!row.vatIds.includes(mine)) warns.push(`nel documento c'è la partita IVA ${row.vatIds[0]}, in anagrafica ${mine}`);
      }

      const t = row.treatment;
      const vat = Number(row.vat) || 0;
      if (!TREATMENTS[t]) {
        blocks.push(row.source && party && party.role !== 'customer'
          ? 'binario da scegliere: il report non dice se nell\'importo c\'è IVA (guarda una fattura)'
          : 'binario da scegliere');
      } else if (party) {
        if (party.role === 'customer' && t !== 'income') blocks.push('è un cliente: il binario è "Entrata"');
        if (party.role !== 'customer' && t === 'income') blocks.push('è un fornitore: non può essere un\'entrata');
        if (t === 'reverse' && vat > 0) blocks.push(`c'è IVA in fattura (${fixed2(vat)} €): se te l'hanno addebitata il binario è "IVA estera già pagata", e niente TD17`);
        if (t === 'reverse' && String(party.country).toUpperCase() === 'IT') blocks.push('fornitore italiano: niente TD17, la fattura ti arriva già via SdI');
        if (t === 'reverse' && beforePiva(row, me)) blocks.push(`prima dell'apertura della partita IVA (${itDate(me.pivaStart)}) non si fa TD17`);
        if (t === 'foreignVat' && !(vat > 0)) warns.push('IVA già pagata ma IVA a zero: scrivi quella della fattura, serve al registro');
        if (t === 'foreignVat' && party.vatMode === 'reverse' && !beforePiva(row, me)) warns.push(`${party.name} di solito fattura senza IVA: se l'ha addebitata forse non ha riconosciuto la tua partita IVA (VIES). Chiedi la correzione o il rimborso`);
        if (t === 'domestic' && !(vat > 0)) warns.push('IVA a zero: se il fornitore non la addebita (forfettario, esente) il binario è "Senza IVA"');
        if (t !== 'income' && beforePiva(row, me)) warns.push(`prima dell'apertura della partita IVA (${itDate(me.pivaStart)}): resta in archivio ma non conta tra i costi deducibili`);
        if (t !== 'income' && categoryOf(row, party) === 'beni' && costOf(row, party) > ASSET_LIMIT) warns.push(`bene strumentale sopra ${fixed2(ASSET_LIMIT)} €: di solito si ammortizza in più anni, chiedi al commercialista`);
      }
      if (isIsoDate(row.date) && row.date < oldest) warns.push('documento di più di 18 mesi fa');
      for (const note of row.notes || []) warns.push(note);

      return { blocks, warns };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Autofatture TD17                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Raggruppa i documenti da integrare. "supplierMonth": una TD17 per
   * fornitore e per mese, con una riga per fattura. "invoice": una per
   * fattura. Una TD17 ha un solo cedente, quindi fornitori diversi non
   * finiscono mai nello stesso XML.
   */
  function td17Groups(docs, parties, mode) {
    const groups = new Map();
    for (const d of docs) {
      if (!docNeedsTd17(d, parties[d.partyId]) || d.selfInvoiceId) continue;
      const k = mode === 'invoice' ? `${d.partyId}|${numberKey(d.number)}` : `${d.partyId}|${d.date.slice(0, 7)}`;
      if (!groups.has(k)) groups.set(k, { partyId: d.partyId, month: d.date.slice(0, 7), docs: [] });
      groups.get(k).docs.push(d);
    }
    const today = todayIso();
    const list = [...groups.values()].map((g) => {
      g.docs.sort((a, b) => a.date.localeCompare(b.date) || numberKey(a.number).localeCompare(numberKey(b.number)));
      const latest = g.docs[g.docs.length - 1].date;
      // Una per fattura: la data è quella della fattura. Riepilogativa:
      // l'ultimo giorno del mese, o oggi se il mese non è finito, e mai
      // prima dell'ultima fattura che contiene.
      let date = mode === 'invoice' ? latest : monthEnd(latest);
      if (date > today) date = today;
      if (date < latest) date = latest;
      g.date = date;
      g.base = round2(g.docs.reduce((s, d) => s + Number(d.amount), 0));
      return g;
    });
    return list.sort((a, b) => a.date.localeCompare(b.date) || a.partyId.localeCompare(b.partyId));
  }

  function formatNumber(numbering, seq) {
    const n = numbering || {};
    const digits = Math.min(6, Math.max(1, parseInt(n.digits, 10) || 2));
    return `${n.prefix || ''}${String(seq).padStart(digits, '0')}${n.suffix || ''}`;
  }

  function progressivo(counter) { return Number(counter).toString(36).toUpperCase().padStart(5, '0').slice(-5); }

  function x(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }
  function clip(value, max) { return String(value ?? '').slice(0, max); }
  /* IdDocumento tiene 20 caratteri. Un numero Meta ne ha spesso 22: si
     toglie il prefisso fisso, il numero intero resta nella descrizione. */
  function linkedId(number) {
    const s = String(number).trim();
    if (s.length <= 20) return s;
    // ID transazione Meta, "28749156431435797-28567425109608930": la
    // prima metà basta a identificarla, l'ID intero è nella descrizione.
    const tx = s.match(/^(\d{8,20})-\d{8,}$/);
    if (tx) return tx[1];
    const bare = s.replace(/^[A-Za-z]+-?/, '');
    return bare.length <= 20 ? bare : bare.slice(-20);
  }

  function buildTd17Xml({ me, party, docs, number, date, prog, vatRate }) {
    const rate = Number(vatRate);
    const base = round2(docs.reduce((s, d) => s + Number(d.amount), 0));
    const vat = round2(base * rate / 100);
    const total = round2(base + vat);
    const country = String(party.country).toUpperCase();
    const eu = EU.has(country);
    const cf = String(me.cf).toUpperCase();
    const sdi = String(me.sdi).toUpperCase();
    const pec = /^0+$/.test(sdi);
    const who = me.denominazione
      ? `<Denominazione>${x(clip(me.denominazione, 80))}</Denominazione>`
      : `<Nome>${x(clip(me.nome, 60))}</Nome><Cognome>${x(clip(me.cognome, 60))}</Cognome>`;
    const legal = eu
      ? 'Integrazione IVA per servizi da soggetto UE, art. 17 c. 2 DPR 633/72, inversione contabile.'
      : 'Autofattura per servizi da soggetto extra UE, art. 17 c. 2 DPR 633/72.';
    const refs = docs.map((d) => `${d.number} del ${itDate(d.date)}`).join(', ');
    // Un report CSV può elencare fatture (Cursor, Stripe) o addebiti con
    // ID transazione (Meta, "28749156431435797-28567425109608930").
    const isTx = (d) => Boolean(d.source) && /^\d{8,}-\d{8,}$/.test(String(d.number));
    const kind = (d) => (isTx(d) ? 'transazione' : 'fattura');
    const heading = docs.every(isTx) ? 'Transazioni' : docs.some(isTx) ? 'Fatture e transazioni' : 'Fatture';
    // Causale si ripete a blocchi di 200 caratteri: con molte fatture
    // l'elenco non ci sta in uno solo, e tagliarlo lo renderebbe falso.
    const causaleText = `${legal} ${heading} ${party.name}: ${refs}.`;
    const causali = [];
    let rest = causaleText;
    while (rest.length > 200) {
      const cut = rest.lastIndexOf(' ', 200);
      const at = cut > 0 ? cut : 200;
      causali.push(rest.slice(0, at));
      rest = rest.slice(at).trimStart();
    }
    causali.push(rest);
    const lines = docs.map((d, i) => {
      const period = isIsoDate(d.periodFrom) && isIsoDate(d.periodTo) ? `, periodo ${itDate(d.periodFrom)}-${itDate(d.periodTo)}` : '';
      const fx = d.originalCurrency && d.fxRate
        ? `, importo originale ${fixed2(d.originalAmount)} ${d.originalCurrency} al cambio BCE ${d.fxRate} del ${itDate(d.fxRateDate)}`
        : '';
      return `      <DettaglioLinee>
        <NumeroLinea>${i + 1}</NumeroLinea>
        <Descrizione>${x(clip(`${party.description || 'Servizi'} - ${kind(d)} ${d.number} del ${itDate(d.date)}${period}${fx}`, 1000))}</Descrizione>
        <Quantita>1.00</Quantita>
        <PrezzoUnitario>${fixed2(d.amount)}</PrezzoUnitario>
        <PrezzoTotale>${fixed2(d.amount)}</PrezzoTotale>
        <AliquotaIVA>${fixed2(rate)}</AliquotaIVA>
      </DettaglioLinee>`;
    }).join('\n');
    const linked = docs.map((d) => `      <DatiFattureCollegate>
        <IdDocumento>${x(linkedId(d.number))}</IdDocumento>
        <Data>${d.date}</Data>
      </DatiFattureCollegate>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${x(cf)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${x(prog)}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${pec ? '0000000' : x(sdi)}</CodiceDestinatario>${pec ? `
      <PECDestinatario>${x(me.pec)}</PECDestinatario>` : ''}
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>${x(country)}</IdPaese>
          <IdCodice>${x(party.vatCode ? String(party.vatCode).toUpperCase().replace(/[^A-Z0-9]/g, '') : '99999999999')}</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica>
          <Denominazione>${x(clip(party.name, 80))}</Denominazione>
        </Anagrafica>
        <RegimeFiscale>RF18</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${x(clip(party.address, 60))}</Indirizzo>
        <CAP>${/^\d{5}$/.test(party.cap || '') ? party.cap : '00000'}</CAP>
        <Comune>${x(clip(party.city, 60))}</Comune>
        <Nazione>${x(country)}</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${x(String(me.piva).replace(/\D/g, ''))}</IdCodice>
        </IdFiscaleIVA>
        <CodiceFiscale>${x(cf)}</CodiceFiscale>
        <Anagrafica>
          ${who}
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${x(clip(me.indirizzo, 60))}</Indirizzo>${me.civico ? `
        <NumeroCivico>${x(clip(me.civico, 8))}</NumeroCivico>` : ''}
        <CAP>${x(me.cap)}</CAP>
        <Comune>${x(clip(me.comune, 60))}</Comune>
        <Provincia>${x(String(me.provincia).toUpperCase())}</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
    <SoggettoEmittente>CC</SoggettoEmittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD17</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${date}</Data>
        <Numero>${x(clip(number, 20))}</Numero>
        <ImportoTotaleDocumento>${fixed2(total)}</ImportoTotaleDocumento>
${causali.map((c) => `        <Causale>${x(c)}</Causale>`).join('\n')}
      </DatiGeneraliDocumento>
${linked}
    </DatiGenerali>
    <DatiBeniServizi>
${lines}
      <DatiRiepilogo>
        <AliquotaIVA>${fixed2(rate)}</AliquotaIVA>
        <ImponibileImporto>${fixed2(base)}</ImponibileImporto>
        <Imposta>${fixed2(vat)}</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
`;
  }

  function td17FileName(me, prog) { return `IT${String(me.cf).toUpperCase()}_${prog}.xml`; }

  return {
    EU, round2, fixed2, itDate, isIsoDate, monthEnd, todayIso,
    numberKey, numberShape, docId, docKeys, vatKey,
    validPiva, validCf, meProblems, partyProblems,
    TREATMENTS, CATEGORIES, ASSET_LIMIT, guessCategory, categoryOf, defaultTreatment, treatmentOf, docNeedsTd17,
    costOf, vatDeductibleOf, deductPctOf, beforePiva, deductibleOf,
    review, td17Groups, formatNumber, progressivo, buildTd17Xml, td17FileName,
  };
}));
