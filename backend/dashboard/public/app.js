/* Vego Analytics — client. Un solo JSON da /api/data, una pagina alla volta. */

const PAGE = document.body.dataset.page;
const CACHE_KEY = 'vego-dashboard-data';
const SIM_KEY = 'vego-dashboard-sim';
const EST_KEY = 'vego-dashboard-estimate';
const THEME_KEY = 'vego-theme';
const MIX_KEY = 'vego-mix-fit';
const CACHE_MS = 45_000;

const NAV = [
  { href: '/', page: 'today', label: 'Oggi', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { href: '/money', page: 'money', label: 'Soldi', icon: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.7 0-3 1-3 2s1.3 1.6 3 2 3 1 3 2-1.3 2-3 2c-1 0-2-.5-2.5-1.5M12 6v2M12 16v2"/>' },
  { href: '/people', page: 'people', label: 'Persone', icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M21.5 19c0-2.6-1.8-4.5-4.5-4.5"/>' },
  { href: '/onboarding', page: 'onboarding', label: 'Onboarding', icon: '<path d="M4 6h10a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h12"/><circle cx="4" cy="6" r="1.5"/><circle cx="20" cy="18" r="1.5"/>' },
  { href: '/product', page: 'product', label: 'Costi AI', icon: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>' },
  { href: '/users', page: 'users', label: 'Utenti', icon: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>' },
  { href: '/ricettario', page: 'catalog', label: 'Ricettario', icon: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>' },
  // Amministrazione, non analytics: entrate, uscite e autofatture.
  { href: '/contabilita', page: 'ledger', label: 'Contabilità', icon: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>' },
  // Non è una pagina di analytics: apre lo strumento di produzione, che
  // si prende lo schermo intero e torna indietro con un pulsante suo.
  { href: '/distribution', page: 'distribution', label: 'Distribution', icon: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 7.2l7 3.6M8.5 16.8l7-3.6"/>' },
];

const charts = {};
let data = null;

/* ------------------------------------------------------------------ */
/* Tema e colori                                                       */
/* ------------------------------------------------------------------ */

/* I colori dei grafici vengono letti dal CSS, così un solo posto decide
   com'è fatto il sito e i canvas seguono. */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let C = {};

function refreshPalette() {
  C = {
    // I `--c-*` sono i toni da riempire: nel tema chiaro sono pastello,
    // e un grafico è quasi tutto riempimento. Il testo dentro i canvas
    // usa `ink2` e `muted`, che restano leggibili.
    green: cssVar('--c-green'), greenDeep: cssVar('--c-green-2'), greenSoft: cssVar('--c-green-soft'),
    amber: cssVar('--c-amber'), red: cssVar('--c-red'), blue: cssVar('--c-blue'),
    grey: cssVar('--c-grey'), grey2: cssVar('--c-grey-2'),
    ink: cssVar('--ink'), ink2: cssVar('--ink-2'), muted: cssVar('--muted'),
    line: cssVar('--line-chart'), tipBg: cssVar('--tooltip-bg'), tipInk: cssVar('--tooltip-ink'),
  };
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = C.muted;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.boxWidth = 9;
  Chart.defaults.plugins.legend.labels.boxHeight = 9;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.position = 'bottom';
  Chart.defaults.plugins.legend.align = 'start';
  Chart.defaults.plugins.tooltip.backgroundColor = C.tipBg;
  Chart.defaults.plugins.tooltip.titleColor = C.tipInk;
  Chart.defaults.plugins.tooltip.bodyColor = C.tipInk;
  Chart.defaults.plugins.tooltip.footerColor = C.tipInk;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 9;
  Chart.defaults.plugins.tooltip.displayColors = false;
  Chart.defaults.elements.bar.borderRadius = 5;
  Chart.defaults.elements.bar.borderSkipped = 'start';
  Chart.defaults.scale.grid.color = C.line;
  Chart.defaults.scale.border = { display: false };
  Chart.defaults.scale.ticks.padding = 6;
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  refreshPalette();
  renderSidebar();
  // I canvas hanno i colori dentro: si ridisegna la pagina.
  if (data) { const render = RENDERERS[PAGE]; if (render) render(); }
}

refreshPalette();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const int = (v) => num(v).toLocaleString('it-IT');

function usd(v, opts = {}) {
  const n = num(v);
  if (n === 0 && !opts.zero) return '$0';
  const abs = Math.abs(n);
  // Sopra il dollaro si legge come un prezzo; sotto servono più cifre
  // perché i costi per chiamata vivono nei millesimi.
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : abs >= 0.1 ? 3 : 4;
  const sign = n < 0 ? '−' : '';
  return `${sign}$${abs.toFixed(digits)}`;
}

function pct(part, whole, digits = 1) {
  if (!whole) return '—';
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

function share(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const n = v * 100;
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(digits)}%`;
}

function shortDay(day) {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

function longDay(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

function lastDays(n) {
  const d = data.daily || [];
  return d.length > n ? d.slice(-n) : d;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function tip(text) {
  return text ? `<span class="tip" data-tip="${esc(text)}"></span>` : '';
}

function sortEntries(map, limit = 8) {
  return Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Componenti                                                          */
/* ------------------------------------------------------------------ */

function hero({ label, value, sub, help, tone, small }) {
  return `<div class="hero ${tone || ''}">
    <div class="label">${label}${tip(help)}</div>
    <div class="value ${small ? 'small' : ''}">${value}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
  </div>`;
}

function stat({ label, value, unit, sub, help, tone, spark }) {
  return `<div class="stat ${tone || ''}">
    <div class="label">${label}${tip(help)}</div>
    <div class="value">${value}${unit ? `<small>${unit}</small>` : ''}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
    ${spark ? `<div class="spark"><canvas id="${spark}"></canvas></div>` : ''}
  </div>`;
}

function heroRow(heroHtml, stats) {
  return `<section class="hero-row">${heroHtml}<div class="stats-row">${stats.join('')}</div></section>`;
}

function trend(curr, prev, { invert } = {}) {
  if (!prev) return '';
  const d = (curr - prev) / prev;
  if (Math.abs(d) < 0.005) return '<span class="trend flat">= 7g prima</span>';
  const good = invert ? d < 0 : d > 0;
  return `<span class="trend ${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${share(Math.abs(d), 0)} vs 7g prima</span>`;
}

/* Etichetta · barra · numero. */
function bars(rows, { max, color, suffix } = {}) {
  if (!rows.length) return '<p class="empty">Niente da mostrare.</p>';
  const top = max || Math.max(...rows.map((r) => r.n), 1);
  return rows.map((r) => `
    <div class="row">
      <span class="l" title="${esc(r.label)}">${esc(r.label)}</span>
      <div class="bar"><span class="${r.color || color || ''}" style="width:${Math.min(100, (r.n / top) * 100).toFixed(1)}%"></span></div>
      <span class="n">${r.value ?? int(r.n)}${r.sub ? `<small>${r.sub}</small>` : (suffix ? `<small>${suffix}</small>` : '')}</span>
    </div>`).join('');
}

/* Una barra sola divisa in segmenti, con la legenda sotto. Sostituisce
   i doughnut: le percentuali si leggono da sinistra a destra. */
function split(segments, { fmt } = {}) {
  const total = segments.reduce((s, x) => s + num(x.value), 0);
  if (!total) return '<p class="empty">Niente da ripartire.</p>';
  const track = segments.filter((s) => num(s.value) > 0).map((s) => `<span style="width:${((s.value / total) * 100).toFixed(2)}%;background:${s.color}" title="${esc(s.label)} · ${share(s.value / total, 0)}"></span>`).join('');
  const legend = segments.map((s) => `<div><i style="background:${s.color}"></i>${esc(s.label)} <b>${share(s.value / total, 0)}</b><small>${fmt ? fmt(s.value) : int(s.value)}</small></div>`).join('');
  return `<div class="track">${track}</div><div class="legend">${legend}</div>`;
}

/* Funnel orizzontale: ogni passo è una colonna con il numero, la quota
   sul primo passo e quanti si sono persi rispetto al passo prima. */
function funnel(steps) {
  const first = steps[0] ? num(steps[0].n) : 0;
  return steps.map((s, i) => {
    const prev = i ? num(steps[i - 1].n) : null;
    const lost = prev !== null ? prev - num(s.n) : null;
    const width = first ? Math.max(1.5, (num(s.n) / first) * 100) : 0;
    return `<div class="fstep">
      <div class="top"><span class="n">${int(s.n)}</span><span class="p">${i ? pct(s.n, first, 0) : ''}</span></div>
      <div class="bar"><span style="width:${width.toFixed(1)}%;${s.color ? `background:${s.color}` : ''}"></span></div>
      <div class="l" title="${esc(s.label)}">${esc(s.label)}</div>
      <div class="d">${lost === null ? (s.sub || '') : (lost > 0 ? `−${int(lost)} · ${pct(s.n, prev, 0)} del passo prima` : (s.sub || 'nessuna perdita'))}</div>
    </div>`;
  }).join('');
}

/* Le due schede dei piani, incasso netto contro costo AI. */
function planCards(plans, { partialWeek, partialYear } = {}) {
  return plans.map((p) => {
    const margin = p.proceeds - p.cost;
    const pctMargin = p.proceeds ? margin / p.proceeds : 0;
    const top = Math.max(p.proceeds, p.cost, 0.0001);
    const partial = p.id === 'weekly' ? partialWeek : partialYear;
    return `<div class="plan">
      <div class="head"><h3>${p.label}</h3><span class="price">${usd(p.price)} ${p.period}</span></div>
      <div class="margin"><span class="v ${margin >= 0 ? 'pos' : 'neg'}">${usd(margin)}</span><span class="p ${margin >= 0 ? 'pos' : 'neg'}">${share(pctMargin, 0)}</span><span class="l">margine${partial ? ' · costo parziale' : ''}</span></div>
      <div class="rows">
        <div class="r"><span class="l">Incasso netto</span><div class="bar"><span style="width:${((p.proceeds / top) * 100).toFixed(1)}%"></span></div><span class="n">${usd(p.proceeds)}</span></div>
        <div class="r"><span class="l">Costo AI</span><div class="bar"><span class="cost" style="width:${((p.cost / top) * 100).toFixed(1)}%"></span></div><span class="n">${usd(p.cost)}</span></div>
      </div>
    </div>`;
  }).join('');
}

/* Il valore scritto sulla barra: quando il costo è l'uno per cento
   dell'incasso, la barra da sola non dice niente. */
function barValues(format) {
  return {
    id: 'barValues',
    afterDatasetsDraw(c) {
      const horizontal = c.options.indexAxis === 'y';
      const { ctx } = c;
      ctx.save();
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = C.ink2;
      ctx.textAlign = horizontal ? 'left' : 'center';
      ctx.textBaseline = horizontal ? 'middle' : 'bottom';
      c.data.datasets.forEach((dataset, di) => {
        const meta = c.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((element, i) => {
          const value = dataset.data[i];
          if (value === null || value === undefined) return;
          const x = horizontal ? element.x + 6 : element.x;
          const y = horizontal ? element.y : element.y - 5;
          ctx.fillText(format(value), x, y);
        });
      });
      ctx.restore();
    },
  };
}

function chart(id, config) {
  const el = $(id);
  if (!el || typeof Chart === 'undefined') return null;
  if (charts[id]) charts[id].destroy();
  if (el.parentElement) el.parentElement.removeAttribute('data-empty');
  charts[id] = new Chart(el, config);
  return charts[id];
}

/* Un grafico senza dati mostra una frase, non due assi vuoti. */
function chartEmpty(id, message) {
  const el = $(id);
  if (!el) return;
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  if (el.parentElement) el.parentElement.dataset.empty = message;
}

function spark(id, values, color) {
  chart(id, {
    type: 'line',
    data: {
      labels: values.map((_, i) => i),
      datasets: [{ data: values, borderColor: color || C.green, borderWidth: 1.6, pointRadius: 0, tension: .35, fill: true, backgroundColor: C.greenSoft }],
    },
    options: {
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, min: 0 } },
      layout: { padding: 0 },
    },
  });
}

const noGrid = { grid: { display: false } };
const moneyTicks = { ticks: { callback: (v) => usd(v) }, min: 0 };
const countTicks = { ticks: { precision: 0 }, min: 0 };

/* ------------------------------------------------------------------ */
/* Shell: sidebar, finestra, drawer                                    */
/* ------------------------------------------------------------------ */

function renderSidebar() {
  const side = $('side');
  if (!side) return;
  const light = currentTheme() === 'light';
  const i = (data || {}).insights || {};
  const foot = data
    ? `${int(data.audience.users)} arrivati · ${int((i.funnel || {}).activated)} attivati · ${int(data.audience.paidSubscribers)} paganti`
    : (PAGE === 'ledger' || PAGE === 'catalog' ? '' : 'Leggo Firestore…');
  side.innerHTML = `
    <a class="brand" href="/"><span class="dot">V</span><div><strong>Vego</strong><span>Analytics</span></div></a>
    <nav>${NAV.map((n) => `<a href="${n.href}" class="${n.page === PAGE ? 'active' : ''}"><svg viewBox="0 0 24 24">${n.icon}</svg>${n.label}</a>`).join('')}</nav>
    <div class="side-find"><input type="text" id="sideFind" placeholder="Apri un utente: incolla l’uid" autocomplete="off"></div>
    <div class="sidebar-foot">
      <p id="sideFoot">${foot}</p>
      <div class="foot-row">
        <button class="theme" id="themeToggle" type="button" title="Cambia tema">
          ${light
            ? '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>Scuro'
            : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>Chiaro'}
        </button>
      </div>
    </div>`;

  $('themeToggle').addEventListener('click', () => setTheme(light ? 'dark' : 'light'));
  const find = $('sideFind');
  find.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const uid = find.value.trim();
    if (uid) { openUser(uid); find.value = ''; }
  });
}

/* I conteggi partono sempre dal giorno del reset (18 set): niente storico
   completo, altrimenti si mischiano onboarding e metriche vecchie. */
function renderWindow() {
  const label = $('windowLabel');
  const w = data.window || {};
  if (!label || !w.since) return;
  label.textContent = `dal ${longDay(w.since)} · ${int(w.users)} arrivati`;
  label.title = w.excluded ? `${int(w.excluded)} arrivati prima del reset esclusi` : '';
}

function openDrawer(html) {
  const d = $('drawer');
  if (!d) return;
  d.innerHTML = html;
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  $('drawerBackdrop').classList.add('open');
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
}

function closeDrawer() {
  const d = $('drawer');
  if (!d) return;
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  $('drawerBackdrop').classList.remove('open');
}

function wireDrawer() {
  const back = $('drawerBackdrop');
  if (back) back.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
}

/* ------------------------------------------------------------------ */
/* Soldi: calcoli                                                      */
/* ------------------------------------------------------------------ */

/* I due prezzi a listino, la commissione Apple e l'LTV medio netto.
   L'LTV lo scrivi tu: dai dati non si ricava finché nessuno ha finito
   un ciclo di abbonamento intero. */
const SIM_DEFAULTS = { weekly: 7.99, yearly: 34.99, commission: 0.15, ltv: null, base: 'week:1', baseValue: null };

function loadSim() {
  try {
    return { ...SIM_DEFAULTS, ...JSON.parse(localStorage.getItem(SIM_KEY) || '{}') };
  } catch { return { ...SIM_DEFAULTS }; }
}

function saveSim(sim) {
  localStorage.setItem(SIM_KEY, JSON.stringify(sim));
}

function computeMoney(sim) {
  const paid = data.users.filter((u) => u.hasPaid);
  const n = paid.length;
  const net = 1 - sim.commission;
  const tenure = (data.economics || {}).tenure || { weeks: [], months: [], years: [], paidCount: 0, maxAgeDays: 0 };

  // Il valore di una finestra è la media di chi l'ha vissuta tutta. Se
  // nessuno ci è ancora arrivato si usa la media parziale, che va letta
  // per quello che è: un pezzo di finestra, non la finestra.
  const value = (row) => (row ? (row.avg !== null ? row.avg : row.partialAvg) : null);
  const isPartial = (row) => Boolean(row && row.avg === null);

  const week1 = tenure.weeks[0] || null;
  const month1 = tenure.months[0] || null;
  const year1 = tenure.years[0] || null;

  const pick = sim.base || 'week:1';
  const [kind, idxRaw] = pick.split(':');
  const list = kind === 'month' ? tenure.months : kind === 'year' ? tenure.years : tenure.weeks;
  const baseRow = list.find((r) => r.index === Number(idxRaw)) || list[0] || null;
  const baseValue = sim.baseValue !== null && sim.baseValue !== undefined && sim.baseValue !== ''
    ? num(sim.baseValue)
    : (value(baseRow) || 0);
  const perYear = kind === 'month' ? baseValue * 12 : kind === 'year' ? baseValue : baseValue * 52;

  const plans = [
    { id: 'weekly', label: 'Weekly', period: 'a settimana', price: sim.weekly, proceeds: sim.weekly * net, cost: value(week1) || 0 },
    { id: 'yearly', label: 'Yearly', period: 'all’anno', price: sim.yearly, proceeds: sim.yearly * net, cost: perYear },
  ];

  return { paid, n, net, tenure, week1, month1, year1, value, isPartial, baseRow, baseValue, baseKind: kind, perYear, plans };
}

function baseLabel(kind, row) {
  if (!row) return 'nessuna base';
  const word = kind === 'month' ? 'mese' : kind === 'year' ? 'anno' : 'settimana';
  return `${word} ${row.index}`;
}

/* Sottotitolo di una finestra: chiusa o in corso. */
function windowLabel(m, row, unit) {
  if (!row) return 'nessun dato';
  if (!m.isPartial(row)) return `media su ${int(row.users)} ${row.users === 1 ? 'pagante' : 'paganti'} che ${row.users === 1 ? 'ha' : 'hanno'} finito ${unit}`;
  return `finora · ${int(row.partialUsers)} ${row.partialUsers === 1 ? 'pagante' : 'paganti'} a ${num(row.partialDays).toFixed(0)} giorni su ${int(row.days)}`;
}

/* ------------------------------------------------------------------ */
/* Oggi                                                                */
/* ------------------------------------------------------------------ */

function renderToday() {
  const sim = loadSim();
  const m = computeMoney(sim);
  const i = data.insights || {};
  const f = i.funnel || {};
  const s = i.stickiness || {};
  const econ = data.economics.paidSubscribers;
  const days = lastDays(30);
  const today = days[days.length - 1] || {};
  const new7 = days.slice(-7).reduce((a, d) => a + d.newUsers, 0);
  const newPrev7 = days.slice(-14, -7).reduce((a, d) => a + d.newUsers, 0);

  $('todayHero').innerHTML = heroRow(
    hero({ label: 'Utenti paganti', value: int(m.n),
      sub: m.n ? `${int(econ.active)} attivi · ${int(econ.lapsed)} scaduti · ${pct(m.n, f.accounts, 1)} di chi è arrivato` : 'nessun pagamento registrato',
      help: 'Account con subscription.hasPaid = true, scritto dal webhook Superwall a ogni pagamento reale.' }),
    [
      stat({ label: 'Arrivati', value: int(f.accounts), sub: 'hanno aperto l’app almeno una volta', help: 'Firebase crea il documento al primo avvio: questo numero conta chi ha aperto l’app, non chi si è registrato.' }),
      stat({ label: 'Nuovi · 7 giorni', value: int(new7), sub: trend(new7, newPrev7) || 'primi 7 giorni di dati', spark: 'sparkNew' }),
      stat({ label: 'Attivi oggi', value: int(s.dau), sub: `media 7g ${num(s.dau7).toFixed(1)}`, help: 'Utenti distinti con almeno un evento oggi (UTC).' }),
      stat({ label: 'Attivi · 30 giorni', value: int(s.mau), sub: `stickiness ${share(s.dauMau, 0)}`, help: 'MAU. Stickiness = DAU / MAU.' }),
      stat({ label: 'Spesa AI oggi', value: usd(today.usd), sub: `${int(today.jobs)} job`, help: 'Gemini + immagini + RapidAPI, oggi.' }),
    ],
  );
  spark('sparkNew', days.slice(-14).map((d) => d.newUsers));

  $('todayFunnelHint').textContent = f.accounts ? `${pct(f.paid, f.accounts, 1)} di chi arriva paga` : '';
  $('todayFunnel').innerHTML = funnel([
    { label: 'Arrivati', n: f.accounts },
    { label: 'Onboarding iniziato', n: f.started },
    { label: 'Paywall visto', n: f.completed },
    { label: 'Prodotto usato', n: f.activated },
    { label: 'Paganti', n: f.paid },
  ]);

  // Costo di un pagante, in tre finestre. Il parziale va in ambra.
  const tone = (row) => (m.isPartial(row) ? 'warn' : '');
  $('todayCostHint').textContent = m.n ? 'media per pagante, per finestra di vita' : '';
  $('todayCost').innerHTML = [
    stat({ label: 'Prima settimana', value: usd(m.value(m.week1)), sub: windowLabel(m, m.week1, 'la settimana'), tone: tone(m.week1) }),
    stat({ label: 'Primo mese', value: usd(m.value(m.month1)), sub: windowLabel(m, m.month1, 'il mese'), tone: tone(m.month1) }),
    stat({ label: 'Primo anno', value: usd(m.value(m.year1)), sub: windowLabel(m, m.year1, 'l’anno'), tone: tone(m.year1) }),
  ].join('');
  $('todayCostRead').innerHTML = m.baseRow
    ? `Portando ${baseLabel(m.baseKind, m.baseRow)} a dodici mesi, un pagante costa <strong>${usd(m.perYear)}</strong> l’anno${m.isPartial(m.baseRow) ? ' <span class="pill amber">base parziale</span>' : ''}.`
    : '';

  $('todayPlansHint').textContent = `listino ${usd(sim.weekly)} e ${usd(sim.yearly)} · Apple ${share(1 - m.net, 0)}`;
  $('todayPlans').innerHTML = planCards(m.plans, { partialWeek: m.isPartial(m.week1), partialYear: m.isPartial(m.baseRow) });

  const d14 = days.slice(-14);
  $('todaySpendNow').textContent = usd(d14.reduce((a, d) => a + num(d.usd), 0));
  chart('todaySpendChart', {
    type: 'bar',
    data: { labels: d14.map((d) => shortDay(d.day)), datasets: [{ data: d14.map((d) => d.usd), backgroundColor: C.green }] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => usd(ctx.raw) } } },
      scales: { x: noGrid, y: moneyTicks },
    },
  });

  const sc = data.sourceConversion || { rows: [] };
  const withPaid = sc.rows.filter((r) => r.paid > 0).sort((a, b) => b.paid - a.paid).slice(0, 6);
  $('todaySourcesHint').textContent = withPaid.length ? 'paganti per fonte dichiarata' : '';
  $('todaySources').innerHTML = withPaid.length
    ? bars(withPaid.map((r) => ({ label: r.id, n: r.paid, sub: r.rate === null ? `su ${int(r.users)}` : share(r.rate, 0) })))
    : '<p class="empty">Nessun pagante con una fonte dichiarata.</p>';

  const recent = [...m.paid].sort((a, b) => String(b.firstDay || '').localeCompare(String(a.firstDay || ''))).slice(0, 6);
  $('todayRecent').innerHTML = recent.length
    ? recent.map((u) => `<div class="item" data-uid="${esc(u.uid)}">
        <div><div class="t">${esc(u.name) || `<span class="mono">${esc(u.uid.slice(0, 10))}…</span>`}</div><div class="s">${u.referral ? esc(u.referral) : 'fonte non dichiarata'}${u.diet ? ` · ${esc(u.diet)}` : ''}</div></div>
        <div class="r">${u.firstDay ? longDay(u.firstDay) : ''}</div>
      </div>`).join('')
    : '<p class="empty">Ancora nessuno.</p>';
  $('todayRecent').querySelectorAll('[data-uid]').forEach((el) => el.addEventListener('click', () => openUser(el.dataset.uid)));

  // Onboarding in breve: prima slide, ultima, e qualche tappa in mezzo.
  const ob = data.onboarding;
  if (ob && ob.steps.length) {
    const steps = ob.steps;
    const last = steps[steps.length - 1];
    const worst = worstStep(steps);
    const want = new Set([0, steps.length - 1]);
    const n = Math.min(7, steps.length);
    for (let k = 1; k < n - 1; k += 1) want.add(Math.round((k * (steps.length - 1)) / (n - 1)));
    if (worst && worst.dropped) want.add(worst.index);
    const picked = [...want].sort((a, b) => a - b).map((idx) => steps[idx]);
    $('todayOnbPct').textContent = ob.started ? share(last.pctOfStart) : '—';
    $('todayOnbHint').textContent = ob.started ? `${int(ob.completed)} su ${int(ob.started)} dalla prima slide al paywall` : 'nessun passaggio ancora';
    $('todayOnb').innerHTML = funnel(picked.map((st) => ({
      label: `${st.index + 1}. ${st.label}`,
      n: st.reached,
      color: worst && st.index === worst.index && worst.dropped ? C.amber : null,
      sub: st.index === 0 ? 'prima slide' : '',
    })));
  }
}

/* ------------------------------------------------------------------ */
/* Soldi                                                               */
/* ------------------------------------------------------------------ */

/* Le medie per anzianità: settimane da una parte, mesi e anni
   dall'altra. Le finestre che nessuno ha ancora finito restano in
   chiaro col bordo, perché un parziale letto come definitivo è un
   prezzo sbagliato. */
function renderTenure(m) {
  if (!$('weeksChart')) return;
  const t = m.tenure;

  const drawSeries = (canvasId, hintId, readId, rows, unit) => {
    const solid = rows.filter((r) => r.avg !== null);
    $(hintId).textContent = rows.length
      ? `${solid.length} ${solid.length === 1 ? 'finestra chiusa' : 'finestre chiuse'} su ${rows.length} · le vuote sono in corso`
      : 'nessun pagante è ancora arrivato qui';

    if (!rows.length) {
      chartEmpty(canvasId, `Nessun pagante ha ancora vissuto ${unit === 'Settimana' ? 'una settimana' : 'un mese'} intero`);
      $(readId).innerHTML = '';
      return;
    }

    chart(canvasId, {
      type: 'bar',
      plugins: [barValues((v) => usd(v))],
      data: {
        labels: rows.map((r) => `${r.unit || unit} ${r.index}`),
        datasets: [{
          data: rows.map((r) => (r.avg !== null ? r.avg : r.partialAvg)),
          backgroundColor: rows.map((r) => (r.avg !== null ? C.green : C.greenSoft)),
          borderColor: rows.map(() => C.green),
          borderWidth: rows.map((r) => (r.avg !== null ? 0 : 1.5)),
        }],
      },
      options: {
        layout: { padding: { top: 20 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const r = rows[ctx.dataIndex];
                return r.avg !== null
                  ? `${usd(r.avg)} in media · ${int(r.users)} paganti`
                  : `${usd(r.partialAvg)} finora · ${int(r.partialUsers)} paganti a ${num(r.partialDays).toFixed(0)} giorni su ${int(r.days)}`;
              },
            },
          },
        },
        scales: { x: noGrid, y: moneyTicks },
      },
    });

    const partial = rows.filter((r) => r.avg === null);
    const parts = [];
    if (solid.length >= 2) {
      const delta = solid[solid.length - 1].avg - solid[0].avg;
      parts.push(`Dalla prima all’ultima finestra chiusa il costo ${delta <= 0 ? 'cala' : 'sale'} di <strong>${usd(Math.abs(delta))}</strong>.`);
    }
    if (partial.length) {
      const r = partial[0];
      parts.push(`${r.unit || unit} ${r.index} è in corso: ${int(r.partialUsers)} ${r.partialUsers === 1 ? 'pagante' : 'paganti'} a ${num(r.partialDays).toFixed(0)} giorni su ${int(r.days)}, ${usd(r.partialAvg)} finora.`);
    }
    $(readId).innerHTML = parts.join(' ');
  };

  drawSeries('weeksChart', 'weeksHint', 'weeksRead', t.weeks, 'Settimana');
  const monthsAndYears = [...t.months.map((r) => ({ ...r, unit: 'Mese' })), ...t.years.map((r) => ({ ...r, unit: 'Anno' }))];
  drawSeries('monthsChart', 'monthsHint', 'monthsRead', monthsAndYears, 'Mese');

  const all = [
    ...t.weeks.map((r) => ({ ...r, name: `Settimana ${r.index}` })),
    ...t.months.map((r) => ({ ...r, name: `Mese ${r.index}` })),
    ...t.years.map((r) => ({ ...r, name: `Anno ${r.index}` })),
  ];
  $('tenureTable').innerHTML = all.length ? `
    <thead><tr><th>Finestra</th><th>Giorni di vita</th><th>Paganti che l’hanno finita</th><th>Media</th><th>In corso</th></tr></thead>
    <tbody>${all.map((r) => `<tr>
      <td class="strong">${r.name}</td>
      <td class="dim">${int(r.from + 1)}–${int(r.to + 1)}</td>
      <td>${int(r.users)}</td>
      <td class="strong">${r.avg === null ? '—' : usd(r.avg)}</td>
      <td class="dim">${r.partialUsers ? `${int(r.partialUsers)} a ${num(r.partialDays).toFixed(0)} giorni · ${usd(r.partialAvg)} finora` : '—'}</td>
    </tr>`).join('')}</tbody>` : '<tbody><tr><td class="empty">Nessun pagante con giorni di vita registrati.</td></tr></tbody>';
}

