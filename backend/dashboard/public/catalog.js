/* Ricettario: le ricette condivise dal vivo. Usa da app.js la sidebar,
   il tema, `$`, `esc` e il drawer. Tutto chiuso in una funzione: i
   nomi di app.js (pct, money…) restano i suoi. */
(() => {
const RC = {
  tab: 'ranked',
  rows: [],
  stats: null,
  mean: 0.4,
  params: null,
  timer: null,
};

const DIET_LABEL = { vegan: 'vegana', vegetarian: 'vegetariana', pescatarian: 'pescetariana' };
const DIET_PILL = { vegan: 'green', vegetarian: 'amber', pescatarian: 'blue' };
const STATUS_LABEL = {
  ranked: 'in classifica', candidate: 'candidata', reviewing: 'al critico', seed_review: 'da approvare',
  rejected: 'scartata', retired: 'ritirata', expired: 'scaduta',
};
const OUTCOME_LABEL = { kept: 'tenuta', passed: 'scartata', unseen: 'non vista', forced: 'fuori budget', gone: 'run sparita' };
const TILES = ['Italian', 'Mexican', 'Japanese', 'Greek', 'Thai', 'Indian', 'American', 'Chinese', 'Middle Eastern', 'Korean', 'Fresh & light'];
function tileName(t) { return t; }
function pct(v) { return v == null ? '–' : `${Math.round(v * 100)}%`; }
function n(v) { return Number(v || 0).toLocaleString('it-IT'); }
function money(v) { return `$${Number(v || 0).toFixed(2)}`; }
function ago(ms) {
  if (!ms) return '–';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'ora';
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h fa`;
  return `${Math.round(h / 24)} g fa`;
}

async function api(path, options = {}) {
  const response = await fetch(`/api/catalog${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

/* ------------------------------------------------------------------ */
/* Dati                                                                */
/* ------------------------------------------------------------------ */

async function loadAll() {
  const btn = $('refresh');
  btn.disabled = true;
  try {
    const [list, stats] = await Promise.all([api('/list'), api('/stats')]);
    RC.rows = list.rows;
    RC.mean = list.mean;
    RC.stats = stats;
    $('state').hidden = true;
    $('main').hidden = false;
    $('stamp').textContent = `aggiornato ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    renderKpis();
    render();
  } catch (error) {
    $('state').hidden = false;
    $('state').className = 'state error';
    $('state').textContent = `Non riesco a leggere il ricettario: ${error.message}`;
  } finally {
    btn.disabled = false;
  }
}

function scheduleLive() {
  clearInterval(RC.timer);
  RC.timer = setInterval(() => {
    if (!$('live').checked || document.hidden) return;
    if (RC.tab === 'params') return;
    if ($('drawer').classList.contains('open')) return;
    loadAll();
  }, 20000);
}

/* ------------------------------------------------------------------ */
/* Numeri in alto                                                      */
/* ------------------------------------------------------------------ */

function renderKpis() {
  const s = RC.stats;
  const by = s.byStatus || {};
  const src = (s.exposures || {}).bySource || {};
  const rate = (x) => (x && x.kept + x.passed ? x.kept / (x.kept + x.passed) : null);
  const cells = [
    ['In classifica', n(by.ranked), `${n(s.atlasDishes)} piatti nell’atlante`],
    ['Candidate', n(by.candidate), 'scritte dall’IA, in attesa del primo like'],
    ['Da approvare', n(by.seed_review), 'ricette di partenza'],
    ['Scartate', n(by.rejected), 'dal critico o da te'],
    ['Servite', n((s.exposures || {}).total), `${n((s.exposures || {}).open)} ancora aperte`],
    ['Tenute · classifica', pct(rate(src.ranked)), `${n((src.ranked || {}).kept)} su ${n(((src.ranked || {}).kept || 0) + ((src.ranked || {}).passed || 0))} viste`],
    ['Tenute · nuove IA', pct(rate(src.ai)), `${n((src.ai || {}).kept)} su ${n(((src.ai || {}).kept || 0) + ((src.ai || {}).passed || 0))} viste`],
  ];
  $('kpis').innerHTML = cells.map(([label, value, sub]) => `
    <div class="stat"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="sub">${esc(sub)}</div></div>`).join('');
}

/* ------------------------------------------------------------------ */
/* Schede ricetta                                                      */
/* ------------------------------------------------------------------ */

function filtered() {
  const q = $('q').value.trim().toLowerCase();
  const diet = $('fDiet').value;
  const tile = $('fTile').value;
  const sort = $('fSort').value;
  let rows = RC.rows.filter((r) => (RC.tab === 'candidate' ? r.status === 'candidate' || r.status === 'reviewing' : r.status === RC.tab));
  if (q) rows = rows.filter((r) => `${r.title} ${r.dishName} ${r.dishKey}`.toLowerCase().includes(q));
  if (diet) rows = rows.filter((r) => r.diet === diet);
  if (tile) rows = rows.filter((r) => (r.tiles || []).includes(tile));
  const key = {
    score: (r) => r.score,
    views: (r) => r.stats.views,
    keepRate: (r) => (r.keepRate == null ? -1 : r.keepRate),
    stars: (r) => r.stats.stars,
    new: (r) => r.createdAt || 0,
  }[sort];
  return rows.sort((a, b) => key(b) - key(a));
}

function card(r, rank) {
  const s = r.stats;
  const img = r.imageUrl
    ? `<img src="${esc(r.imageUrl)}" alt="" loading="lazy">`
    : '<div class="rc-noimg">senza foto</div>';
  const critic = r.critic ? `<span class="pill ${r.critic.verdict === 'reject' ? 'red' : r.critic.verdict === 'fix' ? 'amber' : 'green'}">critico ${esc(r.critic.verdict)} · ${r.critic.score}/10</span>` : '';
  const retired = r.status === 'retired' && r.retiredBy === 'auto' ? `<span class="pill red">uscita da sola · ${esc(r.retiredReason || '')}</span>` : '';
  return `
    <article class="rc-card" data-id="${esc(r.id)}">
      <div class="rc-img">${img}${RC.tab === 'ranked' ? `<span class="rc-rank">#${rank}</span>` : ''}</div>
      <div class="rc-body">
        <h3>${esc(r.title)}</h3>
        <p class="rc-dish">${esc(r.dishName)}</p>
        <div class="rc-pills">
          <span class="pill ${DIET_PILL[r.diet] || ''}">${esc(DIET_LABEL[r.diet] || r.diet)}</span>
          ${(r.tiles || []).map((t) => `<span class="pill">${esc(tileName(t))}</span>`).join('')}
          ${critic}
          ${retired}
        </div>
        <div class="rc-nums">
          <div><strong>${r.score.toFixed(2)}</strong><span>punteggio</span></div>
          <div><strong>${n(s.views)}</strong><span>viste</span></div>
          <div><strong>${pct(r.keepRate)}</strong><span>tenute</span></div>
          <div><strong>${n(s.stars)}</strong><span>stelle</span></div>
          <div><strong>${n(s.reuses)}</strong><span>riusi</span></div>
        </div>
      </div>
    </article>`;
}

function render() {
  const lists = ['ranked', 'candidate', 'seed_review', 'rejected', 'retired'];
  const isList = lists.includes(RC.tab);
  $('listView').hidden = !isList;
  $('filters').hidden = !isList;
  $('coverageView').hidden = RC.tab !== 'coverage';
  $('paramsView').hidden = RC.tab !== 'params';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === RC.tab));

  if (isList) {
    const rows = filtered();
    const hints = {
      ranked: `in media il ricettario viene tenuto il ${Math.round(RC.mean * 100)}% delle volte · più viste, più il punteggio è sicuro`,
      candidate: 'scritte dall’IA per qualcuno; al primo like passano dal critico ed entrano in classifica',
      seed_review: 'ricette di partenza già passate dal critico: approvale per metterle in classifica',
      rejected: 'scartate dal critico o da te',
      retired: 'tolte dalla classifica, da te o da sole per i voti bassi: non vengono più servite · rimesse a mano, restano',
    };
    $('listHint').textContent = `${rows.length} ricette · ${hints[RC.tab]}`;
    $('grid').innerHTML = rows.length
      ? rows.map((r, i) => card(r, i + 1)).join('')
      : '<p class="dim rc-empty">Ancora niente qui.</p>';
    $('grid').querySelectorAll('.rc-card').forEach((el) => el.addEventListener('click', () => openRecipe(el.dataset.id)));
  }
  if (RC.tab === 'coverage') renderCoverage();
  if (RC.tab === 'params') renderParams();
}

/* ------------------------------------------------------------------ */
/* Dettaglio                                                           */
/* ------------------------------------------------------------------ */

function amountText(i) {
  if (i.unit === 'to_taste') return 'q.b.';
  const unit = { piece: '', g: 'g', ml: 'ml' }[i.unit];
  return `${i.amount}${unit === undefined ? ` ${i.unit}` : unit ? ` ${unit}` : ''}`;
}

function stepText(s) {
  return esc(s).replace(/\{\{\s*([qtl])\s*:\s*([^}]*)\}\}/g, (_, k, v) => `<span class="rc-token">${k === 't' ? `${v}°C` : k === 'l' ? `${v} cm` : v}</span>`);
}

async function openRecipe(id) {
  openDrawer(`<div class="drawer-head"><div><h2>Leggo la ricetta…</h2></div><button class="btn ghost" type="button" data-close>Chiudi</button></div>`);
  let r;
  try {
    r = await api(`/item/${encodeURIComponent(id)}`);
  } catch (error) {
    openDrawer(`<div class="drawer-head"><div><h2>Non riesco a leggerla</h2></div><button class="btn ghost" type="button" data-close>Chiudi</button></div><div class="drawer-body"><p class="dim">${esc(error.message)}</p></div>`);
    return;
  }
  const rec = r.recipe || {};
  const s = r.stats || {};
  const groups = s.groups || {};
  const actions = [];
  if (r.status === 'seed_review') actions.push('<button class="btn small primary" data-act="ranked">Approva</button>', '<button class="btn small" data-act="rejected">Scarta</button>');
  if (r.status === 'ranked') actions.push('<button class="btn small" data-act="retired">Ritira</button>');
  if (r.status === 'retired' || r.status === 'rejected' || r.status === 'candidate') actions.push('<button class="btn small" data-act="ranked">Metti in classifica</button>');

  const dish = r.dish;
  const sources = dish && dish.sources ? dish.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join('<br>') : '';
  const critic = r.critic
    ? `<p><span class="pill ${r.critic.verdict === 'reject' ? 'red' : r.critic.verdict === 'fix' ? 'amber' : 'green'}">${esc(r.critic.verdict)} · ${r.critic.score}/10</span></p>${(r.critic.issues || []).length ? `<ul class="rc-issues">${r.critic.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`
    : '<p class="dim">non ancora passata dal critico</p>';

  openDrawer(`
    <div class="drawer-head">
      <div><h2>${esc(rec.title)}</h2><p class="uid">${esc(STATUS_LABEL[r.status] || r.status)} · ${esc(r.dishName || r.dishKey)} · ${esc(r.id)}</p></div>
      <div class="rc-actions">${actions.join('')}<button class="btn ghost" type="button" data-close>Chiudi</button></div>
    </div>
    <div class="drawer-body">
      ${r.imageUrl ? `<img class="rc-hero" src="${esc(r.imageUrl)}" alt="">` : ''}
      <p class="rc-one">${esc(rec.oneLiner)}</p>
      <div class="rc-pills">
        <span class="pill ${DIET_PILL[r.diet] || ''}">${esc(DIET_LABEL[r.diet] || r.diet)}</span>
        ${(r.tiles || []).map((t) => `<span class="pill">${esc(tileName(t))}</span>`).join('')}
        <span class="pill">${esc(r.format)}</span><span class="pill">${esc(r.protein)}</span>
        <span class="pill">${rec.cookMinutes} min</span><span class="pill">${money(rec.costUsd)} per 2</span>
        ${(r.allergens || []).map((a) => `<span class="pill red">${esc(a)}</span>`).join('')}
      </div>

      <div class="rc-numgrid">
        <div><strong>${(r.score || 0).toFixed(2)}</strong><span>punteggio</span></div>
        <div><strong>${n(s.views)}</strong><span>viste</span></div>
        <div><strong>${n(s.keeps)}</strong><span>tenute</span></div>
        <div><strong>${n(s.passes)}</strong><span>scartate</span></div>
        <div><strong>${n(s.stars)}</strong><span>stelle</span></div>
        <div><strong>${n(s.reuses)}</strong><span>riusi</span></div>
      </div>
      <table class="tbl rc-groups">
        <thead><tr><th>Gruppo</th><th>viste</th><th>tenute</th><th>stelle</th><th>riusi</th></tr></thead>
        <tbody>${['vegan', 'vegetarian', 'pescatarian'].map((g) => {
          const x = groups[g] || {};
          return `<tr><td>utenti ${esc(DIET_LABEL[g].replace(/a$/, 'i'))}</td><td>${n(x.views)}</td><td>${n(x.keeps)}</td><td>${n(x.stars)}</td><td>${n(x.reuses)}</td></tr>`;
        }).join('')}</tbody>
      </table>

      <div class="rc-cols">
        <div>
          <h4>Ingredienti <span class="dim">per 2</span></h4>
          <ul class="rc-ings">${(rec.ingredients || []).map((i) => `<li><span>${esc(i.name)}</span><span class="dim">${esc(amountText(i))}</span></li>`).join('')}</ul>
        </div>
        <div>
          <h4>Critico</h4>
          ${critic}
          ${sources ? `<h4>Fonti del piatto</h4><p class="rc-sources">${sources}</p>` : ''}
          <h4>Lingue già tradotte</h4>
          <p>${Object.keys(r.translations || {}).map((l) => `<span class="pill">${esc(l)}</span>`).join(' ') || '<span class="dim">solo inglese</span>'}</p>
        </div>
      </div>

      <h4>Passaggi</h4>
      <ol class="rc-steps">${(rec.steps || []).map((x) => `<li>${stepText(x)}</li>`).join('')}</ol>

      <h4>Servita ${n((r.served || []).length)} volte</h4>
      <table class="tbl">
        <thead><tr><th>Quando</th><th>dieta utente</th><th>come</th><th>lingua</th><th>esito</th></tr></thead>
        <tbody>${(r.served || []).map((e) => `<tr><td>${ago(e.createdAt)}</td><td>${esc(e.userDiet || '–')}</td><td>${e.source === 'ranked' ? 'dalla classifica' : 'scritta ora'}</td><td>${esc(e.lang || '')}</td><td>${e.status === 'open' ? '<span class="dim">aperta</span>' : esc(OUTCOME_LABEL[e.outcome] || e.outcome || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">mai servita</td></tr>'}</tbody>
      </table>

      <details><summary>Documento grezzo</summary><pre>${esc(JSON.stringify({ ...r, served: undefined, dish: undefined }, null, 2))}</pre></details>
    </div>`);

  document.querySelectorAll('#drawer [data-act]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api(`/item/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status: b.dataset.act }) });
      closeDrawer();
      await loadAll();
    } catch (error) {
      b.disabled = false;
      alert(error.message);
    }
  }));
}

/* ------------------------------------------------------------------ */
/* Cucine e ricette di partenza                                        */
/* ------------------------------------------------------------------ */

function renderCoverage() {
  const s = RC.stats;
  const byTile = {};
  for (const r of RC.rows) for (const t of r.tiles || []) {
    const x = (byTile[t] = byTile[t] || { ranked: 0, candidate: 0, seed_review: 0 });
    if (r.status in x) x[r.status] += 1;
    if (r.status === 'reviewing') x.candidate += 1;
  }
  $('coverageTable').innerHTML = `
    <thead><tr><th>Cucina</th><th>piatti atlante</th><th>in classifica</th><th>candidate</th><th>da approvare</th><th>di partenza</th></tr></thead>
    <tbody>${TILES.map((t) => {
      const x = byTile[t] || { ranked: 0, candidate: 0, seed_review: 0 };
      return `<tr><td>${esc(tileName(t))}</td><td>${n(s.dishesByTile[t])}</td><td>${n(x.ranked)}</td><td>${n(x.candidate)}</td><td>${n(x.seed_review)}</td>
        <td><div class="rc-seed">
          <label>vegane <input type="number" min="0" max="5" value="3" data-mix="vegan"></label>
          <label>veget. <input type="number" min="0" max="5" value="1" data-mix="vegetarian"></label>
          <label>pesce <input type="number" min="0" max="5" value="1" data-mix="pescatarian"></label>
          <button class="btn small primary" data-seed="${esc(t)}">Crea</button>
        </div></td></tr>`;
    }).join('')}</tbody>`;
  $('coverageTable').querySelectorAll('[data-seed]').forEach((b) => b.addEventListener('click', () => seed(b)));
}

async function seed(button) {
  const tile = button.dataset.seed;
  const row = button.closest('tr');
  const mix = {};
  row.querySelectorAll('[data-mix]').forEach((i) => { mix[i.dataset.mix] = Number(i.value) || 0; });
  button.disabled = true;
  const label = button.textContent;
  button.textContent = 'Scrivo… (1-2 min)';
  try {
    const out = await api('/seed', { method: 'POST', body: JSON.stringify({ tile, mix }) });
    const ok = out.results.filter((r) => r.verdict !== 'reject').length;
    button.textContent = `${ok} pronte · ${out.results.length - ok} scartate`;
    await loadAll();
  } catch (error) {
    button.textContent = label;
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Parametri                                                           */
/* ------------------------------------------------------------------ */

const PARAM_FIELDS = [
  ['bonus.star', 'Una stella vale', 'tenute in più'],
  ['bonus.reuse', 'Un riuso vale', 'tenute in più (una volta per persona)'],
  ['confidence', 'Prudenza', 'più alta = contano di più le viste (1,64 di base)'],
  ['groupMinViews', 'Visualizzazioni minime per gruppo', 'per usare il punteggio della propria dieta'],
  ['youngSlots', 'Posti per ricette giovani', 'per mazzo'],
  ['youngViews', 'Giovane fino a', 'visualizzazioni'],
  ['minAiPerDeck', 'Ricette IA minime per mazzo', 'anche se la classifica basterebbe'],
  ['retire.earlyViews', 'Esce presto: dopo', 'viste'],
  ['retire.earlyMaxKeeps', 'Esce presto: con al massimo', 'tenute'],
  ['retire.lateViews', 'Esce dopo: da', 'viste'],
  ['retire.lateMinKeepRate', 'Esce dopo: sotto', 'quota di tenute, 0-1 (0,35 = 35%)'],
  ['dishMaxRetired', 'Piatto abbandonato dopo', 'uscite per la stessa dieta'],
  ['quotaShift', 'Spostamento quote personale', '0-0,5 (0,15 = ±15 punti)'],
  ['seenDishDays', 'Non ripetere un piatto per', 'giorni'],
  ['openDays', 'Run abbandonata dopo', 'giorni'],
  ['candidateDays', 'Candidata scade dopo', 'giorni senza like'],
  ['quotas.vegetarian.vegan', 'Vegetariani: quota vegane', '0-1'],
  ['quotas.vegetarian.vegetarian', 'Vegetariani: quota vegetariane', '0-1'],
  ['quotas.pescatarian.vegan', 'Pescetariani: quota vegane', '0-1'],
  ['quotas.pescatarian.vegetarian', 'Pescetariani: quota vegetariane', '0-1'],
  ['quotas.pescatarian.pescatarian', 'Pescetariani: quota con pesce', '0-1'],
];

function dig(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function plant(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {}; });
  o[keys[keys.length - 1]] = value;
}

async function renderParams() {
  $('meanNow').textContent = `${Math.round(RC.mean * 100)}%`;
  if (!RC.params) {
    try { RC.params = await api('/params'); } catch (error) { $('paramsState').textContent = error.message; return; }
  }
  const eff = RC.params.effective;
  $('paramsForm').innerHTML = PARAM_FIELDS.map(([path, label, hint]) => `
    <div class="field"><label>${esc(label)} <span class="dim">${esc(hint)}</span></label>
      <input type="number" step="any" name="${path}" value="${dig(eff, path) ?? ''}"></div>`).join('') + `
    <div class="field"><label><input type="checkbox" name="ingredientSharing" ${eff.ingredientSharing ? 'checked' : ''}> Ingredienti condivisi di default</label></div>
    <div class="field"><button class="btn primary" type="submit">Salva</button></div>`;
  $('paramsForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = {};
    $('paramsForm').querySelectorAll('input[type=number]').forEach((i) => plant(body, i.name, Number(i.value)));
    body.ingredientSharing = $('paramsForm').querySelector('[name=ingredientSharing]').checked;
    body.quotas.vegan = { vegan: 1 };
    $('paramsState').textContent = 'salvo…';
    try {
      await api('/params', { method: 'PUT', body: JSON.stringify(body) });
      RC.params = null;
      $('paramsState').textContent = 'salvato';
      await loadAll();
    } catch (error) {
      $('paramsState').textContent = error.message;
    }
  };
}

/* ------------------------------------------------------------------ */

$('fTile').innerHTML += TILES.map((t) => `<option value="${esc(t)}">${esc(tileName(t))}</option>`).join('');
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => { RC.tab = b.dataset.tab; render(); }));
['q', 'fDiet', 'fTile', 'fSort'].forEach((id) => $(id).addEventListener('input', render));
$('refresh').addEventListener('click', loadAll);
loadAll();
scheduleLive();
})();
