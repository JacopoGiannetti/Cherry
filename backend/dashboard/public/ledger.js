/* Contabilità — client.

   Cinque schede. Panoramica: entrate e uscite dell'anno, mese per
   mese e per soggetto. Carica: i PDF si trascinano qui, vengono letti
   in questo browser, raggruppati per fornitore o cliente, controllati
   contro l'archivio, e registrati (con o senza XML delle TD17).
   Documenti: l'archivio, e le TD17 già numerate. Dichiarazione: costi
   deducibili, ricavi e IVA per trimestre, con il registro da dare al
   commercialista. Anagrafiche: i tuoi dati, la numerazione, i soggetti.

   Ogni documento ha un binario (core.TREATMENTS): è quello, non il
   fornitore, a decidere se serve la TD17 e quanto costa davvero.

   Le regole (doppioni, raggruppamento, XML) stanno in ledger-core.js,
   che il server riusa: quello che si vede qui è quello che il server
   deciderà. */

import * as pdfjs from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

const core = window.LedgerCore;
const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const money = (n) => (Number.isFinite(Number(n)) ? eur.format(Number(n)) : '—');
const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MONTHS_LONG = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function monthLabel(ym) { const [y, m] = ym.split('-'); return `${MONTHS_LONG[Number(m) - 1]} ${y}`; }

let state = { settings: null, parties: [], docs: [], selfInvoices: [] };
let partyById = {};

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/ledger${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.details = data.details;
    throw error;
  }
  return data;
}

async function reload() {
  state = await api('/');
  partyById = Object.fromEntries(state.parties.map((p) => [p.id, p]));
  renderAll();
}

function renderAll() {
  renderSetupAlert();
  renderOverview();
  renderBatch();
  renderDocs();
  renderTax();
  renderSettings();
  renderParties();
}

/* ------------------------------------------------------------------ */
/* Schede                                                              */
/* ------------------------------------------------------------------ */

const TITLES = { panoramica: 'Entrate e uscite', carica: 'Carica documenti', documenti: 'Archivio', dichiarazione: 'Per la dichiarazione', anagrafiche: 'Anagrafiche' };

const TREAT_TONE = { reverse: 'warn', foreignVat: 'bad', domestic: '', noVat: '', income: 'in' };
function treatPill(t) {
  const info = core.TREATMENTS[t];
  return info ? `<span class="pill t-${t} ${TREAT_TONE[t]}" title="${esc(info.label)}">${esc(info.short)}</span>` : '<span class="pill bad">binario?</span>';
}
function treatOf(d) { return core.treatmentOf(d, partyById[d.partyId]); }
function costOfDoc(d) { return core.costOf(d, partyById[d.partyId]); }
function totalOf(d) { return core.round2((Number(d.amount) || 0) + (Number(d.vat) || 0)); }

function showTab(name) {
  const tab = TITLES[name] ? name : 'panoramica';
  document.querySelectorAll('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== tab; });
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('title').textContent = TITLES[tab];
  if (tab === 'panoramica') renderOverview();
  if (tab === 'dichiarazione') renderTax();
}

function wireTabs() {
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) location.hash = b.dataset.tab;
  });
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
}

function renderSetupAlert() {
  const problems = Object.values(core.meProblems(state.settings.me));
  const alert = $('setupAlert');
  alert.hidden = problems.length === 0;
  alert.innerHTML = problems.length
    ? `Per generare le autofatture mancano i tuoi dati (${esc(problems.join(', '))}). <a href="#anagrafiche">Completali in Anagrafiche</a>. Registrare i documenti si può già.`
    : '';
}

/* ------------------------------------------------------------------ */
/* Panoramica                                                          */
/* ------------------------------------------------------------------ */

let chart = null;

function years() {
  const set = new Set([String(new Date().getFullYear())]);
  for (const d of state.docs) set.add(d.date.slice(0, 4));
  return [...set].sort().reverse();
}

function fillYearSelect(select) {
  const current = select.value;
  select.innerHTML = years().map((y) => `<option value="${y}">${y}</option>`).join('');
  if (current && [...select.options].some((o) => o.value === current)) select.value = current;
}

function barsHtml(rows, color) {
  if (!rows.length) return '<p class="empty">Niente in questo anno.</p>';
  const top = Math.max(...rows.map((r) => r.n), 1);
  return rows.map((r) => `
    <div class="row">
      <span class="l" title="${esc(r.label)}">${esc(r.label)}</span>
      <div class="bar"><span class="${color}" style="width:${Math.min(100, (r.n / top) * 100).toFixed(1)}%"></span></div>
      <span class="n">${money(r.n)}<small>${esc(r.sub || '')}</small></span>
    </div>`).join('');
}

function stat(label, value, sub, tone = '') {
  return `<div class="stat ${tone}"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

function renderOverview() {
  if (!state.settings) return;
  fillYearSelect($('yearPick'));
  const year = $('yearPick').value;
  const docs = state.docs.filter((d) => d.date.startsWith(year));
  const td17 = state.selfInvoices.filter((s) => s.date.startsWith(year));
  const inDocs = docs.filter((d) => d.direction === 'in');
  const outDocs = docs.filter((d) => d.direction === 'out');
  // Entrate all'imponibile, uscite al costo effettivo: l'IVA estera già
  // pagata non si recupera, quindi è costo (core.costOf).
  const sum = (list) => core.round2(list.reduce((s, d) => s + (d.direction === 'out' ? costOfDoc(d) : Number(d.amount || 0)), 0));
  const income = sum(inDocs);
  const spend = sum(outDocs);
  const vatIntegrated = core.round2(td17.reduce((s, t) => s + Number(t.vat || 0), 0));
  const margin = core.round2(income - spend);
  const pending = outDocs.filter((d) => core.docNeedsTd17(d, partyById[d.partyId]) && !d.selfInvoiceId).length;

  $('kpis').innerHTML = [
    stat('Entrate', money(income), `${inDocs.length} documenti`, 'good'),
    stat('Uscite', money(spend), `${outDocs.length} documenti`),
    stat('Margine', money(margin), income ? `${Math.round((margin / income) * 100)}% delle entrate` : 'nessuna entrata registrata', margin < 0 ? 'bad' : ''),
    stat('IVA integrata', money(vatIntegrated), `${td17.length} autofatture TD17`),
    stat('TD17 da fare', String(pending), pending ? 'fatture estere senza autofattura' : 'tutto integrato', pending ? 'warn' : ''),
  ].join('');

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const rows = months.map((m) => {
    const inM = sum(inDocs.filter((d) => d.month === m));
    const outM = sum(outDocs.filter((d) => d.month === m));
    const vatM = core.round2(td17.filter((t) => t.date.slice(0, 7) === m).reduce((s, t) => s + Number(t.vat || 0), 0));
    const n = docs.filter((d) => d.month === m).length;
    return { m, inM, outM, vatM, n, net: core.round2(inM - outM) };
  });
  const lastUsed = rows.reduce((k, r, i) => (r.n ? i : k), -1);
  const shown = rows.slice(0, Math.max(lastUsed + 1, year === String(new Date().getFullYear()) ? new Date().getMonth() + 1 : 12));
  $('monthsHint').textContent = docs.length ? `${docs.length} documenti nel ${year}` : `nessun documento nel ${year}`;

  const green = cssVar('--c-green');
  const red = cssVar('--c-red');
  const ink = cssVar('--ink-2');
  if (chart) chart.destroy();
  if (typeof Chart !== 'undefined') {
    chart = new Chart($('monthsChart'), {
      data: {
        labels: shown.map((r) => MONTHS_IT[Number(r.m.slice(5)) - 1]),
        datasets: [
          { type: 'bar', label: 'Entrate', data: shown.map((r) => r.inM), backgroundColor: green, borderRadius: 6, maxBarThickness: 28 },
          { type: 'bar', label: 'Uscite', data: shown.map((r) => r.outM), backgroundColor: red, borderRadius: 6, maxBarThickness: 28 },
          { type: 'line', label: 'Margine', data: shown.map((r) => r.net), borderColor: ink, backgroundColor: ink, pointRadius: 3, tension: 0.3 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', align: 'start' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } } },
        scales: { y: { ticks: { callback: (v) => eur.format(v).replace(',00', '') } }, x: { grid: { display: false } } },
      },
    });
  }

  const byParty = (list) => {
    const map = new Map();
    for (const d of list) map.set(d.partyId, (map.get(d.partyId) || 0) + (d.direction === 'out' ? costOfDoc(d) : Number(d.amount || 0)));
    const total = [...map.values()].reduce((s, v) => s + v, 0) || 1;
    return [...map.entries()].sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({ label: (partyById[id] || {}).name || id, n: core.round2(n), sub: `${Math.round((n / total) * 100)}%` }));
  };
  const inRows = byParty(inDocs);
  const outRows = byParty(outDocs);
  $('inHint').textContent = !inRows.length ? '' : inRows.length === 1 ? '1 cliente' : `${inRows.length} clienti`;
  $('outHint').textContent = !outRows.length ? '' : outRows.length === 1 ? '1 fornitore' : `${outRows.length} fornitori`;
  $('inBars').innerHTML = barsHtml(inRows, '');
  $('outBars').innerHTML = barsHtml(outRows, 'red');

  const tot = rows.reduce((a, r) => ({ inM: a.inM + r.inM, outM: a.outM + r.outM, vatM: a.vatM + r.vatM, n: a.n + r.n }), { inM: 0, outM: 0, vatM: 0, n: 0 });
  $('monthsTable').innerHTML = `<thead><tr><th>Mese</th><th>Entrate</th><th>Uscite</th><th>Margine</th><th>IVA integrata</th><th>Documenti</th></tr></thead>
    <tbody>${shown.map((r) => `<tr class="${r.n ? '' : 'muted'}"><td>${monthLabel(r.m)}</td><td>${money(r.inM)}</td><td>${money(r.outM)}</td><td class="${r.net < 0 ? 'neg' : ''}">${money(r.net)}</td><td>${money(r.vatM)}</td><td>${r.n}</td></tr>`).join('')}
    <tr class="total"><td>Totale ${year}</td><td>${money(tot.inM)}</td><td>${money(tot.outM)}</td><td>${money(tot.inM - tot.outM)}</td><td>${money(tot.vatM)}</td><td>${tot.n}</td></tr></tbody>`;
}

/* ------------------------------------------------------------------ */
/* Lettura dei PDF                                                     */
/* ------------------------------------------------------------------ */

async function pdfText(file) {
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], s: item.str });
    }
    for (const [, items] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      lines.push(items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim());
    }
  }
  return lines;
}

const MONTHS = {
  gen: 1, gennaio: 1, jan: 1, january: 1, feb: 2, febbraio: 2, february: 2, mar: 3, marzo: 3, march: 3,
  apr: 4, aprile: 4, april: 4, mag: 5, maggio: 5, may: 5, giu: 6, giugno: 6, jun: 6, june: 6,
  lug: 7, luglio: 7, jul: 7, july: 7, ago: 8, agosto: 8, aug: 8, august: 8,
  set: 9, sett: 9, settembre: 9, sep: 9, sept: 9, september: 9, ott: 10, ottobre: 10, oct: 10, october: 10,
  nov: 11, novembre: 11, november: 11, dic: 12, dicembre: 12, dec: 12, december: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

function datesIn(line) {
  const found = [];
  const push = (index, y, m, d) => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2015 || y > 2100) return;
    found.push({ index, iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  };
  let m;
  const res = [
    [/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/g, (r) => [Number(r[3]), Number(r[2]), Number(r[1])]],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/g, (r) => [Number(r[1]), Number(r[2]), Number(r[3])]],
    [new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_RE})\\.?\\s+(\\d{4})\\b`, 'gi'), (r) => [Number(r[3]), MONTHS[r[2].toLowerCase()], Number(r[1])]],
    [new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'), (r) => [Number(r[3]), MONTHS[r[1].toLowerCase()], Number(r[2])]],
  ];
  for (const [re, pick] of res) while ((m = re.exec(line))) push(m.index, ...pick(m));
  return found.sort((a, b) => a.index - b.index).map((f) => f.iso);
}