/* Scegli la finestra, correggi il numero se vuoi, leggi l'anno. */
function renderTenureSim(sim, m) {
  if (!$('tenureSim')) return;
  const t = m.tenure;
  const options = [
    ...t.weeks.map((r) => ({ id: `week:${r.index}`, label: `Settimana ${r.index}`, row: r })),
    ...t.months.map((r) => ({ id: `month:${r.index}`, label: `Mese ${r.index}`, row: r })),
    ...t.years.map((r) => ({ id: `year:${r.index}`, label: `Anno ${r.index}`, row: r })),
  ];
  const current = sim.base || 'week:1';

  $('tenureSim').innerHTML = `
    <div class="field">
      <label>Finestra di riferimento</label>
      <select id="tenureBase">
        ${options.length
          ? options.map((o) => `<option value="${o.id}" ${o.id === current ? 'selected' : ''}>${o.label}${o.row.avg === null ? ' · parziale' : ''} — ${usd(o.row.avg !== null ? o.row.avg : o.row.partialAvg)}</option>`).join('')
          : '<option>Nessuna finestra disponibile</option>'}
      </select>
    </div>
    <div class="field">
      <label>Costo di quella finestra</label>
      <div class="in"><span>$</span><input type="number" step="0.001" min="0" id="tenureValue" value="${num(m.baseValue).toFixed(3)}"></div>
    </div>
    <div class="foot"><span>Salvato nel browser.</span><button class="btn small" id="tenureReset" type="button">Rimetti la media</button></div>`;

  $('tenureBase').addEventListener('change', (e) => { saveSim({ ...loadSim(), base: e.target.value, baseValue: null }); renderMoney(); });
  $('tenureValue').addEventListener('change', (e) => { saveSim({ ...loadSim(), baseValue: e.target.value === '' ? null : num(e.target.value) }); renderMoney(); });
  $('tenureReset').addEventListener('click', () => { saveSim({ ...loadSim(), baseValue: null }); renderMoney(); });

  const perWeek = m.baseKind === 'month' ? m.baseValue / 4.345 : m.baseKind === 'year' ? m.baseValue / 52 : m.baseValue;
  const perMonth = m.perYear / 12;
  const partial = m.baseRow && m.baseRow.avg === null;
  $('tenureEstHint').textContent = m.baseRow
    ? `da ${baseLabel(m.baseKind, m.baseRow)} a ${usd(m.baseValue)}${partial ? ' · base parziale' : ''}`
    : 'nessuna base disponibile';
  const tone = partial ? 'warn' : 'good';
  $('tenureEst').innerHTML = [
    stat({ label: 'A settimana', value: usd(perWeek), tone }),
    stat({ label: 'Al mese', value: usd(perMonth), tone }),
    stat({ label: 'All’anno', value: usd(m.perYear), tone }),
  ].join('');
}

function renderSim(sim) {
  $('sim').innerHTML = `
    <div class="field wide"><label>Prezzo weekly</label><div class="in"><span>$</span><input type="number" step="0.01" min="0" id="simWeekly" value="${sim.weekly}"></div></div>
    <div class="field wide"><label>Prezzo yearly</label><div class="in"><span>$</span><input type="number" step="0.01" min="0" id="simYearly" value="${sim.yearly}"></div></div>
    <div class="field wide"><label>Commissione Apple</label><div class="in"><input type="number" step="1" min="0" max="100" id="simCommission" value="${Math.round(sim.commission * 100)}"><span>%</span></div></div>
    <div class="foot"><span>Salvato nel browser.</span><button class="btn small" id="simReset" type="button">Default</button></div>`;

  const update = (patch) => { saveSim({ ...loadSim(), ...patch }); renderMoney(); };
  $('simWeekly').addEventListener('change', (e) => update({ weekly: num(e.target.value) }));
  $('simYearly').addEventListener('change', (e) => update({ yearly: num(e.target.value) }));
  $('simCommission').addEventListener('change', (e) => update({ commission: num(e.target.value) / 100 }));
  $('simReset').addEventListener('click', () => { localStorage.removeItem(SIM_KEY); renderMoney(); });
}

function renderLtv(sim, m) {
  const ltv = sim.ltv === null || sim.ltv === '' ? null : num(sim.ltv);

  $('ltvForm').innerHTML = `
    <div class="field wide">
      <label>LTV medio per pagante, netto Apple</label>
      <div class="in"><span>$</span><input type="number" step="0.01" min="0" id="ltvValue" placeholder="scrivilo qui" value="${ltv === null ? '' : ltv}"></div>
    </div>`;
  $('ltvValue').addEventListener('change', (e) => { saveSim({ ...loadSim(), ltv: e.target.value === '' ? null : num(e.target.value) }); renderMoney(); });

  $('ltvHint').textContent = ltv === null ? 'scrivi l’LTV per vedere quanto resta' : `contro ${usd(m.perYear)} di costo AI stimato nel primo anno`;

  chart('ltvChart', {
    type: 'bar',
    plugins: [barValues((v) => usd(v))],
    data: {
      labels: ['LTV netto', 'Costo AI · primo anno'],
      datasets: [{ data: [ltv === null ? 0 : ltv, m.perYear], backgroundColor: [C.green, C.grey2] }],
    },
    options: {
      indexAxis: 'y',
      layout: { padding: { right: 64 } },
      scales: { x: moneyTicks, y: noGrid },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => usd(ctx.raw) } } },
    },
  });

  $('ltvRead').innerHTML = ltv === null
    ? ''
    : `Restano <strong class="${ltv - m.perYear >= 0 ? 'pos' : 'neg'}">${usd(ltv - m.perYear)}</strong> per pagante dopo un anno di costi AI (${share(m.perYear / ltv, 0)} dell’LTV va in AI).`;
}

const PLAN_LABELS = { weekly: 'Weekly', yearly: 'Yearly', monthly: 'Monthly', unknown: 'Non riconosciuto' };

/* Quale dei due piani comprano: la media dei costi va letta sapendo
   quanti pagano una settimana alla volta. */
function renderPaidPlans() {
  const p = (data.insights || {}).paidPlans;
  if (!$('plansMix') || !p) return;

  const order = ['weekly', 'yearly', 'monthly', 'unknown'].filter((k) => p.counts[k] > 0);
  if (!p.total || !order.length) {
    $('plansHint').textContent = 'nessun pagamento nella finestra';
    $('plansMix').innerHTML = '<p class="empty">Nessun abbonamento da ripartire.</p>';
    $('plansStats').innerHTML = '';
    $('plansRead').innerHTML = '';
    return;
  }

  const colorOf = { weekly: C.blue, yearly: C.green, monthly: C.amber, unknown: C.grey2 };
  $('plansHint').textContent = `${int(p.total)} paganti`;
  $('plansMix').innerHTML = split(order.map((k) => ({ label: PLAN_LABELS[k], value: p.counts[k], color: colorOf[k] })));
  $('plansStats').innerHTML = bars(p.rawIds.map((r) => ({ label: r.id, n: r.n, value: int(r.n), sub: share(r.n / p.total, 0), color: 'grey' })), { max: p.total });

  const parts = [];
  if (p.counts.weekly || p.counts.yearly) parts.push(`<strong>${share(p.counts.yearly / p.total, 0)}</strong> prende l’annuale, <strong>${share(p.counts.weekly / p.total, 0)}</strong> la settimana.`);
  if (p.counts.unknown) parts.push(`${int(p.counts.unknown)} abbonamenti hanno un identificativo che non dice la durata.`);
  $('plansRead').innerHTML = parts.join(' ');
}

function renderMoney() {
  const sim = loadSim();
  const m = computeMoney(sim);
  const econ = data.economics.paidSubscribers;
  const days = lastDays(30);
  const tone = (row) => (m.isPartial(row) ? 'warn' : '');

  $('moneyHero').innerHTML = heroRow(
    hero({ label: 'Prima settimana di un pagante', value: usd(m.value(m.week1)), sub: windowLabel(m, m.week1, 'la settimana'), tone: tone(m.week1),
      help: 'Media di quanto ha speso in AI ogni pagante nei suoi primi 7 giorni di vita. Entrano solo i paganti che quei 7 giorni li hanno già compiuti; se nessuno, è quanto speso finora.' }),
    [
      stat({ label: 'Utenti paganti', value: int(m.n), sub: m.n ? `${int(econ.active)} attivi · ${int(econ.lapsed)} scaduti` : 'nessuno' }),
      stat({ label: 'Primo mese', value: usd(m.value(m.month1)), sub: windowLabel(m, m.month1, 'il mese'), tone: tone(m.month1), help: 'Primi 30 giorni di vita.' }),
      stat({ label: 'Primo anno', value: usd(m.value(m.year1)), sub: windowLabel(m, m.year1, 'l’anno'), tone: tone(m.year1), help: 'Primi 365 giorni di vita. Vuoto finché nessuno arriva a un anno.' }),
      stat({ label: 'Anno stimato', value: usd(m.perYear), sub: `da ${baseLabel(m.baseKind, m.baseRow)}`, tone: m.isPartial(m.baseRow) ? 'warn' : 'good', help: 'La finestra scelta nella sezione Stima, portata a dodici mesi.' }),
    ],
  );

  renderTenure(m);
  renderTenureSim(sim, m);
  renderSim(sim);

  $('marginHint').textContent = `weekly contro la prima settimana, yearly contro l’anno stimato · Apple ${share(1 - m.net, 0)}`;
  $('plans').innerHTML = planCards(m.plans, { partialWeek: m.isPartial(m.week1), partialYear: m.isPartial(m.baseRow) });

  renderLtv(sim, m);
  renderPaidPlans();

  $('spend30').textContent = usd(days.reduce((a, d) => a + num(d.usd), 0));
  chart('costDaily', {
    type: 'bar',
    data: {
      labels: days.map((d) => shortDay(d.day)),
      datasets: [
        { label: 'Gemini', data: days.map((d) => d.geminiUsd), backgroundColor: C.green, borderRadius: 0 },
        { label: 'Immagini', data: days.map((d) => d.falUsd), backgroundColor: C.blue, borderRadius: 0 },
        { label: 'RapidAPI', data: days.map((d) => d.rapidUsd), backgroundColor: C.amber, borderRadius: 0 },
      ],
    },
    options: {
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ...moneyTicks } },
      plugins: { tooltip: { displayColors: true, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${usd(ctx.raw)}` } } },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Persone                                                             */
/* ------------------------------------------------------------------ */

function statusPill(u) {
  if (u.hasPaid) return '<span class="pill green">pagante</span>';
  if (u.subscription === 'active' && u.lastSubEvent === 'trial_start') return '<span class="pill amber">trial</span>';
  if (u.subscription === 'active') return '<span class="pill blue">attivo</span>';
  if (u.subscription === 'inactive') return '<span class="pill red">scaduto</span>';
  return '<span class="pill">free</span>';
}

/* Non quale canale porta più gente, ma quale porta gente che compra. */
function renderSourceConversion() {
  const sc = data.sourceConversion;
  if (!$('sourceConvChart') || !sc) return;

  const rows = sc.rows.filter((r) => r.rate !== null);
  const small = sc.rows.filter((r) => r.rate === null && r.paid > 0);
  $('sourceConvHint').textContent = `${int(sc.totalPaid)} paganti in tutto · tasso da ${sc.minForRate} persone in su`;

  if (!rows.length) {
    chartEmpty('sourceConvChart', `Nessuna fonte ha ancora ${sc.minForRate} persone`);
    $('sourceConvRead').innerHTML = sc.rows.length
      ? `Nessuna fonte ha ancora ${sc.minForRate} persone: ${sc.rows.map((r) => `${esc(sourceLabel(r.id))} (${int(r.users)})`).join(', ')}.`
      : 'Nessuna fonte dichiarata.';
    return;
  }

  chart('sourceConvChart', {
    type: 'bar',
    plugins: [barValues((v) => share(v, 0))],
    data: { labels: rows.map((r) => sourceLabel(r.id)), datasets: [{ data: rows.map((r) => r.rate), backgroundColor: C.green }] },
    options: {
      layout: { padding: { top: 20 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${int(rows[ctx.dataIndex].paid)} paganti su ${int(rows[ctx.dataIndex].users)} · ${share(ctx.raw, 0)}` } } },
      scales: { x: noGrid, y: { ticks: { callback: (v) => share(v, 0) }, min: 0 } },
    },
  });

  const best = rows[0];
  const parts = [`Chi arriva da <strong>${esc(sourceLabel(best.id))}</strong> compra nel ${share(best.rate, 0)} dei casi (${int(best.paid)} su ${int(best.users)}).`];
  if (small.length) parts.push(`Hanno già portato paganti ma sono pochi per un tasso: ${small.map((r) => `${esc(sourceLabel(r.id))} (${int(r.paid)}/${int(r.users)})`).join(', ')}.`);
  $('sourceConvRead').innerHTML = parts.join(' ');
}

/* Il genere non lo chiediamo: un modello prova a dedurlo dai nomi, e
   "incerto" è una risposta valida. Gira solo su richiesta. */