function parseAmount(raw) {
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return null;
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    const dec = dot > comma ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (comma >= 0) {
    s = s.length - comma - 1 === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (dot >= 0 && s.length - dot - 1 !== 2) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* Importi di una riga: prima quelli con la valuta accanto, poi, se non
   ce ne sono, i numeri con due decimali (le fatture italiane spesso
   scrivono "78,00" senza simbolo). */
function amountsIn(line) {
  const out = [];
  const withCur = /(?:€|EUR|USD|\$|£|GBP)\s?(\d[\d.,]*\d|\d)|(\d[\d.,]*\d|\d)\s?(?:€|EUR|USD|\$|£|GBP)/gi;
  let m;
  while ((m = withCur.exec(line))) { const n = parseAmount(m[1] || m[2]); if (n > 0) out.push(n); }
  if (out.length) return out;
  const bare = /(?<![\d/.\-])(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+[.,]\d{2})(?![\d/.\-])/g;
  while ((m = bare.exec(line))) { const n = parseAmount(m[1]); if (n > 0) out.push(n); }
  return out;
}

const VAT_RE = /\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|GB|CH)[\s-]?([0-9A-Z]{8,12})\b/g;

function vatIdsIn(text) {
  const out = new Set();
  let m;
  while ((m = VAT_RE.exec(text.toUpperCase()))) {
    if ((m[2].match(/\d/g) || []).length >= 6) out.add(core.vatKey(m[1], m[2]));
  }
  // "Partita IVA 01234567897" senza prefisso: è italiana.
  const it = /(?:partita\s*iva|p\.?\s?iva|vat\s*(?:number|no\.?|id))\s*[:.]?\s*(\d{11})\b/gi;
  while ((m = it.exec(text))) out.add(core.vatKey('IT', m[1]));
  return [...out];
}

const COMPANY_RE = /\b(limited|ltd\.?|inc\.?|llc|gmbh|s\.?r\.?l\.?s?|s\.?p\.?a\.?|b\.?v\.?|s\.?a\.?s\.?|sarl|ag|pte|corp(?:oration)?|plc|oy|ab|s\.?a\.?)(?=\s|$|,)/i;

function extract(lines, me) {
  const text = lines.join('\n');
  const notes = [];
  const isPeriod = /periodo|period|billing cycle|dal\s+\d|from\s+\w+\s+\d/i;

  let number = null;
  const fb = text.match(/FBADS[\s\-–]*(\d{2,})[\s\-–]*(\d{4,})/i);
  if (fb) number = `FBADS-${fb[1]}-${fb[2]}`;
  if (!number) {
    const labelled = text.match(/(?:numero (?:della )?(?:fattura|ricevuta|documento)|fattura (?:n\.?|nr\.?|numero)|invoice(?:\/receipt)? (?:number|no\.?|#)|receipt (?:number|no\.?)|n\.\s*fattura|document number|documento n\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/_.]{2,})/i);
    if (labelled) number = labelled[1].replace(/[.]+$/, '');
  }
  if (!number) {
    const tx = text.match(/\b(\d{8,}-\d{8,})\b/);
    if (tx) { number = tx[1]; notes.push('trovato solo un ID transazione: controlla che sia il numero di fattura'); }
  }

  let date = null;
  const dateLabel = /data (?:della )?(?:fattura|ricevuta|documento|di emissione|emissione)|invoice date|receipt date|date of issue|issued on|issue date|\bdata\b|\bdate\b/i;
  for (const line of lines) {
    if (!dateLabel.test(line) || isPeriod.test(line)) continue;
    const found = datesIn(line);
    if (found.length) { date = found[0]; break; }
  }
  if (!date) {
    const all = lines.filter((l) => !isPeriod.test(l)).flatMap(datesIn);
    if (all.length) { date = all[0]; notes.push('la data è la prima trovata nel documento: controllala'); }
  }

  let periodFrom = null;
  let periodTo = null;
  for (const line of lines) {
    if (!isPeriod.test(line)) continue;
    const found = datesIn(line);
    if (found.length >= 2) { [periodFrom, periodTo] = found.slice(0, 2).sort(); break; }
  }

  const last = (re, exclude) => {
    let value = null;
    for (const line of lines) {
      if (!re.test(line) || (exclude && exclude.test(line))) continue;
      const found = amountsIn(line);
      if (found.length) value = found[found.length - 1];
    }
    return value;
  };
  // Prima le righe che cominciano con "Totale", "Amount due"…: una riga
  // di dettaglio come "Mid-month usage paid for…" non è il totale.
  const total = (() => {
    const word = '(totale|total|importo (?:pagato|totale|dovuto)|amount (?:paid|due)|pagato|paid)';
    const pick = (re) => {
      const cands = [];
      for (const line of lines) {
        if (!re.test(line)) continue;
        if (/sub\s?-?total|imponibile|\biva\b|\bvat\b|\btax\b|netto|excluding|excl\./i.test(line)) continue;
        cands.push(...amountsIn(line).slice(-1));
      }
      return cands.length ? Math.max(...cands) : null;
    };
    return pick(new RegExp(`^\\s*${word}\\b`, 'i')) ?? pick(new RegExp(`\\b${word}\\b`, 'i'));
  })();
  const taxable = last(/imponibile|sub\s?-?total|totale netto|net amount|amount before tax|total excluding (?:tax|vat)|excl\.? (?:tax|vat)/i);
  const vat = last(/\b(iva|vat|imposta|tax)\b/i, /partita|p\.?\s?iva|(?:vat|tax)\s*(?:number|no|id|reg)|reverse|inversione|codice|imponibile|sub\s?-?total|totale|total excluding|excluding (?:tax|vat)|excl\.? (?:tax|vat)/i);

  let amount = null;
  if (taxable) amount = taxable;
  else if (total && vat && vat < total) amount = core.round2(total - vat);
  else if (total) amount = total;
  else {
    const all = lines.flatMap(amountsIn);
    if (all.length) { amount = Math.max(...all); notes.push('importo: nessuna riga "totale", preso il più alto'); }
  }
  if (taxable && total && vat && Math.abs(core.round2(taxable + vat) - total) > 0.02) {
    notes.push(`imponibile ${money(taxable)} + IVA ${money(vat)} non fa il totale ${money(total)}`);
  }

  const currency = /\bUSD\b|\$/.test(text) ? 'USD' : (/\bGBP\b|£/.test(text) ? 'GBP' : 'EUR');
  if (core.validPiva(String(me.piva || '')) && !text.replace(/\s/g, '').includes(me.piva)) {
    notes.push('la fattura non riporta la tua partita IVA: è intestata a te come privato, e il costo potrebbe non essere deducibile. Chiedi al fornitore di aggiungerla, o al commercialista');
  }
  const mine = new Set([core.vatKey('IT', me.piva), core.vatKey('IT', me.cf)]);
  const vatIds = vatIdsIn(text).filter((v) => !mine.has(v));

  const myNames = [me.denominazione, [me.nome, me.cognome].filter(Boolean).join(' ')].filter((s) => s && s.length > 3).map((s) => s.toUpperCase());
  const nameIndex = lines.findIndex((l) => COMPANY_RE.test(l) && l.length < 90 && !myNames.some((n) => l.toUpperCase().includes(n)));
  const nameGuess = nameIndex >= 0 ? lines[nameIndex].replace(/\s{2,}.*/, '').trim() : '';
  const addressGuess = nameIndex >= 0 && lines[nameIndex + 1] && lines[nameIndex + 1].length < 90 ? lines[nameIndex + 1] : '';

  return { number, date, amount, vat: taxable || (total && vat && vat < total) ? (vat || 0) : 0, currency, periodFrom, periodTo, vatIds, notes, nameGuess, addressGuess };
}

/* ------------------------------------------------------------------ */
/* Riconoscimento del soggetto                                         */
/* ------------------------------------------------------------------ */

let batch = [];
let drafts = {};
let draftSeq = 0;
let refSeq = 0;

function matchParty(text, vatIds) {
  for (const p of state.parties) {
    if (p.vatCode && vatIds.includes(core.vatKey(p.country, p.vatCode))) return p.id;
  }
  const upper = text.toUpperCase();
  for (const p of state.parties) {
    for (const alias of [p.name, ...(p.aliases || [])]) {
      if (alias && alias.length >= 4 && upper.includes(alias.toUpperCase())) return p.id;
    }
  }
  return null;
}

/* Un soggetto mai visto: una bozza precompilata da quello che il PDF
   dice. Documenti diversi dello stesso nuovo fornitore finiscono nella
   stessa bozza, riconosciuti dalla partita IVA o dal nome. */
function draftFor(got) {
  const vat = got.vatIds[0] || '';
  const key = vat || got.nameGuess.toUpperCase();
  if (!key) return '';
  const existing = Object.values(drafts).find((d) => d.key === key);
  if (existing) return existing.tempId;
  draftSeq += 1;
  const tempId = `new:${draftSeq}`;
  const country = vat ? vat.slice(0, 2) : '';
  const parts = got.addressGuess.split(',').map((s) => s.trim()).filter(Boolean);
  drafts[tempId] = {
    tempId, key, name: got.nameGuess, role: 'supplier',
    vatMode: country === 'IT' ? 'domestic' : 'reverse',
    country, vatCode: vat ? vat.slice(2) : '',
    address: parts[0] || '', city: parts[1] || '', cap: '00000', description: 'Servizi',
    aliases: got.aliasGuess || '',
  };
  drafts[tempId].category = core.guessCategory({ ...drafts[tempId], aliases: [drafts[tempId].aliases] });
  return tempId;
}

function partiesMap() {
  const map = { ...partyById };
  for (const d of Object.values(drafts)) map[d.tempId] = { id: d.tempId, ...d };
  return map;
}

/* ------------------------------------------------------------------ */
/* Report CSV: Meta, Cursor e gli altri export di fatture              */
/* ------------------------------------------------------------------ */

function csvCells(line) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') { cells.push(cur.trim()); cur = ''; } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/* Una riga per addebito: data, numero (o ID transazione), importo,
   valuta. Le colonne si riconoscono dal nome nella riga d'intestazione
   (Meta: "Data,ID della transazione,Importo,Valuta"; Stripe, Cursor,
   OpenAI: "Date,Invoice ID,…,Amount,Currency"). Senza intestazione si
   prova l'ordine data, numero, importo, valuta. Il resto del file
   (partite IVA, totale) serve a riconoscere il fornitore e a
   controllare che non manchino righe. */
const COLUMNS = {
  date: /^(data|date|invoice date|data (della )?fattura|created( \(utc\))?)$/,
  number: /^(id della transazione|transaction id|invoice (id|number|no\.?)|numero( fattura)?|number|id|id fattura)$/,
  amount: /^(importo|amount|total|totale|amount paid|importo pagato)$/,
  currency: /^(valuta|currency)$/,
  description: /^(descrizione|description)$/,
  status: /^(stato|status)$/,
  file: /^(file|pdf)$/,
};
const PAID = /^(paid|pagat[oa]|succeeded|complete[d]?)$/i;
const DATE_CELL = /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}$|^\d{4}-\d{2}-\d{2}$/;

function readReport(text, me) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows = [];
  const header = [];
  let reportTotal = null;
  let cols = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = csvCells(line);
    const names = cells.map((c) => c.toLowerCase().trim());
    const found = Object.fromEntries(Object.entries(COLUMNS).map(([k, re]) => [k, names.findIndex((n) => re.test(n))]));
    if (found.date >= 0 && found.amount >= 0 && found.number >= 0) { cols = found; continue; }
    const c = cols || { date: 0, number: 1, amount: 2, currency: 3, description: -1, status: -1, file: -1 };
    const cell = (k) => (c[k] >= 0 ? cells[c[k]] || '' : '');
    if (DATE_CELL.test(cell('date')) && /\d/.test(cell('number')) && /\d/.test(cell('amount'))) {
      rows.push({
        dateCell: cell('date'), number: cell('number'), amountCell: cell('amount'),
        currency: (cell('currency') || 'EUR').toUpperCase(),
        description: cell('description'), status: cell('status'), file: cell('file'),
      });
    } else if (/total/i.test(line) && reportTotal === null) {
      const amount = cells.find((v) => /\d/.test(v) && /^[-\d.,\s€$]+$/.test(v));
      if (amount) reportTotal = parseAmount(amount);
    } else header.push(line);
  }
  // Giorno e mese: di solito gg/mm, ma un export in inglese può essere
  // mm/gg. Se il secondo numero supera 12 in qualche riga, è mm/gg.
  const parts = rows.map((r) => r.dateCell.split(/[/.\-]/).map(Number));
  const us = parts.some((p) => p[1] > 12) && !parts.some((p) => p[0] > 12);
  const iso = (p, raw) => (p[0] > 1000
    ? raw
    : `${p[2]}-${String(us ? p[0] : p[1]).padStart(2, '0')}-${String(us ? p[1] : p[0]).padStart(2, '0')}`);

  const headerText = header.join('\n');
  const mine = new Set([core.vatKey('IT', me.piva), core.vatKey('IT', me.cf)]);
  const vatIds = vatIdsIn(headerText).filter((v) => !mine.has(v));
  const nameLine = header.find((l) => COMPANY_RE.test(l)) || '';
  const nameCells = csvCells(nameLine);
  // Senza intestazione col fornitore (Cursor, Stripe) il nome più
  // probabile è la prima parola ricorrente delle descrizioni.
  const firstWords = rows.map((r) => (r.description.match(/^[A-Z][A-Za-z]{2,}/) || [])[0]).filter(Boolean);
  const common = firstWords.sort((a, b) => firstWords.filter((w) => w === b).length - firstWords.filter((w) => w === a).length)[0] || '';
  return {
    headerText: [headerText, ...rows.map((r) => `${r.description} ${r.file}`)].join('\n'),
    vatIds, reportTotal,
    nameGuess: nameCells[0] || common,
    aliasGuess: common,
    addressGuess: nameCells[0] ? nameCells.slice(1, 3).join(', ') : '',
    rows: rows.map((r, i) => ({
      number: r.number,
      date: iso(parts[i], r.dateCell),
      amount: parseAmount(r.amountCell),
      negative: /^-/.test(r.amountCell.trim()),
      currency: r.currency,
      status: r.status,
      file: r.file,
    })),
  };
}

function intakeReport(file, text) {
  const rep = readReport(text, state.settings.me);
  if (!rep.rows.length) {
    refSeq += 1;
    batch.push({ ref: `r${refSeq}`, file: file.name, raw: text.slice(0, 4000), partyId: '', number: '', date: '', amount: null, vat: 0, vatIds: [], notes: ['nessuna riga con data, numero e importo: non sembra un report di addebiti'], confirmedWarns: [] });
    return;
  }
  const partyId = matchParty(rep.headerText, rep.vatIds) || draftFor(rep);
  const sum = core.round2(rep.rows.reduce((s, r) => s + (r.negative ? -1 : 1) * (Number(r.amount) || 0), 0));
  const totalBlock = rep.reportTotal !== null && Math.abs(sum - rep.reportTotal) > 0.01
    ? [`le righe del report fanno ${core.fixed2(sum)}, il totale dichiarato è ${core.fixed2(rep.reportTotal)}: il file è incompleto?`]
    : [];
  rep.rows.forEach((r, i) => {
    refSeq += 1;
    const blockers = [...totalBlock];
    if (r.negative) blockers.push('importo negativo (un rimborso?): registralo a parte');
    if (r.status && !PAID.test(r.status)) blockers.push(`stato "${r.status}": non è un addebito pagato`);
    // Un report dà l'importo addebitato, IVA compresa se c'è: il totale
    // resta fermo e l'IVA, se la scrivi, si toglie dall'imponibile.
    batch.push({
      ref: `r${refSeq}`, file: `${file.name} · ${r.file || `riga ${i + 1}`}`, source: file.name, pdfName: r.file || '', raw: '', partyId,
      number: r.number, date: r.date, periodFrom: null, periodTo: null, vatIds: rep.vatIds, notes: [],
      ...amounts(r.amount, 0, r.currency, true), blockers, confirmedWarns: [], showRaw: false, serverMsgs: null,
    });
  });
}

/* Gli importi di una riga appena letta, nella valuta del documento:
   net (imponibile), tax (IVA), e fixedTotal se quello che si è letto è
   il totale pagato. Gli euro li calcola syncEur, al cambio BCE per le
   valute (convertBatch). */
function amounts(amount, vat, currency, gross = false) {
  const cur = String(currency || 'EUR').toUpperCase();
  return {
    currency: 'EUR', originalCurrency: cur === 'EUR' ? null : cur, fxRate: null,
    net: gross ? null : amount, tax: Number(vat) || 0, fixedTotal: gross ? amount : null,
  };
}

function syncEur(row) {
  if (row.fixedTotal !== null && row.fixedTotal !== undefined) {
    row.net = row.fixedTotal > 0 ? core.round2(row.fixedTotal - (Number(row.tax) || 0)) : null;
  }
  const net = Number(row.net);
  const tax = Number(row.tax) || 0;
  if (row.originalCurrency) {
    row.originalAmount = net > 0 ? net : null;
    row.originalVat = tax;
    row.amount = row.fxRate > 0 && net > 0 ? core.round2(net / row.fxRate) : null;
    row.vat = row.fxRate > 0 ? core.round2(tax / row.fxRate) : 0;
  } else {
    row.amount = net > 0 ? core.round2(net) : null;
    row.vat = core.round2(tax);
  }
}

/* Cambio BCE del giorno di ogni fattura in valuta. Lo stesso calcolo lo
   rifà il server alla registrazione: qui serve a vedere subito gli euro. */
async function convertBatch() {
  const need = batch.filter((r) => r.originalCurrency && !(r.fxRate > 0) && core.isIsoDate(r.date));
  const byCur = new Map();
  for (const r of need) {
    if (!byCur.has(r.originalCurrency)) byCur.set(r.originalCurrency, []);
    byCur.get(r.originalCurrency).push(r);
  }
  for (const [cur, rows] of byCur) {
    try {
      const { rates } = await api(`/fx?currency=${cur}&dates=${[...new Set(rows.map((r) => r.date))].join(',')}`);
      for (const r of rows) setFx(r, rates[r.date]);
    } catch (error) {
      for (const r of rows) r.fxError = error.message;
    }
  }
}

function setFx(row, fx) {
  if (!fx) return;
  row.fxRate = fx.rate;
  row.fxRateDate = fx.rateDate;
  row.fxProvisional = fx.provisional;
  row.fxError = null;
  syncEur(row);
}

async function intake(files) {
  const all = [...files];
  for (const file of all.filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv')) {
    try { intakeReport(file, await file.text()); } catch (error) {
      refSeq += 1;
      batch.push({ ref: `r${refSeq}`, file: file.name, raw: '', partyId: '', number: '', date: '', amount: null, vat: 0, vatIds: [], notes: [`non leggibile: ${error.message}`], confirmedWarns: [] });
    }
  }
  const list = all.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  const drop = $('drop');
  drop.classList.add('busy');
  let k = 0;
  for (const file of list) {
    k += 1;
    drop.querySelector('p').innerHTML = `<strong>Leggo ${k} di ${list.length}</strong><br><span class="dim">${esc(file.name)}</span>`;
    try {
      const lines = await pdfText(file);
      const got = extract(lines, state.settings.me);
      if (!lines.length) got.notes.push('il PDF non ha testo leggibile (è una scansione?): compila a mano');
      // L'ID del pagamento nel nome del file (Stripe: in_…) è il numero
      // con cui la stessa fattura compare nei report.
      const payId = (file.name.match(/\b(in_[A-Za-z0-9]{8,})/) || [])[1];
      const csvRow = batch.find((r) => r.pdfName && r.pdfName === file.name && !r.pdfRead);
      if (csvRow) { mergePdf(csvRow, file, lines, got); continue; }
      const partyId = matchParty(lines.join('\n'), got.vatIds) || draftFor(got);
      refSeq += 1;
      batch.push({
        ref: `r${refSeq}`, file: file.name, raw: lines.join('\n'), partyId,
        number: got.number || payId || '', altNumbers: payId && got.number ? [payId] : [], date: got.date || '', ...amounts(got.amount, got.vat, got.currency),
        periodFrom: got.periodFrom, periodTo: got.periodTo,
        vatIds: got.vatIds, notes: got.notes, confirmedWarns: [], showRaw: false, serverMsgs: null,
      });
    } catch (error) {
      refSeq += 1;
      batch.push({ ref: `r${refSeq}`, file: file.name, raw: '', partyId: '', number: '', date: '', amount: null, vat: 0, vatIds: [], notes: [`non leggibile: ${error.message}`], confirmedWarns: [] });
    }
  }
  if (batch.some((r) => r.originalCurrency && !(r.fxRate > 0))) {
    drop.querySelector('p').innerHTML = '<strong>Prendo i cambi BCE…</strong>';
    await convertBatch();
  }
  drop.classList.remove('busy');
  drop.querySelector('p').innerHTML = '<strong>Trascina qui altre fatture</strong>, si aggiungono a quelle sotto.';
  renderBatch();
}

/* Il PDF di una riga del report: il report dà data e totale pagato, il
   PDF il numero vero e l'IVA, e con l'IVA il binario si sa. */
function mergePdf(row, file, lines, got) {
  row.pdfRead = true;
  row.raw = lines.join('\n');
  row.file = `${row.source} + ${file.name}`;
  if (got.number && core.numberKey(got.number) !== core.numberKey(row.number)) {
    row.altNumbers = [row.number];
    row.number = got.number;
  }
  row.tax = Number(got.vat) || 0;
  row.treatmentManual = false;
  const pdfTotal = core.round2((Number(got.amount) || 0) + row.tax);
  if (got.amount && Math.abs(pdfTotal - Number(row.fixedTotal)) > 0.02) {
    row.notes.push(`nel PDF il totale è ${core.fixed2(pdfTotal)}, nel report ${core.fixed2(row.fixedTotal)}: controlla quale è giusto`);
  }
  if (got.date && got.date !== row.date) row.notes.push(`nel PDF la data è ${core.itDate(got.date)}, nel report ${core.itDate(row.date)}`);
  for (const n of got.notes) if (/partita IVA/.test(n)) row.notes.push(n);
  if (got.periodFrom) { row.periodFrom = got.periodFrom; row.periodTo = got.periodTo; }
}

function wireDrop() {
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => intake(e.dataTransfer.files));
  $('fileInput').addEventListener('change', (e) => { intake(e.target.files); e.target.value = ''; });
}

/* ------------------------------------------------------------------ */
/* Il lotto: gruppi per soggetto, controlli, registrazione             */
/* ------------------------------------------------------------------ */

function reviewBatch() {
  const map = partiesMap();
  for (const row of batch) {
    syncEur(row);
    // Finché non lo scegli tu, il binario segue il soggetto e l'IVA.
    if (!row.treatmentManual) row.treatment = core.defaultTreatment(map[row.partyId], { vat: row.tax, fromReport: Boolean(row.source) && !row.pdfRead });
  }
  const results = core.review(batch, state.docs, map, state.settings.me);
  return batch.map((row, i) => {
    const r = results[i];
    const needConfirm = r.warns.length > 0;
    const confirmed = r.warns.every((w) => (row.confirmedWarns || []).includes(w));
    const level = r.blocks.length ? 'bad' : (needConfirm && !confirmed ? 'warn' : 'ok');
    return { row, ...r, level };
  });
}

function partyOptions(selected) {
  const known = state.parties.slice().sort((a, b) => a.name.localeCompare(b.name));
  const opts = known.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} · ${p.role === 'customer' ? 'cliente' : 'fornitore'}</option>`);
  for (const d of Object.values(drafts)) opts.push(`<option value="${esc(d.tempId)}" ${d.tempId === selected ? 'selected' : ''}>Nuovo: ${esc(d.name || 'senza nome')}</option>`);
  return `<option value="" ${selected ? '' : 'selected'}>— scegli il soggetto —</option>${opts.join('')}<option value="__new">+ nuovo soggetto…</option>`;
}

const VAT_MODES = {
  reverse: 'estero senza IVA (TD17)',
  domestic: 'italiano con IVA (via SdI)',
  none: 'senza IVA (commissioni, bolli)',
};
function vatModeOptions(selected) {
  return Object.entries(VAT_MODES).map(([k, l]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(l)}</option>`).join('');
}
function categoryOptions(selected, income) {
  return Object.entries(core.CATEGORIES).filter(([, c]) => Boolean(c.income) === Boolean(income))
    .map(([k, c]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(c.label)}${c.pct < 100 ? ` (${c.pct}%)` : ''}</option>`).join('');
}
function treatmentOptions(selected, customer, allowEmpty = true) {
  const keys = customer ? ['income'] : ['reverse', 'foreignVat', 'domestic', 'noVat'];
  return `${allowEmpty && !selected ? '<option value="" selected>— scegli il binario —</option>' : ''}${keys
    .map((k) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(core.TREATMENTS[k].label)}</option>`).join('')}`;
}
/* Cosa succede a questo documento, in una riga: meglio dirlo che farlo
   indovinare. */
function treatmentEffect(row, party) {
  const total = core.round2((Number(row.amount) || 0) + (Number(row.vat) || 0));
  switch (row.treatment) {
    case 'reverse': return `TD17 con IVA ${state.settings.vatRate}% su ${money(row.amount)}`;
    case 'foreignVat': return `costo ${money(total)}: l'IVA non si recupera`;
    case 'domestic': return `costo ${money(row.amount)} · IVA ${money(row.vat)} detraibile`;
    case 'noVat': return `costo ${money(total)}`;
    case 'income': return `ricavo ${money(row.amount)}`;
    default: return party && party.role !== 'customer' ? 'c\'è IVA nella fattura? scegli' : '';
  }
}

function draftForm(d) {
  const f = (name, label, extra = '') => `<div class="field ${extra}"><label>${label}</label><input type="text" data-draft="${esc(d.tempId)}" name="${name}" value="${esc(d[name])}"></div>`;
  const problems = core.partyProblems(d);
  return `<div class="newparty">
    <p class="hint">Soggetto nuovo: i campi sono presi dal documento. Controllali, verrà salvato in anagrafica quando registri${problems.length ? ` · <span class="bad">${esc(problems.join(', '))}</span>` : ''}.</p>
    <div class="form">
      ${f('name', 'Ragione sociale', 'wide')}
      <div class="field"><label>È un</label><select data-draft="${esc(d.tempId)}" name="role"><option value="supplier" ${d.role === 'supplier' ? 'selected' : ''}>fornitore · uscita</option><option value="customer" ${d.role === 'customer' ? 'selected' : ''}>cliente · entrata</option></select></div>
      <div class="field"><label>Di solito fattura</label><select data-draft="${esc(d.tempId)}" name="vatMode">${vatModeOptions(d.vatMode)}</select></div>
      <div class="field"><label>Categoria di costo</label><select data-draft="${esc(d.tempId)}" name="category">${categoryOptions(d.category, d.role === 'customer')}</select></div>
      ${f('country', 'Paese')}${f('vatCode', 'Partita IVA (senza prefisso)')}
      ${f('address', 'Indirizzo', 'wide')}${f('city', 'Città')}${f('cap', 'CAP')}
      ${f('aliases', 'Riconoscilo anche da (nomi separati da virgola, es. il marchio)', 'wide')}
    </div></div>`;
}

/* Imponibile, IVA e totale nella valuta del documento. Se si è letto il
   totale pagato (report CSV) si corregge quello e l'imponibile segue;
   altrimenti il contrario. In valuta, sotto, gli euro al cambio BCE. */
function amountCells(row, invalid) {
  const cur = row.originalCurrency || 'EUR';
  const fixed = row.fixedTotal !== null && row.fixedTotal !== undefined;
  const input = (f, value, cls = '', title = '') => `<input type="number" step="0.01" min="0" class="${cls}" data-f="${f}" value="${Number.isFinite(Number(value)) && value !== null && value !== '' ? core.fixed2(value) : ''}" title="${esc(title)}">`;
  const shown = (v) => `<div class="calc">${Number.isFinite(Number(v)) && v !== null ? core.fixed2(v) : '—'}</div>`;
  const total = Number(row.net) > 0 ? core.round2(Number(row.net) + (Number(row.tax) || 0)) : null;
  let fx = '';
  if (row.originalCurrency) {
    fx = row.fxRate > 0
      ? `<div class="fx">${esc(cur)} → <b>${money(core.round2((row.amount || 0) + (row.vat || 0)))}</b><br>BCE ${row.fxRate} del ${core.itDate(row.fxRateDate)}${row.fxProvisional ? '<br><span class="warn">provvisorio: il cambio di oggi esce verso le 16</span>' : ''}</div>`
      : `<div class="fx">${esc(cur)} · ${row.fxError ? `<span class="bad">${esc(row.fxError)}</span>` : 'cambio in arrivo…'}</div>`;
  }
  return `<td>${fixed ? shown(row.net) : input('net', row.net, invalid, `Imponibile in ${cur}`)}</td>
    <td>${input('tax', row.tax || 0, '', `IVA in ${cur} scritta sulla fattura: zero se non c'è`)}</td>
    <td>${fixed ? input('fixedTotal', row.fixedTotal, invalid, `Totale pagato in ${cur}, come nel report`) : shown(total)}${fx}</td>`;
}

const DROP_TEXT = $('drop').querySelector('p').innerHTML;

function renderBatch() {
  const box = $('batch');
  if (!state.settings) return;
  box.hidden = batch.length === 0;
  if (!batch.length) {
    $('groups').innerHTML = '';
    $('drop').querySelector('p').innerHTML = DROP_TEXT;
    return;
  }

  const reviewed = reviewBatch();
  const map = partiesMap();
  const groups = new Map();
  for (const r of reviewed) {
    const k = r.row.partyId || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  let td17Total = 0;
  const html = [...groups.entries()].map(([pid, items]) => {
    const party = map[pid];
    const draft = drafts[pid];
    const distinct = new Set(items.map((i) => core.numberKey(i.row.number)).filter(Boolean)).size;
    const total = core.round2(items.reduce((s, i) => s + (Number(i.row.amount) || 0) + (Number(i.row.vat) || 0), 0));
    const td17 = party
      ? core.td17Groups(items.filter((i) => !i.blocks.length && core.isIsoDate(i.row.date)).map((i) => ({ ...i.row, id: i.row.ref })), map, state.settings.td17Mode)
      : [];
    td17Total += td17.length;
    const kind = !party ? '' : party.role === 'customer' ? '<span class="pill in">entrata</span>' : '<span class="pill out">uscita</span>';
    const anyReverse = items.some((i) => i.row.treatment === 'reverse');
    const td17Label = !party ? '' : anyReverse
      ? `TD17: <b>${td17.length}</b> XML${td17.length ? ` (${td17.map((g) => MONTHS_LONG[Number(g.month.slice(5)) - 1]).join(', ')})` : ''}`
      : 'nessuna TD17';
    const treatments = new Set(items.map((i) => i.row.treatment));
    const groupTreatment = treatments.size === 1 ? [...treatments][0] : '';
    const bulk = party ? `<label class="bulk">Binario di tutte <select data-group-treatment="${esc(pid)}">${treatments.size > 1 ? '<option value="" selected>— misto —</option>' : ''}${treatmentOptions(groupTreatment, party.role === 'customer')}</select></label>` : '';
    const rowsHtml = items.map(({ row, blocks, warns, level }) => {
      const pill = level === 'ok' ? '<span class="pill ok">pronta</span>' : level === 'warn' ? '<span class="pill warn">da confermare</span>' : '<span class="pill bad">bloccata</span>';
      const server = row.serverMsgs ? row.serverMsgs.map((m) => `<div class="b">server: ${esc(m)}</div>`).join('') : '';
      const msgs = [...blocks.map((m) => `<div class="b">${esc(m)}</div>`), ...warns.map((m) => `<div class="w">${esc(m)}</div>`)].join('')
        + (warns.length && !blocks.length ? `<label><input type="checkbox" data-confirm="${row.ref}" ${level === 'ok' ? 'checked' : ''}> ho controllato, è giusta</label>` : '');
      const bad = (word) => blocks.some((b) => b.includes(word)) ? 'invalid' : '';
      return `<tr data-ref="${row.ref}">
        <td class="file" title="${esc(row.file)}">${esc(row.file)}</td>
        <td><input type="text" class="num ${bad('numero')}" data-f="number" value="${esc(row.number)}" placeholder="numero"></td>
        <td><input type="date" class="${bad('data')}" data-f="date" value="${esc(row.date)}">${row.periodFrom ? `<div class="fx">periodo ${core.itDate(row.periodFrom)}<br>– ${core.itDate(row.periodTo)}</div>` : ''}</td>
        <td class="treat"><select data-f="treatment" class="${bad('binario')} t-${esc(row.treatment || 'none')}" ${party ? '' : 'disabled'}>${treatmentOptions(row.treatment, party && party.role === 'customer')}</select><div class="fx">${esc(treatmentEffect(row, party))}</div></td>
        ${amountCells(row, bad('importo'))}
        <td class="state">${pill}<div class="msgs">${server}${msgs}</div></td>
        <td class="acts"><button class="btn small ghost" data-act="raw" type="button" title="Il testo letto dal PDF">testo</button><button class="btn small ghost" data-act="del" type="button" title="Togli dal lotto">×</button></td>
      </tr>${row.showRaw ? `<tr><td colspan="9" class="left"><pre class="dim" style="white-space:pre-wrap;font-size:11px;margin:0">${esc(row.raw || '(nessun testo)')}</pre></td></tr>` : ''}`;
    }).join('');
    const curs = new Set(items.map((i) => i.row.originalCurrency || '€'));
    const unit = curs.size === 1 ? [...curs][0] : '(valuta della fattura)';

    return `<div class="lg-group" data-group="${esc(pid)}">
      <div class="head">
        <div class="who">${party && !draft ? `<strong>${esc(party.name)}</strong>` : draft ? `<strong>Nuovo: ${esc(draft.name || 'senza nome')}</strong>` : '<strong>Non riconosciuti</strong>'} ${kind}
          <select data-group-party="${esc(pid)}" aria-label="Cambia soggetto">${partyOptions(pid)}</select>${bulk}</div>
        <div class="facts"><span><b>${distinct}</b> ${distinct === 1 ? 'fattura distinta' : 'fatture distinte'}</span><span>totale <b>${money(total)}</b></span><span>${td17Label}</span></div>
      </div>
      ${draft ? draftForm(draft) : ''}
      <div class="scroll"><table class="tbl lg-rows"><thead><tr><th>File</th><th>Numero</th><th>Data</th><th class="left">Binario</th><th>Imponibile ${esc(unit)}</th><th>IVA ${esc(unit)}</th><th>Totale ${esc(unit)}</th><th class="left">Controlli</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
    </div>`;
  }).join('');
  $('groups').innerHTML = html;

  const blocked = reviewed.filter((r) => r.level === 'bad').length;
  const toConfirm = reviewed.filter((r) => r.level === 'warn').length;
  const usedDrafts = new Set(batch.map((r) => r.partyId).filter((id) => drafts[id]));
  const draftIssues = [...usedDrafts].flatMap((id) => core.partyProblems(drafts[id]).map((p) => `${drafts[id].name || 'nuovo soggetto'}: ${p}`));
  const known = [...groups.keys()].filter((k) => k && !drafts[k]).length;
  $('batchSummary').innerHTML = `<strong>${batch.length} documenti</strong>
    <span class="pill">${known + usedDrafts.size === 1 ? '1 soggetto' : `${known + usedDrafts.size} soggetti`}${usedDrafts.size ? `, ${usedDrafts.size === 1 ? '1 nuovo' : `${usedDrafts.size} nuovi`}` : ''}</span>
    ${blocked ? `<span class="pill bad">${blocked === 1 ? '1 bloccato' : `${blocked} bloccati`}</span>` : ''}
    ${toConfirm ? `<span class="pill warn">${toConfirm} da confermare</span>` : ''}
    ${!blocked && !toConfirm ? '<span class="pill ok">tutto pronto</span>' : ''}
    <span class="sep"></span>
    ${Object.keys(core.TREATMENTS).map((t) => {
      const n = batch.filter((r) => r.treatment === t).length;
      return n ? `<span class="tcount">${treatPill(t)} ${n}</span>` : '';
    }).join('')}
    ${batch.some((r) => !core.TREATMENTS[r.treatment]) ? `<span class="tcount">${treatPill('')} ${batch.filter((r) => !core.TREATMENTS[r.treatment]).length}</span>` : ''}`;

  const meMissing = Object.values(core.meProblems(state.settings.me));
  const canSave = !blocked && !toConfirm && !draftIssues.length;
  $('saveOnly').disabled = !canSave;
  $('saveXml').disabled = !canSave || td17Total === 0 || meMissing.length > 0;
  $('saveXml').textContent = td17Total ? `Registra e scarica ${td17Total} XML` : 'Registra e scarica XML';
  const noTd17 = batch.filter((r) => core.TREATMENTS[r.treatment] && r.treatment !== 'reverse').length;
  $('batchNote').textContent = `${td17Total
    ? `${td17Total === 1 ? '1 autofattura' : `${td17Total} autofatture`}, una per ${state.settings.td17Mode === 'invoice' ? 'fattura' : 'fornitore e mese'}. Fornitori diversi non finiscono mai nello stesso XML.`
    : 'Nessun documento di questo lotto richiede TD17.'}${noTd17 ? ` ${noTd17 === 1 ? '1 documento va' : `${noTd17} documenti vanno`} solo nel registro, senza TD17.` : ''}`;
  const problems = [];
  if (draftIssues.length) problems.push(`Soggetti da completare: ${draftIssues.join('; ')}.`);
  if (td17Total && meMissing.length) problems.push(`Per gli XML mancano i tuoi dati: ${meMissing.join(', ')}. Puoi comunque registrare.`);
  $('batchProblems').textContent = problems.join('\n');
}

function wireBatch() {
  const groups = $('groups');
  const rowOf = (el) => batch.find((r) => r.ref === el.closest('tr[data-ref]')?.dataset.ref);
  const store = (input) => {
    const row = rowOf(input);
    if (!row) return;
    const f = input.dataset.f;
    row[f] = ['net', 'tax', 'fixedTotal'].includes(f) ? (input.value === '' ? null : Number(input.value)) : input.value.trim();
    if (f === 'treatment') row.treatmentManual = Boolean(row.treatment);
    if (row.originalCurrency && f === 'date') row.fxRate = null;
    syncEur(row);
    row.confirmedWarns = [];
    row.serverMsgs = null;
  };
  groups.addEventListener('input', (e) => {
    if (e.target.dataset.f) store(e.target);
    if (e.target.dataset.draft) drafts[e.target.dataset.draft][e.target.name] = e.target.value.trim();
  });
  groups.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f) {
      store(t);
      renderBatch();
      if (t.dataset.f === 'date' && batch.some((r) => r.originalCurrency && !(r.fxRate > 0))) convertBatch().then(renderBatch);
      return;
    }
    if (t.dataset.draft) {
      const d = drafts[t.dataset.draft];
      d[t.name] = t.value.trim();
      if (t.name === 'role') d.category = core.guessCategory({ ...d, aliases: [] });
      renderBatch();
      return;
    }
    if (t.dataset.groupTreatment !== undefined) {
      if (!t.value) return;
      for (const row of batch) if ((row.partyId || '') === t.dataset.groupTreatment) { row.treatment = t.value; row.treatmentManual = true; row.confirmedWarns = []; row.serverMsgs = null; }
      renderBatch();
      return;
    }
    if (t.dataset.confirm) { const row = batch.find((r) => r.ref === t.dataset.confirm); row.confirmedWarns = t.checked ? (reviewBatch().find((x) => x.row === row)?.warns || []) : []; renderBatch(); return; }
    if (t.dataset.groupParty !== undefined) {
      let target = t.value;
      if (target === '__new') {
        draftSeq += 1;
        target = `new:${draftSeq}`;
        drafts[target] = { tempId: target, key: target, name: '', role: 'supplier', vatMode: 'reverse', country: '', vatCode: '', address: '', city: '', cap: '00000', description: 'Servizi', aliases: '', category: 'altro' };
      }
      // Cambiando soggetto il binario scelto per il vecchio non vale più.
      for (const row of batch) if ((row.partyId || '') === t.dataset.groupParty) { row.partyId = target; row.confirmedWarns = []; row.treatmentManual = false; }
      renderBatch();
    }
  });
  groups.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const row = rowOf(b);
    if (b.dataset.act === 'del') batch = batch.filter((r) => r !== row);
    if (b.dataset.act === 'raw') row.showRaw = !row.showRaw;
    renderBatch();
  });
  $('batchClear').addEventListener('click', () => { batch = []; drafts = {}; renderBatch(); });
  $('saveOnly').addEventListener('click', () => commit(false));
  $('saveXml').addEventListener('click', () => commit(true));
}

async function commit(generate) {
  const buttons = [$('saveOnly'), $('saveXml')];
  buttons.forEach((b) => { b.disabled = true; });
  const used = new Set(batch.map((r) => r.partyId));
  const reviewed = reviewBatch();
  try {
    const out = await api('/commit', {
      method: 'POST',
      body: {
        generate,
        docs: reviewed.map(({ row, warns }) => ({
          ...row,
          fileName: row.file,
          // Un addebito in un report di carta è pagato quel giorno.
          paidDate: row.source ? row.date : null,
          confirmedWarnings: warns.filter((w) => (row.confirmedWarns || []).includes(w)),
        })),
        newParties: Object.values(drafts).filter((d) => used.has(d.tempId)),
      },
    });
    if (out.selfInvoices.length) await downloadXml(out.selfInvoices.map((s) => ({ name: s.fileName, xml: s.xml })));
    const numbers = out.selfInvoices.map((s) => s.number).join(', ');
    batch = [];
    drafts = {};
    await reload();
    $('batchProblems').textContent = '';
    flash(`${out.docs.length === 1 ? 'Registrato 1 documento' : `Registrati ${out.docs.length} documenti`}${out.parties.length ? `, ${out.parties.length === 1 ? '1 soggetto nuovo' : `${out.parties.length} soggetti nuovi`} in anagrafica` : ''}${numbers ? `. Scaricate le TD17 ${numbers}` : ''}.`);
  } catch (error) {
    // L'archivio può essere cambiato da un'altra scheda: rileggerlo fa
    // comparire qui, con la loro casella, gli stessi avvisi del server.
    await reload().catch(() => {});
    for (const d of error.details || []) {
      const row = batch.find((r) => r.ref === d.ref);
      if (row && d.level === 'block') row.serverMsgs = d.messages;
    }
    renderBatch();
    $('batchProblems').textContent = error.message;
  }
}

function flash(message) {
  const p = document.createElement('div');
  p.className = 'lg-alert';
  p.style.background = 'var(--green-soft)';
  p.textContent = message;
  $('setupAlert').after(p);
  setTimeout(() => p.remove(), 9000);
}

/* ------------------------------------------------------------------ */
/* Scaricare gli XML: uno da solo, più d'uno in uno ZIP                */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zip(files) {
  const enc = new TextEncoder();
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const body = enc.encode(f.xml);
    const crc = crc32(body);
    const local = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, body.length, 4], [22, body.length, 4], [26, name.length, 2], [28, 0, 2]]
      .forEach(([o, v, s]) => (s === 4 ? local.setUint32(o, v, true) : local.setUint16(o, v, true)));
    parts.push(new Uint8Array(local.buffer), name, body);
    const cd = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, body.length, 4], [24, body.length, 4], [28, name.length, 2], [42, offset, 4]]
      .forEach(([o, v, s]) => (s === 4 ? cd.setUint32(o, v, true) : cd.setUint16(o, v, true)));
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function downloadXml(files) {
  if (files.length === 1) save(new Blob([files[0].xml], { type: 'application/xml' }), files[0].name);
  else save(zip(files), `TD17-${new Date().toISOString().slice(0, 10)}-${files.length}.zip`);
}

/* ------------------------------------------------------------------ */
/* Documenti                                                           */
/* ------------------------------------------------------------------ */

const selected = new Set();

function filteredDocs() {
  const year = $('docYear').value;
  const dir = $('docDir').value;
  const party = $('docParty').value;
  const treat = $('docTreat').value;
  const month = $('docMonth').value;
  const keep = (d) => {
    if (!treat) return true;
    if (treat === 'todo') return core.docNeedsTd17(d, partyById[d.partyId]) && !d.selfInvoiceId;
    return treatOf(d) === treat;
  };
  return state.docs
    .filter((d) => d.date.startsWith(year) && (!month || d.month === `${year}-${month}`) && (!dir || d.direction === dir) && (!party || d.partyId === party) && keep(d))
    .sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number));
}

/* Il registro completo: una riga per documento, tutto quello che serve
   al commercialista per redditi e IVA. */
function registryCsv(list, name) {
  const head = ['Data', 'Data pagamento', 'Soggetto', 'Partita IVA', 'Paese', 'Numero', 'Tipo', 'Binario', 'Categoria',
    'Valuta', 'Imponibile in valuta', 'IVA in valuta', 'Cambio BCE', 'Data cambio',
    'Imponibile €', 'IVA €', 'Totale €', 'IVA detraibile €', 'Costo o ricavo €', '% deducibile', 'Deducibile €', 'TD17', 'Prima della P.IVA', 'File'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const n = (v) => (v === null || v === undefined || v === '' ? '' : core.fixed2(v).replace('.', ','));
  const me = state.settings.me;
  const lines = list.slice().sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
    const p = partyById[d.partyId] || {};
    const income = d.direction === 'in';
    return [
      core.itDate(d.date), core.itDate(d.paidDate || ''), p.name || d.partyId, p.vatCode ? core.vatKey(p.country, p.vatCode) : '', p.country || '',
      d.number, income ? 'entrata' : 'uscita', core.TREATMENTS[treatOf(d)].label, core.CATEGORIES[core.categoryOf(d, p)].label,
      d.originalCurrency || 'EUR', d.originalCurrency ? n(d.originalAmount) : '', d.originalCurrency ? n(d.originalVat || 0) : '',
      d.fxRate ? String(d.fxRate).replace('.', ',') : '', core.itDate(d.fxRateDate || ''),
      n(d.amount), n(d.vat || 0), n(totalOf(d)), n(core.vatDeductibleOf(d, p)), n(income ? d.amount : core.costOf(d, p)),
      income ? '' : core.deductPctOf(d, p), income ? '' : n(core.deductibleOf(d, p, me)),
      d.selfInvoiceNumber || (core.docNeedsTd17(d, p) ? 'da fare' : ''), core.beforePiva(d, me) ? 'sì' : '', d.fileName || '',
    ].map(cell).join(';');
  });
  save(new Blob([`\uFEFF${head.join(';')}\n${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' }), name);
}

function renderDocs() {
  if (!state.settings) return;
  fillYearSelect($('docYear'));
  const partySel = $('docParty');
  const cur = partySel.value;
  partySel.innerHTML = `<option value="">tutti i soggetti</option>${state.parties.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
  partySel.value = cur;

  const list = filteredDocs();
  for (const id of [...selected]) if (!state.docs.some((d) => d.id === id && !d.selfInvoiceId)) selected.delete(id);
  const pickable = (d) => core.docNeedsTd17(d, partyById[d.partyId]) && !d.selfInvoiceId && !core.beforePiva(d, state.settings.me);
  const todo = list.filter(pickable);
  $('docPickAll').hidden = todo.length === 0;
  $('docPickAll').textContent = todo.length === 1 ? 'Seleziona la TD17 da fare' : `Seleziona le ${todo.length} TD17 da fare`;
  const sums = list.reduce((a, d) => ({ amount: a.amount + (Number(d.amount) || 0), vat: a.vat + (Number(d.vat) || 0) }), { amount: 0, vat: 0 });
  $('docsTable').innerHTML = list.length ? `<thead><tr><th></th><th class="left">Data</th><th class="left">Soggetto</th><th class="left">Binario</th><th class="left">Numero</th><th>Imponibile</th><th>IVA</th><th>Totale</th><th class="left">TD17</th><th></th></tr></thead>
    <tbody>${list.map((d) => {
      const p = partyById[d.partyId] || {};
      const needs = core.docNeedsTd17(d, p);
      const td = d.selfInvoiceNumber ? `<span class="pill ok">${esc(d.selfInvoiceNumber)}</span>` : needs ? '<span class="pill warn">da fare</span>' : '<span class="dim">no</span>';
      const fxTitle = d.originalCurrency ? ` title="${esc(`${core.fixed2(d.originalAmount)} + IVA ${core.fixed2(d.originalVat || 0)} ${d.originalCurrency}, cambio BCE ${d.fxRate} del ${core.itDate(d.fxRateDate)}${d.fxProvisional ? ' (provvisorio)' : ''}`)}"` : '';
      const approx = d.fxProvisional ? '<span class="fx-mark">≈ </span>' : '';
      return `<tr>
        <td>${pickable(d) ? `<input type="checkbox" data-pick="${esc(d.id)}" ${selected.has(d.id) ? 'checked' : ''}>` : ''}</td>
        <td class="left">${core.itDate(d.date)}</td><td class="left">${esc(p.name || d.partyId)}</td>
        <td class="left">${treatPill(treatOf(d))}${core.beforePiva(d, state.settings.me) ? ' <span class="pill" title="Prima dell\'apertura della partita IVA: non conta tra i costi deducibili">pre P.IVA</span>' : ''}</td>
        <td class="left num">${esc(d.number)}</td>
        <td${fxTitle}>${approx}${money(d.amount)}</td><td${fxTitle}>${approx}${money(d.vat || 0)}</td>
        <td${fxTitle}>${approx}${money(totalOf(d))}${d.originalCurrency ? ` <span class="dim">${esc(d.originalCurrency)}</span>` : ''}</td><td class="left">${td}</td>
        <td class="acts"><button class="btn small" data-edit-doc="${esc(d.id)}" type="button">Modifica</button>${d.selfInvoiceId ? '' : `<button class="btn small ghost" data-del-doc="${esc(d.id)}" type="button" title="Togli dall'archivio">×</button>`}</td>
      </tr>`;
    }).join('')}
    <tr class="total"><td></td><td class="left" colspan="4">${list.length === 1 ? '1 documento' : `${list.length} documenti`}</td><td>${money(sums.amount)}</td><td>${money(sums.vat)}</td><td>${money(sums.amount + sums.vat)}</td><td colspan="2"></td></tr></tbody>` : '<tbody><tr><td class="empty">Nessun documento con questi filtri.</td></tr></tbody>';
  $('docGenerate').disabled = selected.size === 0 || Object.keys(core.meProblems(state.settings.me)).length > 0;
  $('docGenerate').textContent = selected.size ? `Genera XML per ${selected.size}` : 'Genera XML';

  const seqMax = {};
  for (const s of state.selfInvoices) seqMax[s.year] = Math.max(seqMax[s.year] || 0, s.seq);
  const td = state.selfInvoices.slice().sort((a, b) => b.year.localeCompare(a.year) || b.seq - a.seq);
  $('td17Table').innerHTML = td.length ? `<thead><tr><th class="left">Numero</th><th class="left">Data</th><th class="left">Fornitore</th><th class="left">Fatture</th><th>Imponibile</th><th>IVA</th><th>Totale</th><th></th></tr></thead>
    <tbody>${td.map((s) => `<tr>
      <td class="left num">${esc(s.number)}</td><td class="left">${core.itDate(s.date)}</td><td class="left">${esc(s.partyName)}</td>
      <td class="left" title="${esc((s.docNumbers || []).join('\n'))}">${(s.docNumbers || []).length}</td>
      <td>${money(s.base)}</td><td>${money(s.vat)}</td><td>${money(s.total)}</td>
      <td class="acts"><a class="btn small" href="/api/ledger/selfinvoices/${esc(s.id)}/xml">XML</a>${s.seq === seqMax[s.year] ? `<button class="btn small ghost" data-del-td="${esc(s.id)}" type="button" title="Solo l'ultima dell'anno, e solo se non l'hai ancora caricata su Aruba">togli</button>` : ''}</td>
    </tr>`).join('')}</tbody>` : '<tbody><tr><td class="empty">Nessuna autofattura ancora.</td></tr></tbody>';
}

function wireDocs() {
  ['docYear', 'docMonth', 'docDir', 'docParty', 'docTreat'].forEach((id) => $(id).addEventListener('change', renderDocs));
  $('docPickAll').addEventListener('click', () => {
    for (const d of filteredDocs()) if (core.docNeedsTd17(d, partyById[d.partyId]) && !d.selfInvoiceId && !core.beforePiva(d, state.settings.me)) selected.add(d.id);
    renderDocs();
  });
  $('docsTable').addEventListener('change', (e) => {
    const id = e.target.dataset.pick;
    if (!id) return;
    if (e.target.checked) selected.add(id); else selected.delete(id);
    renderDocs();
  });
  $('docsTable').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit-doc]')?.dataset.editDoc;
    if (edit) { openDoc(state.docs.find((x) => x.id === edit)); return; }
    const id = e.target.closest('[data-del-doc]')?.dataset.delDoc;
    if (!id) return;
    const d = state.docs.find((x) => x.id === id);
    if (!window.confirm(`Togliere ${d.number} dall'archivio?`)) return;
    try { await api(`/docs/${encodeURIComponent(id)}`, { method: 'DELETE' }); await reload(); } catch (error) { window.alert(error.message); }
  });
  $('td17Table').addEventListener('click', async (e) => {
    const id = e.target.closest('[data-del-td]')?.dataset.delTd;
    if (!id) return;
    const s = state.selfInvoices.find((x) => x.id === id);
    if (!window.confirm(`Togliere la TD17 ${s.number}? Fallo solo se non l'hai ancora caricata su Aruba: il numero torna libero e le fatture tornano "da fare".`)) return;
    try { await api(`/selfinvoices/${encodeURIComponent(id)}`, { method: 'DELETE' }); await reload(); } catch (error) { window.alert(error.message); }
  });
  $('docGenerate').addEventListener('click', async () => {
    $('docGenerate').disabled = true;
    try {
      const out = await api('/generate', { method: 'POST', body: { docIds: [...selected] } });
      await downloadXml(out.selfInvoices.map((s) => ({ name: s.fileName, xml: s.xml })));
      selected.clear();
      await reload();
    } catch (error) { window.alert(error.message); renderDocs(); }
  });
  $('docCsv').addEventListener('click', () => registryCsv(filteredDocs(), `registro-${$('docYear').value}${$('docMonth').value ? `-${$('docMonth').value}` : ''}.csv`));
  wireDocModal();
}

/* Correggere un documento registrato: binario, IVA, categoria, quota
   deducibile, data di pagamento. Numero, data e importi restano quelli
   della fattura: se sono sbagliati si toglie e si ricarica. */
let editingDoc = null;

function openDoc(d) {
  editingDoc = d;
  const p = partyById[d.partyId] || {};
  const locked = Boolean(d.selfInvoiceId);
  const cur = d.originalCurrency || 'EUR';
  const tax = d.originalCurrency ? d.originalVat || 0 : d.vat || 0;
  const category = core.categoryOf(d, p);
  $('docModalTitle').textContent = `${p.name || d.partyId} · ${d.number}`;
  $('docForm').innerHTML = `
    <div class="field wide"><label>Binario${locked ? ` <span class="dim">(bloccato: è nella TD17 ${esc(d.selfInvoiceNumber)})</span>` : ''}</label>
      <select name="treatment" ${locked ? 'disabled' : ''}>${treatmentOptions(treatOf(d), p.role === 'customer', false)}</select></div>
    <div class="field"><label>Imponibile (${esc(cur)})</label><input type="number" name="net" step="0.01" min="0" value="${core.fixed2(d.originalCurrency ? d.originalAmount : d.amount)}" ${locked ? 'disabled' : ''}></div>
    <div class="field"><label>IVA in fattura (${esc(cur)})</label><input type="number" name="vat" step="0.01" min="0" value="${core.fixed2(tax)}" ${locked ? 'disabled' : ''}></div>
    <div class="field wide"><p class="note" id="docTotal"></p></div>
    <div class="field"><label>Categoria</label><select name="category">${categoryOptions(category, p.role === 'customer')}</select></div>
    <div class="field"><label>% deducibile</label><div class="in"><input type="number" name="deductPct" min="0" max="100" step="1" value="${core.deductPctOf(d, p)}"><span>%</span></div></div>
    <div class="field"><label>Data di pagamento <span class="dim">(vuota: la data della fattura)</span></label><input type="date" name="paidDate" value="${esc(d.paidDate || '')}"></div>`;
  $('docError').textContent = '';
  docTotalNote();
  $('docModal').hidden = false;
}

function docTotalNote() {
  const d = editingDoc;
  const f = $('docForm').elements;
  const net = Number(f.net.value) || 0;
  const tax = Number(f.vat.value) || 0;
  const cur = d.originalCurrency || 'EUR';
  const eurNet = d.originalCurrency ? core.round2(net / d.fxRate) : net;
  const eurTax = d.originalCurrency ? core.round2(tax / d.fxRate) : tax;
  const draft = { ...d, treatment: f.treatment.value, amount: eurNet, vat: eurTax };
  const effect = treatmentEffect(draft, partyById[d.partyId]);
  $('docTotal').textContent = `Totale ${core.fixed2(net + tax)} ${cur}${d.originalCurrency ? ` = ${money(eurNet + eurTax)} al cambio BCE ${d.fxRate} del ${core.itDate(d.fxRateDate)}` : ''}. ${effect.charAt(0).toUpperCase()}${effect.slice(1)}.`;
}

function wireDocModal() {
  $('docModal').addEventListener('click', (e) => { if (e.target === $('docModal') || e.target.closest('[data-close]')) $('docModal').hidden = true; });
  // Cambiando categoria la quota deducibile riparte da quella tipica.
  $('docForm').addEventListener('change', (e) => {
    if (e.target.name === 'category') $('docForm').elements.deductPct.value = core.CATEGORIES[e.target.value].pct;
  });
  $('docForm').addEventListener('input', (e) => { if (['net', 'vat', 'treatment'].includes(e.target.name)) docTotalNote(); });
  $('docSave').addEventListener('click', async () => {
    const f = $('docForm').elements;
    const body = { category: f.category.value, deductPct: Number(f.deductPct.value), paidDate: f.paidDate.value || null };
    if (!f.treatment.disabled) { body.treatment = f.treatment.value; body.net = Number(f.net.value); body.vat = Number(f.vat.value) || 0; }
    try {
      const out = await api(`/docs/${encodeURIComponent(editingDoc.id)}`, { method: 'PATCH', body });
      $('docModal').hidden = true;
      await reload();
      if (out.warns && out.warns.length) flash(`Salvato. Da tenere presente: ${out.warns.join('; ')}.`);
    } catch (error) { $('docError').textContent = error.message; }
  });
}

/* ------------------------------------------------------------------ */
/* Dichiarazione                                                       */
/* ------------------------------------------------------------------ */

/* Quello che serve a fine anno, ricavato dall'archivio: ricavi e costi
   deducibili per la dichiarazione dei redditi, IVA trimestre per
   trimestre, e l'elenco di quello che va sistemato prima. È una stima
   fatta con le regole scritte in core: il commercialista la conferma. */
function renderTax() {
  if (!state.settings) return;
  fillYearSelect($('taxYear'));
  const year = $('taxYear').value;
  const me = state.settings.me;
  const rate = Number(state.settings.vatRate) / 100;
  const docs = state.docs.filter((d) => d.date.startsWith(year));
  const inDocs = docs.filter((d) => d.direction === 'in');
  const outDocs = docs.filter((d) => d.direction === 'out');
  const party = (d) => partyById[d.partyId] || {};
  const sum = (list, fn) => core.round2(list.reduce((s, d) => s + fn(d), 0));

  const revenue = sum(inDocs, (d) => Number(d.amount) || 0);
  const counted = outDocs.filter((d) => !core.beforePiva(d, me));
  const cost = sum(counted, (d) => core.costOf(d, party(d)));
  const deductible = sum(counted, (d) => core.deductibleOf(d, party(d), me));
  const foreignVat = sum(counted.filter((d) => treatOf(d) === 'foreignVat'), (d) => Number(d.vat) || 0);
  const pre = outDocs.filter((d) => core.beforePiva(d, me));

  $('taxKpis').innerHTML = [
    stat('Ricavi', money(revenue), `${inDocs.length} documenti`, 'good'),
    stat('Costi deducibili', money(deductible), deductible !== cost ? `su ${money(cost)} di costi` : `${counted.length} documenti`),
    stat('Reddito stimato', money(core.round2(revenue - deductible)), 'ricavi meno costi deducibili', revenue - deductible < 0 ? 'bad' : ''),
    stat('IVA estera pagata', money(foreignVat), foreignVat ? 'non si recupera: è già dentro i costi' : 'nessuna', foreignVat ? 'warn' : ''),
  ].join('');

  const byCat = (list, income) => {
    const map = new Map();
    for (const d of list) {
      const c = core.categoryOf(d, party(d));
      const e = map.get(c) || { n: 0, cost: 0, ded: 0, pcts: new Set() };
      e.n += 1;
      e.cost += income ? Number(d.amount) || 0 : core.costOf(d, party(d));
      e.ded += income ? 0 : core.deductibleOf(d, party(d), me);
      e.pcts.add(core.deductPctOf(d, party(d)));
      map.set(c, e);
    }
    return [...map.entries()].sort((a, b) => b[1].cost - a[1].cost);
  };
  const costRows = byCat(counted, false);
  $('taxCosts').innerHTML = costRows.length ? `<thead><tr><th class="left">Categoria</th><th>Documenti</th><th>Costo</th><th>% deducibile</th><th>Deducibile</th></tr></thead>
    <tbody>${costRows.map(([c, e]) => `<tr><td class="left">${esc(core.CATEGORIES[c].label)}</td><td>${e.n}</td><td>${money(e.cost)}</td><td>${e.pcts.size === 1 ? `${[...e.pcts][0]}%` : 'varia'}</td><td>${money(e.ded)}</td></tr>`).join('')}
    <tr class="total"><td class="left">Totale ${year}</td><td>${counted.length}</td><td>${money(cost)}</td><td></td><td>${money(deductible)}</td></tr></tbody>`
    : '<tbody><tr><td class="empty">Nessun costo registrato in questo anno.</td></tr></tbody>';
  $('taxCostsHint').textContent = pre.length
    ? `${pre.length === 1 ? '1 documento' : `${pre.length} documenti`} di prima dell'apertura della partita IVA (${money(sum(pre, (d) => core.costOf(d, party(d))))}): ${pre.length === 1 ? 'resta' : 'restano'} in archivio ma non ${pre.length === 1 ? 'è' : 'sono'} qui`
    : 'costo = imponibile, più l\'IVA quando non si recupera';

  const revRows = byCat(inDocs, true);
  $('taxRevenue').innerHTML = revRows.length ? `<thead><tr><th class="left">Categoria</th><th>Documenti</th><th>Ricavi</th></tr></thead>
    <tbody>${revRows.map(([c, e]) => `<tr><td class="left">${esc(core.CATEGORIES[c].label)}</td><td>${e.n}</td><td>${money(e.cost)}</td></tr>`).join('')}
    <tr class="total"><td class="left">Totale ${year}</td><td>${inDocs.length}</td><td>${money(revenue)}</td></tr></tbody>`
    : '<tbody><tr><td class="empty">Nessuna entrata registrata in questo anno.</td></tr></tbody>';

  // IVA: la TD17 la mette a debito e a credito insieme (si annulla);
  // quella delle fatture italiane è a credito; quella estera già pagata
  // non entra, è costo.
  // Le TD17 emesse contano per quello che c'è scritto; quelle ancora da
  // fare, stimate sull'imponibile.
  const quarterOf = (iso) => Math.ceil(Number(iso.slice(5, 7)) / 3);
  const quarters = [1, 2, 3, 4].map((q) => {
    const list = docs.filter((d) => quarterOf(d.date) === q && !core.beforePiva(d, me));
    const reverse = list.filter((d) => d.direction === 'out' && treatOf(d) === 'reverse');
    const issued = state.selfInvoices.filter((s) => s.date.startsWith(year) && quarterOf(s.date) === q);
    const td17Vat = core.round2(issued.reduce((s, t) => s + (Number(t.vat) || 0), 0)
      + sum(reverse.filter((d) => !d.selfInvoiceId), (d) => core.round2((Number(d.amount) || 0) * rate)));
    const salesVat = sum(list.filter((d) => d.direction === 'in'), (d) => Number(d.vat) || 0);
    const domesticVat = sum(list.filter((d) => d.direction === 'out'), (d) => core.vatDeductibleOf(d, party(d)));
    const pending = reverse.filter((d) => !d.selfInvoiceId).length;
    return { q, debit: core.round2(td17Vat + salesVat), credit: core.round2(td17Vat + domesticVat), pending, n: list.length };
  });
  $('taxVat').innerHTML = `<thead><tr><th class="left">Trimestre</th><th>IVA a debito</th><th>IVA a credito</th><th>Saldo</th><th class="left">Note</th></tr></thead>
    <tbody>${quarters.map((r) => {
      const bal = core.round2(r.debit - r.credit);
      return `<tr class="${r.n ? '' : 'muted'}"><td class="left">${r.q}° trimestre</td><td>${money(r.debit)}</td><td>${money(r.credit)}</td>
        <td class="${bal > 0 ? 'neg' : ''}">${bal > 0 ? `${money(bal)} da versare` : bal < 0 ? `${money(-bal)} a credito` : money(0)}</td>
        <td class="left">${r.pending ? `<span class="pill warn">${r.pending === 1 ? '1 TD17 da fare' : `${r.pending} TD17 da fare`}</span>` : ''}</td></tr>`;
    }).join('')}</tbody>`;

  const checks = [];
  if (!core.isIsoDate(me.pivaStart)) checks.push('Manca la data di apertura della partita IVA (in Anagrafiche): senza, i costi di prima non si possono separare.');
  const todo = outDocs.filter((d) => core.docNeedsTd17(d, party(d)) && !d.selfInvoiceId && !core.beforePiva(d, me));
  if (todo.length) checks.push(`${todo.length === 1 ? '1 fattura estera aspetta' : `${todo.length} fatture estere aspettano`} la TD17.`);
  const zeroVat = outDocs.filter((d) => treatOf(d) === 'foreignVat' && !(Number(d.vat) > 0));
  if (zeroVat.length) checks.push(`${zeroVat.length === 1 ? '1 documento' : `${zeroVat.length} documenti`} con "IVA già pagata" ma IVA a zero: scrivi l'IVA della fattura (Modifica, in Documenti).`);
  const prov = docs.filter((d) => d.fxProvisional);
  if (prov.length) checks.push(`${prov.length === 1 ? '1 cambio BCE è' : `${prov.length} cambi BCE sono`} ancora provvisori.`);
  const vies = outDocs.filter((d) => treatOf(d) === 'foreignVat' && party(d).vatMode === 'reverse' && !core.beforePiva(d, me));
  if (vies.length) checks.push(`${vies.length === 1 ? '1 fattura' : `${vies.length} fatture`} con IVA da fornitori che di solito non la addebitano (${[...new Set(vies.map((d) => party(d).name))].join(', ')}): chiedi il rimborso dell'IVA.`);
  $('taxChecks').innerHTML = checks.length
    ? checks.map((c) => `<li>${esc(c)}</li>`).join('')
    : '<li class="ok">Niente da sistemare.</li>';
}

function wireTax() {
  $('taxYear').addEventListener('change', renderTax);
  $('taxCsv').addEventListener('click', () => {
    const year = $('taxYear').value;
    registryCsv(state.docs.filter((d) => d.date.startsWith(year)), `registro-${year}.csv`);
  });
}

/* ------------------------------------------------------------------ */
/* Anagrafiche                                                         */
/* ------------------------------------------------------------------ */

let saveTimer = null;

function renderSettings() {
  if (!state.settings) return;
  const s = state.settings;
  const me = $('meForm');
  for (const el of me.elements) if (el.name && document.activeElement !== el) el.value = s.me[el.name] || '';
  const problems = core.meProblems(s.me);
  for (const el of me.elements) {
    if (!el.name) continue;
    el.classList.toggle('invalid', Boolean(problems[el.name]) && Boolean(el.value || el.name !== 'pec'));
    el.title = problems[el.name] || '';
  }
  const missing = Object.keys(problems).length;
  $('meState').textContent = missing ? `${missing} ${missing === 1 ? 'campo da sistemare' : 'campi da sistemare'}` : 'completi';
  $('meState').className = `save-state ${Object.keys(problems).length ? 'bad' : 'ok'}`;

  const year = String(new Date().getFullYear());
  const num = $('numForm');
  const values = { prefix: s.numbering.prefix, suffix: s.numbering.suffix, digits: s.numbering.digits, vatRate: s.vatRate, next: s.numbering.next[year] || 1, td17Mode: s.td17Mode };
  for (const el of num.elements) if (el.name && document.activeElement !== el) el.value = values[el.name];
  $('nextYearLabel').textContent = `(${year})`;
  $('nextPreview').textContent = `La prossima sarà ${core.formatNumber(s.numbering, values.next)}`;
}

function wireSettings() {
  const saveMe = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const me = Object.fromEntries([...$('meForm').elements].filter((e) => e.name).map((e) => [e.name, e.value.trim()]));
      me.cf = me.cf.toUpperCase();
      me.provincia = me.provincia.toUpperCase();
      try {
        const out = await api('/settings', { method: 'PUT', body: { me } });
        state.settings = out.settings;
        renderSettings(); renderSetupAlert(); renderBatch(); renderDocs();
      } catch (error) { $('meState').textContent = error.message; $('meState').className = 'save-state bad'; }
    }, 500);
  };
  $('meForm').addEventListener('input', saveMe);

  $('numForm').addEventListener('change', async () => {
    const f = $('numForm').elements;
    const body = {
      vatRate: Number(f.vatRate.value),
      td17Mode: f.td17Mode.value,
      numbering: { prefix: f.prefix.value.trim(), suffix: f.suffix.value.trim(), digits: Number(f.digits.value), year: String(new Date().getFullYear()), next: Number(f.next.value) },
    };
    try {
      const out = await api('/settings', { method: 'PUT', body });
      state.settings = out.settings;
      $('numState').textContent = 'salvato';
      $('numState').className = 'save-state ok';
    } catch (error) {
      $('numState').textContent = error.message;
      $('numState').className = 'save-state bad';
    }
    renderSettings(); renderBatch();
  });
}