function renderGender(result, { loading = false, error = null } = {}) {
  const hint = $('genderHint');
  const read = $('genderRead');
  if (!hint) return;

  if (loading) { hint.textContent = 'sto leggendo i nomi…'; read.innerHTML = ''; return; }
  if (error) { hint.textContent = 'stima dai nomi'; read.innerHTML = `<span class="bad">${esc(error)}</span>`; return; }
  if (!result) return;

  const total = result.named || 1;
  hint.textContent = `${int(result.named)} nomi letti · ${int(result.askedModel)} nuovi`;
  $('genderSplit').innerHTML = split([
    { label: 'Donne', value: result.counts.female, color: C.amber },
    { label: 'Uomini', value: result.counts.male, color: C.blue },
    { label: 'Incerti', value: result.counts.unknown, color: C.grey2 },
  ]);
  const parts = [`<strong>${share(result.counts.female / total, 0)}</strong> donne, <strong>${share(result.counts.male / total, 0)}</strong> uomini, ${share(result.counts.unknown / total, 0)} non decidibili dal nome.`];
  if (result.anonymous) parts.push(`${int(result.anonymous)} account senza nome restano fuori.`);
  read.innerHTML = parts.join(' ');
}

/* Il prompt ATT: quanti dicono sì, e se chi paga dice sì più degli
   altri. Il denominatore è chi l'ha visto, non chi è arrivato: prima
   della versione che lo chiede non esiste. */
function renderTracking(t) {
  const asked = num(t.asked);
  if (!asked) {
    $('trackingHint').textContent = '';
    $('trackingSplit').innerHTML = '<p class="empty">Nessuno ha ancora visto il prompt: arriva con la versione che lo chiede.</p>';
    $('trackingRead').innerHTML = '';
    $('trackingDays').innerHTML = '<p class="empty">Niente da mostrare.</p>';
    return;
  }
  const yes = num(t.yes);
  const no = num(t.no);
  const system = num(t.system);
  $('trackingHint').textContent = `${int(asked)} persone`;
  $('trackingSplit').innerHTML = split([
    { label: 'Sì', value: yes, color: C.green },
    { label: 'No', value: no, color: C.red },
    { label: 'Deciso dal sistema', value: system, color: C.grey2 },
  ]);
  const paidAsked = num(t.paidAsked);
  const paidPart = paidAsked >= 5
    ? ` Fra chi ha pagato dice sì <strong>${share(num(t.paidYes) / paidAsked, 0)}</strong> (${int(t.paidYes)} su ${int(paidAsked)}).`
    : (paidAsked ? ` Fra chi ha pagato: ${int(t.paidYes)} sì su ${int(paidAsked)}, troppo pochi per una percentuale.` : '');
  $('trackingRead').innerHTML = `<strong>${share(yes / asked, 0)}</strong> dice sì (${int(yes)} su ${int(asked)}).${paidPart}`;

  const days = Array.isArray(t.byDay) ? t.byDay : [];
  $('trackingDays').innerHTML = bars(days.map((d) => ({
    label: shortDay(d.day),
    n: d.asked,
    sub: `${int(d.yes)} sì · ${share(d.asked ? d.yes / d.asked : 0, 0)}`,
  })), { color: 'grey' });
}

function wireGender() {
  const btn = $('genderRun');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  $('genderSplit').innerHTML = '<p class="empty">Premi “Stima”: il modello legge i nomi nuovi, quelli già visti restano in cache.</p>';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    renderGender(null, { loading: true });
    try {
      const res = await fetch('/api/gender', { method: 'POST' });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'stima non riuscita');
      renderGender(out);
    } catch (error) {
      renderGender(null, { error: error.message });
    } finally {
      btn.disabled = false;
    }
  });
}

/* Le scelte dell'onboarding su Firestore sono id inglesi: qui tornano a
   essere le parole che l'utente ha letto sulla slide. */
const SOURCE_LABELS = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  appstore: 'App Store',
  friend: 'Un amico',
  youtube: 'YouTube',
  other: 'Altrove',
  'non dichiarato': 'Non dichiarato',
};

const DIET_LABELS = {
  vegan: 'Vegana',
  vegetarian: 'Vegetariana',
  pescatarian: 'Pescetariana',
  // Non si può più scegliere, ma i profili vecchi ce l'hanno scritta.
  reducer: 'Riduce la carne',
  'non impostato': 'Non dichiarata',
};

const sourceLabel = (id) => SOURCE_LABELS[id] || id;
const dietLabel = (id) => DIET_LABELS[id] || id;

/* Paganti e non paganti, in due sezioni separate.
   Col paywall duro "quanti tornano" su tutti è il tasso di conversione
   scritto al rovescio: chi non paga non ha niente da riaprire. Dei
   paganti si guarda se restano, dei non paganti quante volte tornano
   prima di decidere — e a quale di quei ritorni, chi compra, ha comprato.
   Il numero degli account non compare più da nessuna parte: Firebase ne
   crea uno appena l'app si apre, quindi conta le installazioni, non le
   persone. Per lo stesso motivo sparisce il tipo di accesso: il sign-in
   Apple viene chiesto subito dopo l'acquisto, quindi "quanti Apple"
   è "quanti paganti" scritto in un altro modo. */
function renderPeople() {
  const i = data.insights || {};
  const s = i.stickiness || {};
  const r = i.retention || {};
  const f = i.funnel || {};
  const paid = data.paidRetention || {};
  const free = data.freeBehaviour || {};
  const buy = data.buyMoment || {};
  const days = lastDays(30);
  const new7 = days.slice(-7).reduce((a, d) => a + d.newUsers, 0);
  const newPrev7 = days.slice(-14, -7).reduce((a, d) => a + d.newUsers, 0);
  const arrived = num(f.accounts);
  const paidCount = num(paid.count);
  const backShare = paidCount ? num(paid.back7) / paidCount : 0;

  $('peopleHero').innerHTML = heroRow(
    hero({
      label: 'Paganti',
      value: int(paidCount),
      sub: `${int(arrived)} arrivati · converte il ${share(arrived ? paidCount / arrived : 0, 1)}`,
      help: 'Chi ha almeno un pagamento vero secondo i webhook Superwall: la prova gratuita da sola non basta.',
    }),
    [
      stat({ label: 'Nuovi · 7 giorni', value: int(new7), sub: trend(new7, newPrev7) || 'primi 7 giorni di dati', spark: 'sparkNew' }),
      stat({ label: 'Aprono oggi', value: int(s.dau), sub: `media 7g ${num(s.dau7).toFixed(1)} ${trend(s.dau7, s.dauPrev7)}`, help: 'Persone distinte che oggi (UTC) hanno lanciato l’app o fatto qualcosa dentro.' }),
      stat({
        label: 'Paganti visti · 7 giorni',
        value: paidCount ? int(paid.back7) : '—',
        sub: paidCount ? `${share(backShare, 0)} di chi paga` : '',
        tone: paidCount && backShare >= 0.5 ? 'good' : '',
        help: 'Quanti dei paganti hanno aperto l’app negli ultimi sette giorni.',
      }),
      stat({ label: 'Attivi · 30 giorni', value: int(s.mau), help: 'Chiunque si sia fatto vedere nell’ultimo mese.' }),
      stat({ label: 'Stickiness', value: share(s.dauMau, 0), sub: 'DAU / MAU', tone: s.dauMau >= 0.2 ? 'good' : '', help: 'Quanti degli attivi del mese aprono l’app in un giorno qualsiasi. Sotto il 10% aprono e spariscono, sopra il 20% è un’abitudine.' }),
    ],
  );
  spark('sparkNew', days.slice(-14).map((d) => d.newUsers));

  /* ---- Chi ha pagato ---- */

  const weeks = paid.weeks || [];
  $('paidWeeksHint').textContent = paidCount ? `${int(paidCount)} paganti in tutto` : 'nessun pagante';
  if (weeks.length) {
    chart('paidWeeksChart', {
      type: 'bar',
      plugins: [barValues((v) => share(v, 0))],
      data: {
        labels: weeks.map((w) => `Settimana ${w.index}`),
        datasets: [{ data: weeks.map((w) => w.pct), backgroundColor: C.green }],
      },
      options: {
        layout: { padding: { top: 20 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${int(weeks[ctx.dataIndex].back)} tornati su ${int(weeks[ctx.dataIndex].mature)} paganti` } },
        },
        scales: { x: noGrid, y: { ticks: { callback: (v) => share(v, 0) }, min: 0, max: 1 } },
      },
    });
    const first = weeks[0];
    const last = weeks[weeks.length - 1];
    const parts = [`Nella prima settimana dopo l’acquisto torna <strong>${share(first.pct, 0)}</strong> dei paganti (${int(first.back)} su ${int(first.mature)}).`];
    if (weeks.length > 1) parts.push(`Alla settimana ${last.index} è ${share(last.pct, 0)}, su ${int(last.mature)} che ci sono arrivati.`);
    $('paidWeeksRead').innerHTML = parts.join(' ');
  } else {
    chartEmpty('paidWeeksChart', 'Nessun pagante ha ancora compiuto una settimana dall’acquisto.');
    $('paidWeeksRead').innerHTML = paidCount
      ? `I ${int(paidCount)} paganti sono tutti più giovani di una settimana: la prima riga compare quando il più vecchio la compie.`
      : '';
  }

  const paidDays = paid.days || [];
  const paidDaysTotal = paidDays.reduce((a, b) => a + num(b.n), 0);
  $('paidDaysHint').textContent = paidDaysTotal ? `media ${num(paid.avgDays).toFixed(1)} giorni a testa` : '';
  if (paidDaysTotal) {
    chart('paidDaysChart', {
      type: 'bar',
      plugins: [barValues((v) => int(v))],
      data: {
        labels: paidDays.map((b) => b.label),
        datasets: [{
          data: paidDays.map((b) => b.n),
          // Da "mai più" a "8+": rosa, sabbia, poi il verde che si
          // scurisce. La scala si legge da sinistra a destra come sta
          // scritto sotto.
          backgroundColor: paidDays.map((b, idx) => (idx === 0
            ? C.red
            : [C.grey2, hexAlpha(C.green, 0.55), C.green, C.greenDeep][idx - 1] || C.green)),
        }],
      },
      options: {
        layout: { padding: { top: 18 } },
        plugins: { legend: { display: false } },
        scales: { x: noGrid, y: countTicks },
      },
    });
    const never = paidDays[0];
    $('paidDaysRead').innerHTML = `<strong>${share(never.pct, 0)}</strong> ha pagato e non è più tornato (${int(never.n)} su ${int(paidDaysTotal)}).`;
  } else {
    chartEmpty('paidDaysChart', 'Nessun pagante da contare.');
    $('paidDaysRead').innerHTML = '';
  }

  const silentBase = num(paid.silentBase);
  $('paidStrip').innerHTML = [
    stat({
      label: 'Hanno usato il prodotto',
      value: paidCount ? share(num(paid.usedProduct) / paidCount, 0) : '—',
      sub: `${int(paid.usedProduct)} su ${int(paidCount)} hanno fatto qualcosa, non solo aperto`,
      tone: paidCount && num(paid.usedProduct) / paidCount < 0.7 ? 'warn' : '',
    }),
    stat({ label: 'Visti · 30 giorni', value: paidCount ? share(num(paid.back30) / paidCount, 0) : '—', sub: `${int(paid.back30)} paganti` }),
    stat({
      label: 'Silenziosi',
      value: silentBase ? share(num(paid.silent) / silentBase, 0) : '—',
      sub: silentBase
        ? `${int(paid.silent)} su ${int(silentBase)} paganti da più di due settimane`
        : 'servono due settimane dall’acquisto',
      tone: silentBase && num(paid.silent) / silentBase > 0.4 ? 'bad' : '',
      help: 'Ha pagato da più di due settimane e nelle ultime due non si è visto: l’abbonamento corre, il prodotto no.',
    }),
    stat({
      label: 'Churn · 30 giorni',
      value: r.churnBase ? share(r.churnRate, 0) : '—',
      sub: r.churnBase ? `${int(r.churned)} su ${int(r.churnBase)} attivi del mese scorso spariti` : 'servono 60 giorni di storia',
      tone: r.churnBase && r.churnRate > 0.5 ? 'bad' : '',
    }),
  ].join('');

  /* L'unica cosa che il tipo di accesso dice ancora: un Apple ID senza
     pagamento è un abbonamento che non stiamo attribuendo a nessuno. Se
     non ce ne sono, la riga non compare. */
  const accounts = data.accounts || {};
  $('paidNote').innerHTML = accounts.available && accounts.appleNotPaid
    ? `<span class="bad">${int(accounts.appleNotPaid)} ${accounts.appleNotPaid === 1 ? 'account ha' : 'account hanno'} l’Apple ID collegato senza nessun pagamento</span>: il sign-in si chiede subito dopo l’acquisto, quindi sono abbonamenti che su Apple esistono e qui no.`
    : '';

  /* ---- Chi non ha pagato ---- */

  const opens = free.opens || [];
  const withOpens = num(free.withOpens);
  $('freeOpensHint').textContent = withOpens
    ? `${int(withOpens)} su ${int(free.count)} non paganti hanno aperture registrate`
    : 'nessuna apertura registrata';
  if (withOpens) {
    chart('freeOpensChart', {
      type: 'bar',
      plugins: [barValues((v) => int(v))],
      data: {
        labels: opens.map((b) => b.label),
        datasets: [{ data: opens.map((b) => b.n), backgroundColor: opens.map((b, idx) => (idx === 0 ? C.grey2 : C.blue)) }],
      },
      options: {
        layout: { padding: { top: 18 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${int(ctx.raw)} persone · ${share(opens[ctx.dataIndex].pct, 0)}` } } },
        scales: { x: { ...noGrid, title: { display: true, text: 'aperture dell’app' } }, y: countTicks },
      },
    });
    $('freeOpensRead').innerHTML = `<strong>${share(num(free.oneAndDone) / withOpens, 0)}</strong> apre una volta e non torna più. Gli altri sono ${int(free.reopened)} persone che riaprono senza comprare, in media ${num(free.avgOpens).toFixed(1)} aperture a testa.`;
  } else {
    chartEmpty('freeOpensChart', 'Nessuna apertura registrata: la prima barra compare appena qualcuno apre l’app con una versione che manda il ping.');
    $('freeOpensRead').innerHTML = `Ci sono ${int(free.count)} non paganti, ma di nessuno sappiamo ancora quante volte è tornato.`;
  }

  const buyRows = buy.rows || [];
  const known = num(buy.known);
  $('buyMomentHint').textContent = known
    ? `${int(known)} paganti su ${int(buy.paidCount)} hanno il dato`
    : 'nessun pagante col dato';
  if (known || withOpens) {
    chart('buyMomentChart', {
      type: 'bar',
      data: {
        labels: buyRows.map((b) => b.label),
        datasets: [
          { label: 'Ha comprato qui', data: buyRows.map((b) => b.paid), backgroundColor: C.green },
          { label: 'Non pagante, fermo qui', data: buyRows.map((b) => b.waiting), backgroundColor: C.grey2 },
        ],
      },
      options: {
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } },
        scales: { x: { ...noGrid, title: { display: true, text: 'aperture dell’app' } }, y: countTicks },
      },
    });
    const pool = buyRows.slice(1).reduce((best, row) => (!best || row.waiting > best.waiting ? row : best), null);
    const parts = [];
    if (known) parts.push(`<strong>${share(buy.pctFirst, 0)}</strong> di chi paga lo fa alla prima apertura; la mediana è ${int(buy.median)}.`);
    else parts.push('Nessun pagamento è ancora arrivato da una versione che conta le aperture.');
    if (pool && pool.waiting) parts.push(`Il gruppo più grosso di indecisi sta a <strong>${esc(pool.label)}</strong> aperture: ${int(pool.waiting)} persone che tornano e non comprano.`);
    $('buyMomentRead').innerHTML = parts.join(' ');
  } else {
    chartEmpty('buyMomentChart', 'Serve almeno un pagamento arrivato da una versione che conta le aperture.');
    $('buyMomentRead').innerHTML = '';
  }

  /* ---- Ogni giorno ---- */

  chart('peopleDaily', {
    type: 'line',
    data: {
      labels: days.map((d) => shortDay(d.day)),
      datasets: [
        { label: 'Aprono', data: days.map((d) => d.activeUsers), borderColor: C.green, backgroundColor: C.greenSoft, fill: true, tension: .35, pointRadius: 0, borderWidth: 2 },
        { label: 'Usano', data: days.map((d) => d.workUsers), borderColor: C.greenDeep, tension: .35, pointRadius: 0, borderWidth: 2, borderDash: [4, 3] },
        { label: 'Nuovi', data: days.map((d) => d.newUsers), borderColor: C.blue, tension: .35, pointRadius: 0, borderWidth: 2 },
      ],
    },
    options: { scales: { x: noGrid, y: countTicks }, plugins: { tooltip: { displayColors: true } } },
  });

  const cohorts = (r.cohorts || []).slice(-12).reverse();
  // Nel chiaro il verde delle celle è un pastello: anche a piena tinta
  // resta chiaro, quindi il testo continua a essere quello della pagina.
  // Nello scuro sopra il verde acceso ci vuole l'inchiostro scuro.
  const dark = currentTheme() !== 'light';
  const cell = (v, n, base) => (v === null || v === undefined
    ? '<td class="cell na">—</td>'
    : `<td class="cell" style="background:${C.green.startsWith('#') ? hexAlpha(C.green, 0.1 + v * 0.7) : C.green};color:${dark && v > 0.55 ? '#062b1c' : 'inherit'}">${share(v, 0)}<small>${int(n)} su ${int(base)}</small></td>`);
  $('cohortTable').innerHTML = cohorts.length ? `
    <thead><tr><th>Settimana</th><th class="c">Arrivati</th><th class="c">Paganti</th><th class="c">Tornati</th><th class="c">Giorni 1–7</th><th class="c">Giorni 8–30</th></tr></thead>
    <tbody>${cohorts.map((c) => `<tr>
      <td class="week">${shortDay(c.week)}</td>
      <td class="size c">${int(c.size)}</td>
      ${cell(c.pctPaid, c.paid, c.size)}
      ${cell(c.pctPaidReturned, c.paidReturned, c.paid)}
      ${cell(c.pctPaidD7, c.paidD7, c.paidMatureD7)}
      ${cell(c.pctPaidD30, c.paidD30, c.paidMatureD30)}
    </tr>`).join('')}</tbody>` : '<tbody><tr><td class="empty">Nessuna coorte ancora.</td></tr></tbody>';
  const mature = cohorts.filter((c) => c.pctPaidD7 !== null);
  $('cohortRead').innerHTML = mature.length
    ? `Nelle coorti con almeno una settimana di vita, <strong>${share(mature.reduce((a, c) => a + c.pctPaidD7, 0) / mature.length, 0)}</strong> dei paganti torna nella prima settimana.`
    : 'Le coorti sono troppo giovani per leggere la retention a 7 giorni.';

  /* ---- Da dove arrivano, chi sono ---- */

  renderSourceConversion();
  const refs = sortEntries(data.audience.byReferral);
  $('referralStats').innerHTML = bars(refs.map(([k, v]) => ({ label: sourceLabel(k), n: v, sub: pct(v, arrived, 0) })), { color: 'grey' });

  renderTracking(data.tracking || {});

  wireGender();

  const diets = sortEntries(data.audience.byDiet, 6);
  const dietColors = [C.green, C.greenDeep, C.blue, C.amber, C.grey2, C.grey];
  $('dietSplit').innerHTML = split(diets.map(([k, v], idx) => ({ label: dietLabel(k), value: v, color: dietColors[idx % dietColors.length] })));
  const langs = sortEntries(data.audience.byLanguage, 6);
  $('langStats').innerHTML = bars(langs.map(([k, v]) => ({ label: k, n: v, sub: pct(v, arrived, 0) })), { color: 'blue' });
}

function hexAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.min(1, alpha).toFixed(2)})`;
}

/* ------------------------------------------------------------------ */
/* Onboarding                                                          */
/* ------------------------------------------------------------------ */

function worstStep(steps) {
  return steps.filter((s) => s.index < steps.length - 1).reduce((w, s) => {
    if (!w) return s;
    if (s.pctContinued < w.pctContinued) return s;
    if (s.pctContinued === w.pctContinued && s.dropped > w.dropped) return s;
    return w;
  }, null);
}

function bindShotFallback(root) {
  root.querySelectorAll('img').forEach((img) => {
    img.addEventListener('error', () => {
      const wrap = img.parentElement;
      wrap.classList.add('empty');
      wrap.textContent = 'screenshot';
      img.remove();
    });
  });
}

/* I sette lavori della slide dei blocchi. Gli id sono i rawValue di
   OnboardingBlocker nell'app. */
const BLOCKER_LABELS = {
  inspiration: 'Non so mai cosa cucinare',
  recipes: 'Ogni ricetta ha la carne',
  effort: 'Pianificare i pasti è difficile',
  grocery: 'Non so cosa mettere in lista',
  eatingOut: 'Non trovo niente al menu',
  swaps: 'Non so cosa usare al posto della carne',
  labels: 'Controllo ogni etichetta',
  // Voci della slide precedente: restano etichettate per chi ha già risposto.
  cost: 'Quanto costa alla cassa',
  family: 'Cucinare due volte',
};

/* Le prime tre voci di chi ha pagato, pesate 3/2/1. */
function renderBlockerScore(label) {
  const box = $('blockersScoreChart');
  const score = (data.blockers || {}).paidScore;
  if (!box || !score) return;

  const rows = score.rows.slice(0, 3);
  $('blockersScoreHint').textContent = score.voters
    ? `${int(score.voters)} paganti · ${int(score.total)} punti`
    : 'nessun pagante ha ancora risposto';

  if (!rows.length) {
    chartEmpty('blockersScoreChart', 'Nessun pagante ha ancora risposto alla slide');
    return;
  }

  chart('blockersScoreChart', {
    type: 'bar',
    data: {
      labels: rows.map((r) => label(r.id)),
      datasets: [
        { label: '1ª scelta · 3 punti', data: rows.map((r) => r.first * 3), backgroundColor: C.green, borderRadius: 0 },
        { label: '2ª scelta · 2 punti', data: rows.map((r) => r.second * 2), backgroundColor: C.blue, borderRadius: 0 },
        { label: '3ª scelta · 1 punto', data: rows.map((r) => r.third), backgroundColor: C.grey2, borderRadius: 0 },
      ],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        tooltip: {
          displayColors: true,
          callbacks: {
            label: (ctx) => {
              const r = rows[ctx.dataIndex];
              const people = [r.first, r.second, r.third][ctx.datasetIndex];
              return `${ctx.dataset.label}: ${int(people)} ${people === 1 ? 'persona' : 'persone'} · ${int(ctx.raw)} punti`;
            },
            footer: (items) => `Totale ${int(rows[items[0].dataIndex].score)} punti · ${share(rows[items[0].dataIndex].pctScore, 0)}`,
          },
        },
      },
      scales: { x: { stacked: true, ...countTicks }, y: { stacked: true, grid: { display: false } } },
    },
  });
}

function renderBlockers() {
  const b = data.blockers;
  const rank = $('blockersRank');
  if (!rank || !b) return;
  const label = (id) => BLOCKER_LABELS[id] || id;

  if (!b.answered) {
    rank.innerHTML = '<p class="empty">Nessuno ha ancora risposto a questa slide.</p>';
    $('blockersPaid').innerHTML = '';
    $('blockersHint').textContent = '';
    $('blockersRead').innerHTML = b.asked ? `${int(b.asked)} hanno visto la slide ma non risulta nessuna risposta salvata.` : 'La slide è nuova: i dati arrivano appena qualcuno la attraversa.';
    renderBlockerScore(label);
    return;
  }

  $('blockersHint').textContent = `${int(b.answered)} risposte · ${num(b.avgPicked).toFixed(1)} voci a testa`;
  rank.innerHTML = bars(b.rows.map((r) => ({ label: label(r.id), n: r.picked, value: int(r.picked), sub: share(r.pctPicked, 0) })), { max: b.answered });

  const paidRows = [...b.rows]
    .filter((r) => r.primary > 0)
    .sort((a, c) => (c.pctPaid ?? -1) - (a.pctPaid ?? -1) || c.primary - a.primary);
  $('blockersPaid').innerHTML = bars(paidRows.map((r) => ({
    label: label(r.id),
    n: r.pctPaid === null ? 0 : r.pctPaid,
    value: r.pctPaid === null ? '—' : share(r.pctPaid, 0),
    sub: `${int(r.primaryPaid)}/${int(r.primary)}`,
    color: r.pctPaid === null ? 'grey' : '',
  })), { max: Math.max(...paidRows.map((r) => r.pctPaid ?? 0), 0.01) });

  renderBlockerScore(label);

  const best = paidRows.find((r) => r.pctPaid !== null);
  const most = b.rows[0];
  const parts = [`Il più diffuso è <strong>${label(most.id)}</strong> (${share(most.pctPicked, 0)}).`];
  if (best) parts.push(`Chi arriva soprattutto per <strong>${label(best.id)}</strong> paga nel ${share(best.pctPaid, 0)} dei casi.`);
  else parts.push(`Nessun gruppo ha ancora ${int(b.minForRate)} persone: i tassi arrivano più avanti.`);
  $('blockersRead').innerHTML = parts.join(' ');
}

/* Etichette italiane delle risposte chiuse del quiz v2. Gli id sono
   quelli che scrive l'app su Firestore. */
const QUIZ_CHOICE_LABELS = {
  tried: { never: 'Non ancora', bounced: 'Ci ho provato, poi ho smesso', already: 'Lo faccio già' },
  household: { me: 'Solo io', couple: 'In due', family: 'Una famiglia', mixed: 'Tavola mista' },
  time: { 15: 'Circa 15 minuti', 30: 'Circa 30 minuti', cook: 'Mi piace cucinare' },
  apps: { no: 'No, è la prima', yes: 'Sì, ne ho provate altre' },
  audience: {
    curious: 'Voglio tagliare la carne',
    recipes: 'Voglio più ricette plant-based',
    already: 'Sono già vegano o vegetariano',
  },
  why: {
    health: 'Come mi sento',
    animals: 'Gli animali',
    planet: 'Il pianeta',
    taste: 'Mi piace di più',
  },
  nights: { 1: '1 notte', 2: '2 notti', 3: '3 notti', 4: '4 notti', 5: '5 notti', 6: '6 notti', 7: '7 notti' },
};

const APPLIANCE_LABELS = {
  stovetop: 'Fornello',
  oven: 'Forno',
  microwave: 'Microonde',
  freezer: 'Congelatore',
  blender: 'Frullatore',
  air_fryer: 'Friggitrice ad aria',
  pressure_cooker: 'Pentola a pressione',
  slow_cooker: 'Slow cooker',
  food_processor: 'Robot da cucina',
  grill: 'Grill',
};

function quizChoiceLabel(group, id) {
  return (QUIZ_CHOICE_LABELS[group] || {})[id] || APPLIANCE_LABELS[id] || id;
}

function labeledChoices(ids, group) {
  if (!Array.isArray(ids) || !ids.length) return null;
  return ids.map((id) => quizChoiceLabel(group, id));
}

function paidSub(r) {
  if (!r.picked) return '';
  const picked = share(r.pctPicked, 0);
  if (r.pctPaid === null) return picked;
  return `${picked} · ${share(r.pctPaid, 0)}`;
}

function choicePanel(title, hint, mix, group, span, keepEmpty) {
  const empty = !mix || !mix.answered;
  const extra = mix && mix.avg != null && mix.answered
    ? ` · media ${num(mix.avg).toFixed(1)}`
    : (mix && mix.avgPicked != null && mix.answered ? ` · ${num(mix.avgPicked).toFixed(1)} a testa` : '');
  const rows = empty ? [] : mix.rows.filter((r) => keepEmpty || r.picked > 0);
  return `
    <div class="panel ${span}">
      <div class="panel-head"><div><h2>${esc(title)}</h2><p class="hint">${empty ? hint : `${int(mix.answered)} risposte${extra}`}</p></div></div>
      ${empty
        ? '<p class="empty">Nessuna risposta ancora.</p>'
        : bars(rows.map((r) => ({
          label: quizChoiceLabel(group, r.id),
          n: r.picked,
          value: int(r.picked),
          sub: paidSub(r),
          color: r.picked ? '' : 'grey',
        })), { max: mix.answered })}
    </div>`;
}

function renderQuizChoices() {
  const box = $('quizChoices');
  if (!box) return;
  const q = data.quizChoices || {};
  box.innerHTML = [
    choicePanel('Hai già provato', 'dalla slide “Have you tried eating plant-based?”', q.tried, 'tried', 'c4'),
    choicePanel('Per chi cucina', 'dalla slide “Who do you cook for?”', q.household, 'household', 'c4'),
    choicePanel('Sere plant-based', 'quante notti a settimana, da 1 a 7', q.nights, 'nights', 'c4', true),
    choicePanel('Tempo a cena', 'dalla slide “How long do you want dinner to take?”', q.time, 'time', 'c4'),
    choicePanel('Altre app', 'dalla slide “Have you used another app for this?”', q.apps, 'apps', 'c4'),
    choicePanel('Chi è Vego', 'dalla slide “Who is Vego for”', q.audience, 'audience', 'c4'),
    choicePanel('Perché', 'scelta multipla: salute, animali, pianeta, gusto', q.why, 'why', 'c6'),
    choicePanel('Cucine preferite', 'si chiede, non va all’AI', q.cuisines, 'cuisines', 'c6'),
    choicePanel('Cosa c’è in cucina', 'elettrodomestici della slide kitchen', q.appliances, 'appliances', 'c6'),
  ].join('');
}

/* Lo spazio fra due colonne, lo stesso che sta nel CSS. Sta qui perché
   la larghezza delle slide si calcola prima che il browser disegni. */
const MIX_GAP = 8;

let mixResizeBound = false;

/* "Tutte nello schermo": le slide rimpiccioliscono finché non entrano
   tutte, e basta — tagliate non si riconoscerebbero più. L'altezza esce
   dallo spazio che resta tolti l'asse e gli spazi, diviso per quante
   sono; oltre la dimensione piena non si va, se sono poche. */
function sizeMix() {
  const mix = $('onboardingMix');
  if (!mix) return;
  if (!mix.classList.contains('fit')) {
    mix.style.removeProperty('--shot-h');
    mix.classList.remove('tight');
    mix.classList.remove('mini');
    return;
  }
  const n = Number(mix.dataset.n) || 1;
  const axis = mix.querySelector('.axis');
  const room = mix.clientWidth - (axis ? axis.offsetWidth : 34) - MIX_GAP * n;
  const width = Math.max(22, room / n);
  const height = Math.min(width * 600 / 276, window.innerHeight * 0.36, 340);
  mix.style.setProperty('--shot-h', `${height.toFixed(1)}px`);
  // Quanto si stringe la colonna, tanto si stringe quello che ci scrivi
  // dentro, finché non resta che la percentuale.
  const col = height * 276 / 600;
  mix.classList.toggle('tight', col < 72);
  mix.classList.toggle('mini', col < 46);
}

/* La testata si riscrive a ogni render, quindi il pulsante si riattacca
   ogni volta. La scelta invece resta fra una visita e l'altra. */
function wireMixFit() {
  const mix = $('onboardingMix');
  const btn = $('mixFit');
  if (!mix || !btn) return;

  mix.classList.toggle('fit', localStorage.getItem(MIX_KEY) === '1');
  const how = $('mixHow');
  const paint = () => {
    const on = mix.classList.contains('fit');
    btn.textContent = on ? 'Dimensione piena' : 'Tutte nello schermo';
    btn.title = on
      ? 'Torna alle slide grandi: si scorre di lato'
      : 'Rimpicciolisce le slide finché ci stanno tutte';
    if (how) how.textContent = on ? '' : ' · si scorre di lato';
    sizeMix();
  };

  btn.addEventListener('click', () => {
    const on = !mix.classList.contains('fit');
    mix.classList.toggle('fit', on);
    try { localStorage.setItem(MIX_KEY, on ? '1' : '0'); } catch { /* finestra privata */ }
    paint();
  });

  if (!mixResizeBound) {
    mixResizeBound = true;
    window.addEventListener('resize', sizeMix);
  }
  paint();
}

/* La versione di onboarding che la pagina sta leggendo. Si sceglie dal
   menu in alto; la scelta resta nel browser. Senza scelta, l'ultima. */
const ONB_VERSION_KEY = 'vego-onb-version';

function onboardingVersions() {
  const ob = data.onboarding || {};
  return ob.versions || (ob.version ? { [ob.version]: ob } : {});
}

function selectedOnboardingVersion() {
  const versions = onboardingVersions();
  const saved = localStorage.getItem(ONB_VERSION_KEY);
  if (saved && versions[saved]) return saved;
  return (data.onboarding || {}).current || Object.keys(versions)[0];
}

function wireOnboardingVersion() {
  const select = $('onbVersion');
  if (!select) return;
  const versions = onboardingVersions();
  const selected = selectedOnboardingVersion();
  select.innerHTML = Object.values(versions)
    .map((v) => `<option value="${esc(v.version)}" ${v.version === selected ? 'selected' : ''}>${esc(v.label)} · ${int(v.users)} utenti</option>`)
    .join('');
  if (!select.dataset.wired) {
    select.dataset.wired = '1';
    select.addEventListener('change', () => {
      localStorage.setItem(ONB_VERSION_KEY, select.value);
      renderOnboarding();
    });
  }
}

/* Le due versioni fianco a fianco, sui due numeri che decidono:
   quanti arrivano al paywall e quanti, da lì, pagano. */
function renderOnboardingCompare(selected) {
  const box = $('onbCompare');
  if (!box) return;
  const versions = Object.values(onboardingVersions());
  box.innerHTML = versions.map((v) => {
    const pay = v.pay || {};
    const isOn = v.version === selected;
    return `
      <div class="panel c6${isOn ? ' selected' : ''}">
        <div class="panel-head"><div><h2>${esc(v.label)}</h2><p class="hint">${int(v.users)} utenti · ${int(v.started)} hanno visto la prima slide</p></div>${isOn ? '<span class="stamp">in lettura</span>' : ''}</div>
        <div class="stats-row">
          ${stat({ label: 'Al paywall', value: v.started ? share(pay.pctPaywall) : '—', sub: `${int(v.completed)} su ${int(v.started)}`, tone: 'good', help: 'Di chi ha visto la prima slide, quanti sono arrivati in fondo all’onboarding, dove parte il paywall.' })}
          ${stat({ label: 'Pagano dopo il paywall', value: v.completed ? share(pay.pctPaidOfPaywall) : '—', sub: `${int(pay.paidOfCompleted)} su ${int(v.completed)}`, tone: pay.pctPaidOfPaywall > 0 ? 'good' : '', help: 'Di chi è arrivato al paywall con questa versione, quanti hanno poi pagato almeno una volta.' })}
          ${stat({ label: 'Pagano, dall’inizio', value: v.started ? share(pay.pctPaidOfStarted) : '—', sub: `${int(pay.paid)} paganti`, help: 'Paganti su tutti quelli che hanno iniziato questa versione: il numero che somma i due passaggi.' })}
        </div>
      </div>`;
  }).join('');
}

function renderOnboarding() {
  renderBlockers();
  renderQuizChoices();
  wireOnboardingVersion();
  const selected = selectedOnboardingVersion();
  const fun = onboardingVersions()[selected];
  if (!fun) return;
  renderOnboardingCompare(selected);
  const steps = fun.steps;
  const last = steps[steps.length - 1];
  const worst = worstStep(steps);
  const started = fun.started;
  const quiz = fun.quiz;
  const pay = fun.pay || {};
  const skipBase = Math.max(quiz.introReached || 0, quiz.skipped || 0);
  const f = (data.insights || {}).funnel || {};

  $('onboardingHero').innerHTML = heroRow(
    hero({ label: 'Dalla prima slide al paywall', value: started ? share(last.pctOfStart) : '—', tone: 'good',
      sub: `${int(fun.completed)} su ${int(started)} hanno visto la prima slide e poi il paywall · ${esc(fun.label)}`,
      help: 'Di chi ha visto la prima slide di questa versione, quanti sono arrivati alla fine dell’onboarding, dove parte il paywall.' }),
    [
      stat({ label: 'Hanno iniziato', value: int(started), sub: `${int(f.started)} in tutte le versioni · ${int(f.accounts)} arrivati`, help: 'Utenti con almeno uno step di questa versione tracciato.' }),
      stat({ label: 'Pagano dopo il paywall', value: fun.completed ? share(pay.pctPaidOfPaywall) : '—', sub: `${int(pay.paidOfCompleted)} su ${int(fun.completed)} al paywall`, tone: pay.pctPaidOfPaywall > 0 ? 'good' : '', help: 'Di chi è arrivato al paywall con questa versione, quanti hanno pagato almeno una volta.' }),
      stat({ label: 'Quiz saltato', value: skipBase ? share(quiz.pctSkipped) : '—', sub: `${int(quiz.skipped)} su ${int(skipBase)} al quiz`, tone: quiz.pctSkipped > 0.35 ? 'bad' : '', help: 'Chi ha premuto “salta”, su chi è arrivato alla prima schermata del quiz.' }),
      stat({ label: 'Peggior slide', value: worst && worst.dropped ? `<span style="font-size:17px">${esc(worst.label)}</span>` : '—',
        sub: worst && worst.dropped ? `${share(worst.pctContinued)} avanti · ${int(worst.dropped)} escono` : 'ancora poco traffico', tone: worst && worst.dropped ? 'warn' : '' }),
    ],
  );

  $('onboardingMixHead').innerHTML = `
    <div><h2>Tutto il percorso · ${esc(fun.label)}</h2><p class="hint">${steps.length} slide · la % è chi, arrivato lì, è andato alla successiva<span id="mixHow"></span></p></div>
    <div class="right"><button class="btn small" id="mixFit" type="button"></button><span class="big">${started ? share(last.pctOfStart) : '—'}</span><span class="dim" style="font-size:12px">al paywall</span></div>`;

  $('onboardingNote').innerHTML = started
    ? (worst && worst.dropped
      ? `Converte peggio <strong>“${esc(worst.label)}”</strong>: ${share(worst.pctContinued)} va avanti (${int(worst.continued)} su ${int(worst.reached)}), ${int(worst.dropped)} escono.`
      : 'Ogni slide converte ancora al 100%: troppi pochi passaggi per dire dove si inceppa.')
    : 'Ancora nessun passaggio registrato.';

  const ticks = [100, 75, 50, 25, 0].map((v) => `<span style="bottom:${v}%">${v}%</span>`).join('');
  const cols = steps.map((step) => {
    const isLast = step.index === steps.length - 1;
    const isWorst = worst && step.index === worst.index && worst.dropped;
    const height = started ? (step.pctOfStart * 100).toFixed(2) : 0;
    const chipPct = isLast ? (started ? share(step.pctOfStart) : '—') : (started ? share(step.pctContinued) : '—');
    const chipN = isLast ? `${int(step.reached)} al paywall` : `${int(step.continued)}/${int(step.reached)}`;
    return `
      <div class="mix-col" title="${esc(step.caption)}">
        <div class="mix-shot"><img src="/${step.shot}" alt="${esc(step.label)}" loading="lazy"></div>
        <div class="mix-chip"><div class="pct${!isLast && isWorst ? ' drop' : ''}">${chipPct}</div><div class="n">${chipN}</div></div>
        <div class="mix-track"><div class="mix-fill${isWorst ? ' worst' : ''}" style="height:${height}%"></div></div>
        <div class="mix-name"><span class="i">${step.index + 1}.</span> <span class="l">${esc(step.label)}</span></div>
        <div class="mix-drop">${isLast || !step.dropped ? '' : `−${int(step.dropped)}`}</div>
      </div>`;
  }).join('');
  const mix = $('onboardingMix');
  mix.innerHTML = `<div class="mix-col axis"><div class="mix-shot"></div><div class="mix-chip"></div><div class="mix-track labels">${ticks}</div><div class="mix-name"></div><div class="mix-drop"></div></div>${cols}`;
  mix.dataset.n = steps.length;
  bindShotFallback(mix);
  wireMixFit();

  const list = $('onboardingSteps');
  list.innerHTML = steps.map((step) => {
    const isLast = step.index === steps.length - 1;
    const isWorst = worst && step.index === worst.index && worst.dropped;
    const ofStart = started ? (step.pctOfStart * 100).toFixed(1) : 0;
    const stats = isLast
      ? `<div><div class="n">${started ? share(step.pctOfStart) : '—'}</div><div class="l">dalla slide 1</div></div>
         <div><div class="n">${int(step.reached)}</div><div class="l">al paywall</div></div>`
      : `<div><div class="n${isWorst ? ' drop' : ''}">${started ? share(step.pctContinued) : '—'}</div><div class="l">avanti</div></div>
         <div><div class="n${step.dropped ? ' drop' : ''}">${int(step.dropped)}</div><div class="l">escono</div></div>
         <div><div class="n">${int(step.reached)}</div><div class="l">arrivati</div></div>`;
    return `
      <article class="step">
        <div class="phone"><img src="/${step.shot}" alt="${esc(step.label)}" loading="lazy"></div>
        <div>
          <p class="idx">Slide ${step.index + 1} di ${steps.length}</p>
          <h3>${esc(step.label)}</h3>
          <p class="caption">${esc(step.caption || '')}</p>
          <div class="step-stats">${stats}</div>
          <div class="bar-line"><span class="${isWorst ? 'worst' : ''}" style="width:${ofStart}%"></span></div>
        </div>
      </article>`;
  }).join('');
  bindShotFallback(list);
}

/* ------------------------------------------------------------------ */
/* Costi AI                                                            */
/* ------------------------------------------------------------------ */

const PER_MONTH = { day: 30, week: 4.33, month: 1 };
const FREQ_LABEL = { day: 'al giorno', week: 'a settimana', month: 'al mese' };

function loadEstimate() {
  try {
    return { freq: 'day', users: 1, calls: {}, unit: {}, ...JSON.parse(localStorage.getItem(EST_KEY) || '{}') };
  } catch { return { freq: 'day', users: 1, calls: {}, unit: {} }; }
}

function saveEstimate(next) {
  localStorage.setItem(EST_KEY, JSON.stringify(next));
}

function renderEstimate() {
  const est = loadEstimate();
  const feats = data.mainFeatures || [];
  if (!feats.length || !$('estimateInputs')) return;

  const unitOf = (f) => (est.unit[f.id] === undefined || est.unit[f.id] === '' ? f.costPerCall : num(est.unit[f.id]));
  const callsOf = (f) => num(est.calls[f.id]);
  const users = Math.max(1, num(est.users) || 1);
  const perMonth = PER_MONTH[est.freq] || PER_MONTH.day;

  const rows = feats.map((f) => ({ id: f.id, label: f.label, calls: callsOf(f), unit: unitOf(f), month: callsOf(f) * perMonth * unitOf(f) * users }));
  const month = rows.reduce((s, r) => s + r.month, 0);
  const totals = { week: month / 4.33, month, year: month * 12 };

  $('estimateHint').textContent = `costo unitario osservato come segnaposto · ${int(feats.length)} feature`;
  $('estimateScale').textContent = users > 1 ? `per ${int(users)} utenti` : 'per un utente';

  $('estimateInputs').innerHTML = `
    <div class="field"><label>Le chiamate che scrivo sono</label>
      <select id="estFreq">${Object.entries(FREQ_LABEL).map(([k, label]) => `<option value="${k}" ${est.freq === k ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
    <div class="field"><label>Moltiplica per quanti utenti</label><div class="in"><input type="number" min="1" step="1" id="estUsers" value="${users}"><span>utenti</span></div></div>
    <div class="foot"><span>Salvato nel browser.</span><button class="btn small" id="estReset" type="button">Azzera</button></div>`;

  $('estimateTable').innerHTML = `
    <thead><tr><th>Feature</th><th>Chiamate ${FREQ_LABEL[est.freq]}</th><th>Costo / chiamata</th><th>Al mese</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td class="strong">${esc(r.label)}</td>
      <td><input type="number" min="0" step="1" data-calls="${r.id}" value="${est.calls[r.id] ?? ''}" placeholder="0" style="width:90px"></td>
      <td><input type="number" min="0" step="0.0001" data-unit="${r.id}" value="${est.unit[r.id] ?? ''}" placeholder="${r.unit ? r.unit.toFixed(4) : '0'}" style="width:110px"></td>
      <td class="${r.month ? 'strong' : 'dim'}">${usd(r.month)}</td>
    </tr>`).join('')}</tbody>`;

  $('estimateTotals').innerHTML = [
    stat({ label: 'A settimana', value: usd(totals.week) }),
    stat({ label: 'Al mese', value: usd(totals.month), tone: 'good' }),
    stat({ label: 'All’anno', value: usd(totals.year) }),
  ].join('');

  const used = rows.filter((r) => r.month > 0);
  if (!used.length) chartEmpty('estimateChart', 'Scrivi quante chiamate prevedi: il grafico si riempie da solo');
  else chart('estimateChart', {
    type: 'bar',
    plugins: [barValues((v) => usd(v))],
    data: { labels: used.map((r) => r.label), datasets: [{ data: used.map((r) => r.month), backgroundColor: C.green }] },
    options: {
      indexAxis: 'y',
      layout: { padding: { right: 56 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${usd(ctx.raw)} al mese` } } },
      scales: { x: moneyTicks, y: noGrid },
    },
  });

  const update = (patch) => { saveEstimate({ ...loadEstimate(), ...patch }); renderEstimate(); };
  $('estFreq').addEventListener('change', (e) => update({ freq: e.target.value }));
  $('estUsers').addEventListener('change', (e) => update({ users: num(e.target.value) }));
  $('estReset').addEventListener('click', () => { localStorage.removeItem(EST_KEY); renderEstimate(); });
  // `change` e non `input`: ridisegnando a ogni tasto il campo perde il fuoco.
  $('estimateTable').querySelectorAll('input[data-calls]').forEach((el) => {
    el.addEventListener('change', () => update({ calls: { ...loadEstimate().calls, [el.dataset.calls]: el.value === '' ? '' : num(el.value) } }));
  });
  $('estimateTable').querySelectorAll('input[data-unit]').forEach((el) => {
    el.addEventListener('change', () => update({ unit: { ...loadEstimate().unit, [el.dataset.unit]: el.value === '' ? '' : num(el.value) } }));
  });
}