function renderParties() {
  if (!state.settings) return;
  const count = {};
  for (const d of state.docs) count[d.partyId] = (count[d.partyId] || 0) + 1;
  const list = state.parties.slice().sort((a, b) => a.name.localeCompare(b.name));
  $('partiesTable').innerHTML = `<thead><tr><th class="left">Nome</th><th class="left">Tipo</th><th class="left">Partita IVA</th><th class="left">Di solito fattura</th><th class="left">Categoria</th><th>Documenti</th><th></th></tr></thead>
    <tbody>${list.map((p) => `<tr>
      <td class="left">${esc(p.name)}</td>
      <td class="left"><span class="pill ${p.role === 'customer' ? 'in' : 'out'}">${p.role === 'customer' ? 'cliente' : 'fornitore'}</span></td>
      <td class="left num">${esc(p.vatCode ? core.vatKey(p.country, p.vatCode) : p.country)}</td>
      <td class="left">${p.role === 'customer' ? '—' : esc(VAT_MODES[p.vatMode] || '—')}</td>
      <td class="left">${esc(core.CATEGORIES[core.categoryOf(null, p)].label)}</td>
      <td>${count[p.id] || 0}</td>
      <td class="acts"><button class="btn small" data-edit="${esc(p.id)}" type="button">Modifica</button>${count[p.id] ? '' : `<button class="btn small ghost" data-remove="${esc(p.id)}" type="button">×</button>`}</td>
    </tr>`).join('')}</tbody>`;
}

let editing = null;

function openParty(p) {
  editing = p ? p.id : null;
  const v = p || { name: '', role: 'supplier', vatMode: 'reverse', country: '', vatCode: '', address: '', city: '', cap: '00000', description: 'Servizi', aliases: [], category: 'altro' };
  const f = (name, label, extra = '') => `<div class="field ${extra}"><label>${label}</label><input type="text" name="${name}" value="${esc(Array.isArray(v[name]) ? v[name].join(', ') : v[name])}"></div>`;
  $('partyModalTitle').textContent = p ? p.name : 'Nuovo soggetto';
  $('partyForm').innerHTML = `${f('name', 'Ragione sociale', 'wide')}
    <div class="field"><label>È un</label><select name="role"><option value="supplier">fornitore · uscita</option><option value="customer">cliente · entrata</option></select></div>
    <div class="field"><label>Di solito fattura <span class="dim">(proposta, decidi per ogni documento)</span></label><select name="vatMode">${vatModeOptions(v.vatMode)}</select></div>
    <div class="field"><label>Categoria</label><select name="category">${categoryOptions(core.categoryOf(null, v), v.role === 'customer')}</select></div>
    ${f('country', 'Paese (2 lettere)')}${f('vatCode', 'Partita IVA (senza prefisso)')}
    ${f('address', 'Indirizzo', 'wide')}${f('city', 'Città')}${f('cap', 'CAP (estero: 00000)')}
    ${f('description', 'Descrizione nelle TD17', 'wide')}
    ${f('aliases', 'Altri nomi con cui compare, separati da virgola', 'wide')}`;
  $('partyForm').elements.role.value = v.role;
  $('partyForm').elements.vatMode.value = v.vatMode;
  $('partyForm').elements.role.onchange = (e) => {
    $('partyForm').elements.category.innerHTML = categoryOptions(core.guessCategory({ ...v, role: e.target.value, aliases: [] }), e.target.value === 'customer');
  };
  $('partyError').textContent = '';
  $('partyModal').hidden = false;
}