function renderProduct() {
  const i = data.insights || {};
  const c = i.cost || {};
  const f = i.funnel || {};
  const sp = data.spaces || {};
  const feats = data.mainFeatures || [];
  const mix = data.featureMix || { users: 0, rows: [] };
  const days = lastDays(30);
  const withCalls = feats.filter((x) => x.calls > 0);
  const totalCalls = feats.reduce((s, x) => s + x.calls, 0);

  $('productHero').innerHTML = heroRow(
    hero({ label: 'Costo medio per chiamata', value: usd(totalCalls ? c.total / totalCalls : 0), sub: `${int(totalCalls)} chiamate · ${usd(c.total)} in tutto`,
      help: 'Spesa AI totale divisa per tutte le chiamate registrate nelle macro-feature.' }),
    [
      stat({ label: 'Costo medio per job', value: usd(c.perJob), sub: `${int(c.jobs)} job`, help: 'Un job è una generazione AI completa. Una chiamata può non farne partire nessuno.' }),
      stat({ label: 'Spesa · 30 giorni', value: usd(c.usd30), sub: 'Gemini, immagini, RapidAPI' }),
      stat({ label: 'Spesa totale', value: usd(c.total), sub: 'nella finestra' }),
      stat({ label: 'Job falliti', value: c.jobs ? share(c.errorRate) : '—', sub: `${int(c.jobsFailed)} su ${int(c.jobs)}`, tone: c.errorRate > 0.05 ? 'bad' : (c.jobs ? 'good' : ''), help: 'Sopra il 5% c’è qualcosa che si rompe.' }),
    ],
  );

  chart('costPerCallChart', {
    type: 'bar',
    plugins: [barValues((v) => usd(v))],
    data: { labels: withCalls.map((x) => x.label), datasets: [{ data: withCalls.map((x) => x.costPerCall), backgroundColor: C.green }] },
    options: {
      indexAxis: 'y',
      layout: { padding: { right: 56 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${usd(ctx.raw)} · ${int(withCalls[ctx.dataIndex].calls)} chiamate` } } },
      scales: { x: moneyTicks, y: noGrid },
    },
  });

  // Media del giorno, non media delle medie: i giorni senza job restano
  // vuoti invece di valere zero e tirare giù la linea.
  chart('costPerJobDaily', {
    type: 'line',
    data: {
      labels: days.map((d) => shortDay(d.day)),
      datasets: [{ data: days.map((d) => (d.jobs ? d.usd / d.jobs : null)), borderColor: C.green, backgroundColor: C.greenSoft, fill: true, tension: .3, spanGaps: true, pointRadius: 2, pointBackgroundColor: C.green, borderWidth: 2 }],
    },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => usd(ctx.raw) } } }, scales: { x: noGrid, y: moneyTicks } },
  });

  $('featureCostHint').textContent = `${usd(c.total)} in tutto`;
  const byCost = [...feats].sort((a, b) => b.usd - a.usd);
  chart('featureCostChart', {
    type: 'bar',
    plugins: [barValues((v) => usd(v))],
    data: { labels: byCost.map((x) => x.label), datasets: [{ data: byCost.map((x) => x.usd), backgroundColor: C.green }] },
    options: {
      indexAxis: 'y',
      layout: { padding: { right: 56 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${usd(ctx.raw)} · ${pct(ctx.raw, c.total, 0)} del totale` } } },
      scales: { x: moneyTicks, y: noGrid },
    },
  });

  $('featureMixHint').textContent = mix.users ? `media su ${int(mix.users)} utenti che hanno usato almeno una feature` : 'nessuno ha ancora usato una feature';
  chart('featureMixChart', {
    type: 'bar',
    plugins: [barValues((v) => `${v.toFixed(0)}%`)],
    data: { labels: mix.rows.map((r) => r.label), datasets: [{ data: mix.rows.map((r) => r.avgShare * 100), backgroundColor: C.blue }] },
    options: {
      indexAxis: 'y',
      layout: { padding: { right: 44 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.raw.toFixed(0)}% dell’uso medio · la toccano ${int(mix.rows[ctx.dataIndex].users)} utenti` } } },
      scales: { x: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } }, y: noGrid },
    },
  });

  const maxCost = Math.max(...feats.map((x) => x.usd), 0.0001);
  $('featureTable').innerHTML = `
    <thead><tr><th>Feature</th><th>Chiamate</th><th>% chiamate</th><th>Costo</th><th>Costo / chiamata</th><th>Mix medio</th><th>Job AI</th><th>Errori</th></tr></thead>
    <tbody>${feats.map((x) => {
      const row = mix.rows.find((r) => r.id === x.id);
      return `<tr>
      <td class="strong">${esc(x.label)}</td><td>${int(x.calls)}</td><td class="dim">${pct(x.calls, totalCalls, 0)}</td>
      <td><span class="cellbar"><span style="width:${((x.usd / maxCost) * 100).toFixed(1)}%"></span></span>${usd(x.usd)}</td>
      <td class="strong">${x.calls ? usd(x.costPerCall) : '—'}</td>
      <td class="dim">${row ? share(row.avgShare, 0) : '—'}</td>
      <td>${int(x.jobs)}</td>
      <td>${x.errors ? `<span class="pill red">${int(x.errors)}</span>` : '<span class="dim">—</span>'}</td>
    </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">Nessuna feature usata.</td></tr>'}</tbody>`;

  $('productFunnel').innerHTML = bars([
    { label: 'Arrivati', n: f.accounts, color: 'grey' },
    { label: 'Onboarding iniziato', n: f.started, sub: pct(f.started, f.accounts, 0) },
    { label: 'Paywall visto', n: f.completed, sub: pct(f.completed, f.accounts, 0) },
    { label: 'Prodotto usato', n: f.activated, sub: pct(f.activated, f.accounts, 0) },
    { label: 'Paganti', n: f.paid, sub: pct(f.paid, f.accounts, 0), color: 'blue' },
  ], { max: f.accounts });

  $('spacesStats').innerHTML = bars([
    { label: 'Utenti in uno spazio', n: sp.usersWithSpace, sub: pct(sp.usersWithSpace, f.accounts, 0) },
    { label: 'Spazi live', n: sp.liveSpaces },
    { label: 'Creati (a vita)', n: sp.created, color: 'grey' },
    { label: 'Entrati con codice', n: sp.joined, color: 'blue' },
    { label: 'Usciti', n: sp.left, color: 'red' },
  ]);

  renderEstimate();
}

/* ------------------------------------------------------------------ */
/* Utenti                                                              */
/* ------------------------------------------------------------------ */

const USER_FILTERS = [
  { id: 'all', label: 'Tutti', fn: () => true },
  { id: 'paid', label: 'Paganti', fn: (u) => u.hasPaid },
  { id: 'trial', label: 'In trial', fn: (u) => !u.hasPaid && u.subscription === 'active' && u.lastSubEvent === 'trial_start' },
  { id: 'lapsed', label: 'Scaduti', fn: (u) => u.subscription === 'inactive' },
  // Il tipo di accesso non è una colonna: il sign-in Apple si chiede
  // subito dopo l'acquisto, quindi "con Apple" è la lista dei paganti
  // scritta in un altro modo. Resta solo l'anomalia: qui non dovrebbe
  // esserci nessuno, e chi c'è è un pagamento che non abbiamo registrato.
  { id: 'appleUnpaid', label: 'Apple senza pagamento', fn: (u) => u.authKind === 'apple' && !u.hasPaid },
  { id: 'active7', label: 'Attivi 7gg', fn: (u) => u.lastDay && Date.now() - Date.parse(u.lastDay) < 7 * 86400000 },
  { id: 'activated', label: 'Hanno usato Vego', fn: (u) => u.activated },
  { id: 'onboarded', label: 'Onboarding finito', fn: (u) => u.onboarded },
  { id: 'ghost', label: 'Mai usato il prodotto', fn: (u) => !u.activated },
  { id: 'spenders', label: 'Costano più di $1', fn: (u) => u.usd > 1 },
  { id: 'shared', label: 'In uno spazio', fn: (u) => u.spaces > 0 },
  { id: 'blockers', label: 'Hanno scelto i blocchi', fn: (u) => (u.blockers || []).length > 0 },
];

const USER_COLUMNS = [
  { key: 'name', label: 'Utente', cell: (u) => (u.name ? esc(u.name) : `<span class="mono">${esc(u.uid.slice(0, 12))}…</span>`) },
  { key: 'hasPaid', label: 'Stato', cell: statusPill },
  { key: 'activated', label: 'Prodotto', cell: (u) => (u.activated ? '<span class="pill green">usato</span>' : '<span class="pill">mai</span>') },
  { key: 'onboarded', label: 'Onboarding', cell: (u) => (u.onboarded ? '<span class="pill green">fatto</span>' : '<span class="pill">no</span>') },
  { key: 'diet', label: 'Dieta', cell: (u) => (u.diet ? esc(dietLabel(u.diet)) : '<span class="dim">—</span>') },
  { key: 'referral', label: 'Canale', cell: (u) => (u.referral ? esc(sourceLabel(u.referral)) : '<span class="dim">—</span>') },
  { key: 'activeDays', label: 'Giorni attivi', cell: (u) => int(u.activeDays) },
  { key: 'jobs', label: 'Job', cell: (u) => int(u.jobs) },
  { key: 'usd30', label: 'Costo 30gg', cell: (u) => usd(u.usd30) },
  { key: 'usd', label: 'Costo a vita', cell: (u) => usd(u.usd) },
  { key: 'firstDay', label: 'Primo giorno', cell: (u) => u.firstDay || '<span class="dim">—</span>' },
  { key: 'lastDay', label: 'Ultimo giorno', cell: (u) => u.lastDay || '<span class="dim">—</span>' },
];

const userState = { filter: 'all', query: '', sortKey: 'usd', asc: false };

function userStatusWord(u) {
  if (u.hasPaid) return 'pagante';
  if (u.subscription === 'active' && u.lastSubEvent === 'trial_start') return 'trial';
  if (u.subscription === 'active') return 'attivo';
  if (u.subscription === 'inactive') return 'scaduto';
  return 'free';
}

/* I campi su cui si può cercare con `campo:valore`. Un termine senza
   due punti cerca ovunque. */
const SEARCH_FIELDS = {
  nome: (u) => u.name,
  uid: (u) => u.uid,
  dieta: (u) => u.diet,
  diet: (u) => u.diet,
  canale: (u) => u.referral,
  referral: (u) => u.referral,
  lingua: (u) => u.language,
  stato: userStatusWord,
  blocco: (u) => (u.blockers || []).join(' '),
  prodotto: (u) => u.productId,
  audience: (u) => u.audiencePick,
  provato: (u) => u.tried,
  tavola: (u) => u.cookingFor,
};

function userMatches(u, query) {
  if (!query) return true;
  return query.split(/\s+/).filter(Boolean).every((term) => {
    const [head, ...rest] = term.split(':');
    const value = rest.join(':');
    if (value && SEARCH_FIELDS[head]) return String(SEARCH_FIELDS[head](u) || '').toLowerCase().includes(value);
    return Object.values(SEARCH_FIELDS).some((get) => String(get(u) || '').toLowerCase().includes(term));
  });
}

/* Una riga della scheda. Le liste diventano pill, il vuoto resta
   visibile: sapere che una domanda non ha risposta conta quanto la
   risposta. */
function kvRow(label, value) {
  let body;
  if (Array.isArray(value)) body = value.length ? `<dd>${value.map((v) => `<span class="pill">${esc(v)}</span>`).join('')}</dd>` : '<dd class="none">—</dd>';
  else if (value === null || value === undefined || value === '') body = '<dd class="none">—</dd>';
  else if (typeof value === 'boolean') body = `<dd>${value ? 'sì' : 'no'}</dd>`;
  else body = `<dd>${value}</dd>`;
  return `<dt>${esc(label)}</dt>${body}`;
}

function kvBlock(title, rows, wide) {
  const body = rows.filter(Boolean).join('');
  if (!body) return '';
  return `<div class="block ${wide ? 'wide' : ''}"><h3>${esc(title)}</h3><dl class="kv">${body}</dl></div>`;
}

function renderUserCard(payload) {
  const { doc = {}, days = [], account = {}, uid } = payload;
  const profile = doc.tasteProfile || {};
  const usage = doc.usage || {};
  const costs = usage.costs || {};
  const sub = doc.subscription || {};
  const blockers = doc.blockers || [];
  const summary = (data.users || []).find((u) => u.uid === uid) || {};

  const blockerList = blockers.length
    ? blockers.map((id, i) => `<span class="pill ${i === 0 ? 'red' : ''}">${i + 1}. ${esc(BLOCKER_LABELS[id] || id)}</span>`).join('')
    : null;

  const events = Object.entries(usage.features || {}).filter(([, n]) => num(n) > 0);
  const stepsSeen = events.filter(([name]) => name.startsWith('onboarding.step.')).length;
  const featureRows = events.filter(([name]) => !name.startsWith('onboarding.')).sort((a, b) => num(b[1]) - num(a[1]));

  openDrawer(`
    <div class="drawer-head">
      <div>
        <h2>${esc(doc.displayName || 'Senza nome')} ${summary.uid ? statusPill(summary) : ''}</h2>
        <p class="uid">${esc(uid)}</p>
      </div>
      <button class="btn ghost" type="button" data-close>Chiudi</button>
    </div>
    <div class="drawer-body">
      <div class="blocks">
        ${kvBlock('Account', [
          kvRow('Accesso', account.error ? '<span class="dim">non leggibile</span>' : (account.apple ? '<span class="pill blue">Apple</span>' : '<span class="pill">anonimo</span>')),
          account.email ? kvRow('Email', esc(account.email)) : '',
          kvRow('Provider', account.providers || null),
          kvRow('Creato', account.createdAt ? new Date(account.createdAt).toLocaleString('it-IT') : null),
          kvRow('Ultimo accesso', account.lastSignInAt ? new Date(account.lastSignInAt).toLocaleString('it-IT') : null),
          kvRow('Spazio attivo', doc.activeSpaceId ? esc(doc.activeSpaceId) : null),
        ])}
        ${kvBlock('Abbonamento', [
          kvRow('Ha pagato', Boolean(sub.hasPaid)),
          kvRow('Stato', sub.status ? esc(sub.status) : null),
          kvRow('Prodotto', sub.productId ? esc(sub.productId) : null),
          kvRow('Ultimo evento', sub.lastEvent ? esc(sub.lastEvent) : null),
          kvRow('Scadenza', sub.expiresAt ? esc(sub.expiresAt) : null),
        ])}
        ${kvBlock('Onboarding', [
          kvRow('Nome dichiarato', doc.displayName ? esc(doc.displayName) : null),
          kvRow('Come ci ha trovati', doc.referralSource ? esc(doc.referralSource) : null),
          kvRow('Chi è Vego', doc.audience ? quizChoiceLabel('audience', doc.audience) : null),
          kvRow('Cosa deve risolvere', blockerList || null),
          kvRow('Hai già provato', doc.plantBasedTried ? quizChoiceLabel('tried', doc.plantBasedTried) : null),
          kvRow('Per chi cucina', doc.cookingFor ? quizChoiceLabel('household', doc.cookingFor) : null),
          kvRow('Sere plant-based', Number.isInteger(Number(doc.plantBasedNights)) && Number(doc.plantBasedNights) >= 1
            ? `${int(doc.plantBasedNights)} a settimana` : null),
          kvRow('Tempo a cena', doc.dinnerTime ? quizChoiceLabel('time', doc.dinnerTime) : null),
          kvRow('Perché', labeledChoices(doc.whyPlantBased, 'why')),
          kvRow('Altre app', doc.triedOtherApps ? quizChoiceLabel('apps', doc.triedOtherApps) : null),
          kvRow('Slide viste', stepsSeen ? `${int(stepsSeen)} su ${int(((data.onboarding || {}).steps || []).length)}` : null),
          kvRow('Arrivato in fondo', Boolean(num((usage.features || {})['onboarding.complete']))),
          kvRow('Quiz saltato', Boolean(num((usage.features || {})['onboarding.quiz.skip']))),
        ])}
        ${kvBlock('Uso e costi', [
          kvRow('Job AI', `${int(usage.jobs)}${num(usage.jobsFailed) ? ` · ${int(usage.jobsFailed)} falliti` : ''}`),
          kvRow('Costo a vita', usd(costs.totalUsd)),
          kvRow('Gemini', usd(costs.geminiUsd)),
          kvRow('Immagini', usd(costs.falUsd)),
          kvRow('RapidAPI', usd(costs.rapidUsd)),
          kvRow('Giorni con attività', int(days.length)),
        ])}
        ${kvBlock('Profilo di gusto', [
          kvRow('Dieta', profile.dietaryIdentity ? esc(profile.dietaryIdentity) : null),
          kvRow('Esclusioni', profile.exclusions || null),
          kvRow('Cucine preferite', doc.favoriteCuisines && doc.favoriteCuisines.length ? doc.favoriteCuisines : (profile.cuisineAffinities || null)),
          kvRow('Piccantezza', profile.spiceTolerance ? esc(profile.spiceTolerance) : null),
          kvRow('Sforzo in cucina', profile.effortTolerance ? esc(profile.effortTolerance) : null),
          kvRow('Piatti amati', profile.lovedDishes || profile.likedDishes || null),
          kvRow('Piatti neutri', profile.neutralDishes || null),
          kvRow('Piatti scartati', profile.dislikedDishes || null),
          kvRow('Elettrodomestici', labeledChoices(doc.kitchenAppliances, 'appliances') || profile.appliances || null),
          kvRow('Lingua', profile.language ? esc(profile.language) : null),
          kvRow('Unità', profile.units ? esc(profile.units) : null),
          kvRow('Valuta', profile.currency ? esc(profile.currency) : null),
        ], true)}
        ${kvBlock('Eventi registrati', [
          featureRows.length
            ? `<dd style="grid-column:1/-1">${featureRows.map(([name, n]) => `<span class="pill">${esc(name)} · ${int(n)}</span>`).join('')}</dd>`
            : kvRow('Eventi', null),
        ], true)}
      </div>

      ${days.length ? `
      <details open>
        <summary>Ultimi giorni (${int(days.length)})</summary>
        <div class="scroll" style="margin-top:10px"><table class="tbl">
          <thead><tr><th>Giorno</th><th>Job</th><th>Costo</th><th>Eventi</th></tr></thead>
          <tbody>${days.slice(0, 20).map((d) => `<tr>
            <td>${esc(d.day)}</td>
            <td>${int(d.jobs)}</td>
            <td>${usd((d.costs || {}).totalUsd)}</td>
            <td class="dim" style="white-space:normal;text-align:left">${esc(Object.entries(d.features || {}).map(([k, v]) => `${k}×${v}`).join(', ') || '—')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </details>` : ''}

      <details>
        <summary>Documento Firestore completo</summary>
        <pre>${esc(JSON.stringify(doc, null, 2))}</pre>
      </details>
    </div>`);
}

async function openUser(uid) {
  if (!uid) return;
  openDrawer(`<div class="drawer-head"><div><h2>Leggo Firestore…</h2><p class="uid">${esc(uid)}</p></div><button class="btn ghost" type="button" data-close>Chiudi</button></div>`);
  try {
    const response = await fetch(`/api/user/${encodeURIComponent(uid)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || response.statusText);
    renderUserCard(payload);
  } catch (error) {
    openDrawer(`<div class="drawer-head"><div><h2>Non riesco a leggerlo</h2><p class="uid">${esc(uid)}</p></div><button class="btn ghost" type="button" data-close>Chiudi</button></div><div class="drawer-body"><p class="dim">${esc(error.message)}</p></div>`);
  }
}

function renderUsers() {
  const table = $('userTable');
  if (!table) return;

  if (!table.dataset.bound) {
    table.dataset.bound = '1';
    const params = new URLSearchParams(location.search);
    const wanted = params.get('uid');
    if (wanted) openUser(wanted);
    const f = params.get('f');
    if (f && USER_FILTERS.some((x) => x.id === f)) userState.filter = f;
    const q = params.get('q');
    if (q) { userState.query = q.toLowerCase(); $('userSearch').value = q; }
  }

  $('userFilters').innerHTML = USER_FILTERS.map((f) => {
    const n = data.users.filter(f.fn).length;
    return `<button class="chip ${userState.filter === f.id ? 'on' : ''}" data-f="${f.id}" type="button">${f.label}<small>${int(n)}</small></button>`;
  }).join('');
  $('userFilters').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { userState.filter = b.dataset.f; renderUsers(); }));

  const search = $('userSearch');
  if (!search.dataset.bound) {
    search.dataset.bound = '1';
    search.addEventListener('input', () => { userState.query = search.value.trim().toLowerCase(); renderUsers(); });
  }

  const filter = USER_FILTERS.find((f) => f.id === userState.filter) || USER_FILTERS[0];
  const rows = data.users
    .filter(filter.fn)
    .filter((u) => userMatches(u, userState.query))
    .sort((a, b) => {
      const x = a[userState.sortKey];
      const y = b[userState.sortKey];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      let cmp;
      if (typeof x === 'boolean') cmp = (x ? 1 : 0) - (y ? 1 : 0);
      else if (typeof x === 'number') cmp = x - y;
      else cmp = String(x).localeCompare(String(y));
      return userState.asc ? cmp : -cmp;
    });

  $('userCount').textContent = `${int(rows.length)} ${rows.length === 1 ? 'utente' : 'utenti'}`;

  table.innerHTML = `
    <thead><tr>${USER_COLUMNS.map((c) => `<th data-key="${c.key}" class="sortable ${userState.sortKey === c.key ? 'on' : ''}">${c.label}${userState.sortKey === c.key ? (userState.asc ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((u) => `<tr class="click" data-uid="${esc(u.uid)}">${USER_COLUMNS.map((c) => `<td>${c.cell(u)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${USER_COLUMNS.length}" class="empty">Nessun utente con questo filtro.</td></tr>`}</tbody>`;

  table.querySelectorAll('tbody tr[data-uid]').forEach((tr) => tr.addEventListener('click', () => openUser(tr.dataset.uid)));
  table.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (userState.sortKey === key) userState.asc = !userState.asc;
    else { userState.sortKey = key; userState.asc = false; }
    renderUsers();
  }));
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const RENDERERS = { today: renderToday, money: renderMoney, people: renderPeople, onboarding: renderOnboarding, product: renderProduct, users: renderUsers };

function apply(payload) {
  data = payload;
  const at = new Date(data.generatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const stamp = $('stamp');
  if (stamp) stamp.textContent = `aggiornato ${at}`;
  renderWindow();
  renderSidebar();
  $('state').hidden = true;
  $('main').hidden = false;
  const render = RENDERERS[PAGE];
  if (render) render();
}

function readCache() {
  try {
    const { payload, at } = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null') || {};
    return payload && Date.now() - at < CACHE_MS ? payload : null;
  } catch { return null; }
}

function writeCache(payload) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ payload, at: Date.now() })); } catch { /* quota */ }
}

async function load({ force } = {}) {
  const button = $('refresh');
  const state = $('state');
  if (button) button.disabled = true;
  if (!force) {
    const cached = readCache();
    if (cached) { apply(cached); if (button) button.disabled = false; return; }
  }
  try {
    const response = await fetch('/api/data');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || response.statusText);
    writeCache(payload);
    apply(payload);
  } catch (error) {
    state.hidden = false;
    state.className = 'state error';
    state.textContent = `Non riesco a leggere i dati: ${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

/* Interruttori dell'app (pagina Onboarding): un clic scrive su
   Firestore, l'app li legge da /config al prossimo avvio. */
async function wireAppSwitches() {
  const button = $('reviewPromptToggle');
  if (!button) return;
  const paint = (on) => {
    button.textContent = on ? 'Accesa · spegni' : 'Spenta · accendi';
    button.classList.toggle('primary', on);
    button.dataset.on = on ? '1' : '';
    button.disabled = false;
  };
  try {
    const res = await fetch('/api/app-config');
    const cfg = await res.json();
    if (!res.ok) throw new Error(cfg.error || res.statusText);
    paint(cfg.onboardingReviewPrompt);
  } catch (error) {
    button.textContent = `Non leggibile: ${error.message}`;
    return;
  }
  button.addEventListener('click', async () => {
    const next = !button.dataset.on;
    button.disabled = true;
    try {
      const res = await fetch('/api/app-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingReviewPrompt: next }),
      });
      const cfg = await res.json();
      if (!res.ok) throw new Error(cfg.error || res.statusText);
      paint(cfg.onboardingReviewPrompt);
    } catch (error) {
      button.textContent = `Non salvato: ${error.message}`;
      button.disabled = false;
    }
  });
}

renderSidebar();
wireDrawer();
if (PAGE === 'onboarding') wireAppSwitches();
// Contabilità ha i suoi dati e il suo script: da qui prende solo la
// sidebar e il tema, non l'aggregazione di tutti gli utenti.
if (PAGE !== 'ledger' && PAGE !== 'catalog') {
  const refreshBtn = $('refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => load({ force: true }));
  load();
}