function wireParties() {
  $('addParty').addEventListener('click', () => openParty(null));
  $('partiesTable').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]')?.dataset.edit;
    if (edit) { openParty(partyById[edit]); return; }
    const remove = e.target.closest('[data-remove]')?.dataset.remove;
    if (remove && window.confirm(`Eliminare ${partyById[remove].name} dall'anagrafica?`)) {
      try { await api(`/parties/${encodeURIComponent(remove)}`, { method: 'DELETE' }); await reload(); } catch (error) { window.alert(error.message); }
    }
  });
  $('partyModal').addEventListener('click', (e) => { if (e.target === $('partyModal') || e.target.closest('[data-close]')) $('partyModal').hidden = true; });
  $('partySave').addEventListener('click', async () => {
    const body = Object.fromEntries([...$('partyForm').elements].filter((el) => el.name).map((el) => [el.name, el.value.trim()]));
    if (editing) body.id = editing;
    try {
      await api('/parties', { method: 'POST', body });
      $('partyModal').hidden = true;
      await reload();
    } catch (error) { $('partyError').textContent = error.message; }
  });
}

/* ------------------------------------------------------------------ */
/* Avvio                                                               */
/* ------------------------------------------------------------------ */

wireTabs();
wireDrop();
wireBatch();
wireDocs();
wireSettings();
wireParties();
wireTax();
$('yearPick').addEventListener('change', renderOverview);

reload()
  .then(() => {
    $('state').hidden = true;
    $('main').hidden = false;
    showTab(location.hash.slice(1));
  })
  .catch((error) => {
    $('state').className = 'state error';
    $('state').textContent = `Non riesco a leggere la contabilità: ${error.message}`;
  });
