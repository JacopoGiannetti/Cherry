/* Distribution — la tela a nodi.
 *
 * Il modello è semplice e vale la pena dirlo in testa: un grafo di nodi e
 * archi, dove ogni arco trasporta una LISTA di contenuti. Un Source emette
 * un elemento, un AI Wizard con otto varianti ne emette otto, un Merge di
 * otto per tre ne emette ventiquattro. I numeri che si vedono sui fili sono
 * quelli, e sono il motivo per cui lo strumento serve.
 *
 * Qui non si esegue niente: il browser disegna, configura e chiede un
 * preventivo. Il lavoro vero lo fa il motore sul server, e questa pagina lo
 * guarda lavorare interrogandolo ogni secondo.
 */

const $ = (id) => document.getElementById(id);
const API = '/api/distribution';

/* ------------------------------------------------------------------ */
/* Stato                                                               */
/* ------------------------------------------------------------------ */

let catalog = null;                        // tipi di nodo, modelli, stili
let storage = { folders: [], assets: [] }; // cartelle e contenuti
let graph = { nodes: [], edges: [] };
let flowId = null;
let known = [];                            // flussi salvati, per nome e id
let dirty = false;                         // la tela ha modifiche non su Firestore
let selected = null;                       // scheda evidenziata sulla tela
let panelFor = null;                       // scheda con le impostazioni aperte
let view = { x: 80, y: 60, k: 1 };
let run = null;                            // run in corso
let poller = null;
let budget = null;

const ICONS = {
  source: '<path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  wizard: '<path d="M5 3v4M3 5h4M6 17v4M4 19h4"/><path d="M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5z"/>',
  text: '<path d="M4 6h16M4 6V4h16v2"/><path d="M12 4v16M9 20h6"/>',
  merge: '<path d="M6 4v5a4 4 0 0 0 4 4h8"/><path d="M6 20v-5a4 4 0 0 1 4-4h8"/><path d="M15 10l3 3-3 3"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
};
const svg = (d, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24">${d}</svg>`;
const TICK = '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>';
const SPIN = '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/></svg>';
const BANG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v.5"/></svg>';

const uid = () => Math.random().toString(36).slice(2, 9);

// Gli hook e gli stili di un nodo Testo, letti come li legge il server:
// una riga un hook, e almeno uno stile acceso sempre.
const hooksOf = (c) => String(c.hooks != null ? c.hooks : c.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
const stylesOf = (c) => {
  const list = Array.isArray(c.styles) ? c.styles : c.style ? [c.style] : [];
  return list.length ? list : ['tiktok'];
};
/** Le porte del Merge che hanno davvero qualcosa attaccato. */
const mergeLanes = (nodeId) => [...new Set((graph.edges || []).filter((e) => e.to === nodeId).map((e) => e.toPort || 'a'))];
const money = (n) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, options = {}) {
  const res = await fetch(API + path, options);
  if (!res.ok) {
    let message = `${res.status}`;
    try { message = (await res.json()).error || message; } catch { /* corpo non JSON */ }
    throw new Error(message);
  }
  const type = res.headers.get('content-type') || '';
  return type.includes('json') ? res.json() : res;
}

let toastTimer = null;
function toast(message, bad) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), bad ? 6500 : 3200);
}

/* ------------------------------------------------------------------ */
/* Avvio                                                               */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    catalog = await api('/catalog');
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;max-width:600px"><h1>Distribution non parte</h1>
      <p style="margin-top:10px;color:var(--muted)">${esc(e.message)}</p>
      <p style="margin-top:16px"><a class="btn" href="/">Torna a analytics</a></p></div>`;
    return;
  }

  // Due guasti diversi meritano due messaggi diversi: senza ffmpeg non
  // funziona niente, con un ffmpeg monco funziona tutto tranne i testi.
  const warn = !catalog.ffmpeg
    ? 'ffmpeg non è arrivato: testi, merge e ritocchi esatti falliranno. All’avvio il server prova a scaricarlo; se la barra resta dopo un refresh, il download è fallito.'
    : !catalog.drawtext
      ? 'Questo ffmpeg non sa stampare scritte: gli manca freetype, quindi il nodo Testo fallisce. Il resto funziona. Si risolve ridistribuendo col Dockerfile, dove ffmpeg lo installa apt.'
      : '';
  if (warn) {
    const bar = document.createElement('div');
    bar.className = 'warnbar';
    // Il motivo per cui il ripiego non ha funzionato: senza, da qui non
    // si capisce se il download è caduto, è scaduto o non è mai partito.
    const why = catalog.ffmpegNote ? ` <span style="opacity:.7">(${esc(catalog.ffmpegNote)})</span>` : '';
    bar.innerHTML = `${BANG} ${warn}${why}`;
    $('body').before(bar);
  }

  renderPalette();
  wireCanvas();
  wireTop();
  wireStorage();
  wireGate();
  wireConsole();

  await Promise.all([loadStorage(), loadFlows()]);
  restore();
  draw();
  // Il preventivo anche all'apertura: dice subito cosa manca al flusso,
  // invece di aspettare la prima modifica per accorgersene.
  estimate();
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

function renderPalette() {
  const item = (t) => `
    <div class="pal-item" draggable="true" data-type="${t.id}">
      <span class="ico ${t.tint}">${svg(ICONS[t.id] || ICONS.source)}</span>
      <div><strong>${esc(t.label)}</strong><span>${esc(t.summary)}</span></div>
    </div>`;

  const starters = catalog.nodes.filter((t) => !t.inputs.length);
  const actions = catalog.nodes.filter((t) => t.inputs.length && t.outputs.length);
  const enders = catalog.nodes.filter((t) => t.inputs.length && !t.outputs.length);

  $('palette').innerHTML = `
    <h3>Starters</h3>${starters.map(item).join('')}
    <h3>Azioni</h3>${actions.map(item).join('')}
    <h3>Arrivo</h3>${enders.map(item).join('')}
    <p class="foot">Trascina sulla tela. Collega trascinando da un pallino all’altro.</p>`;

  $('palette').querySelectorAll('.pal-item').forEach((el) => {
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/node', el.dataset.type));
  });
}

/* ------------------------------------------------------------------ */
/* Tela: pan, zoom, trascinamento, collegamenti                        */
/* ------------------------------------------------------------------ */

function typeOf(node) {
  return catalog.nodes.find((t) => t.id === node.type);
}

function addNode(type, at) {
  const t = catalog.nodes.find((x) => x.id === type);
  if (!t) return;
  const node = { id: uid(), type, x: Math.round(at.x), y: Math.round(at.y), config: { ...t.defaults } };
  graph.nodes.push(node);
  // Appena piazzata, l'unica cosa che vuoi fare è configurarla: qui il
  // pannello si apre da solo, ed è l'unico caso in cui succede.
  selected = node.id;
  panelFor = node.id;
  changed();
}

/** Dalle coordinate del puntatore a quelle del mondo. */
function toWorld(clientX, clientY) {
  const box = $('canvas').getBoundingClientRect();
  return { x: (clientX - box.left - view.x) / view.k, y: (clientY - box.top - view.y) / view.k };
}

function applyView() {
  $('world').style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  $('zoomLvl').textContent = `${Math.round(view.k * 100)}%`;
}

function zoomBy(factor, centre) {
  const k = Math.min(2, Math.max(0.3, view.k * factor));
  const box = $('canvas').getBoundingClientRect();
  const cx = centre ? centre.x - box.left : box.width / 2;
  const cy = centre ? centre.y - box.top : box.height / 2;
  // Si tiene fermo il punto sotto al puntatore, come in ogni mappa.
  view.x = cx - ((cx - view.x) / view.k) * k;
  view.y = cy - ((cy - view.y) / view.k) * k;
  view.k = k;
  applyView();
}

function fit() {
  if (!graph.nodes.length) { view = { x: 80, y: 60, k: 1 }; return applyView(); }
  const box = $('canvas').getBoundingClientRect();
  const xs = graph.nodes.map((n) => n.x);
  const ys = graph.nodes.map((n) => n.y);
  const w = Math.max(...xs) + 280 - Math.min(...xs);
  const h = Math.max(...ys) + 220 - Math.min(...ys);
  view.k = Math.min(1.1, Math.max(0.35, Math.min((box.width - 80) / w, (box.height - 80) / h)));
  view.x = (box.width - w * view.k) / 2 - Math.min(...xs) * view.k;
  view.y = (box.height - h * view.k) / 2 - Math.min(...ys) * view.k;
  applyView();
}

// Il filo che stai tirando adesso. `anchor` è il capo fermo (quello già
// attaccato a una porta), `x`/`y` è il capo che segue il puntatore, e
// `restore` è il collegamento che si stava spostando: se molli nel vuoto
// torna dov'era invece di sparire.
let linking = null; // { anchor: {node, port, side}, x, y, restore, over }

// Le schede sul canvas, per id. Tenerle vive invece di rigenerarle è tutto
// il punto: un nodo ricostruito a metà gesto è un gesto perso.
const nodeEls = new Map();

const NODE_W = 260;

/* --- trascinamento ------------------------------------------------- */

// Sotto questa soglia è un click, non un trascinamento: senza, selezionare
// una card la sposterebbe di un pixel ogni volta.
const DRAG_THRESHOLD = 3;
let zTop = 10;

/**
 * Segue un puntatore fino a quando non viene rilasciato.
 *
 * Gli ascoltatori stanno su `window` perché è l'unico posto dove gli eventi
 * arrivano comunque: la cattura li reindirizza all'elemento, ma continuano a
 * risalire fino qui. La cattura si chiede in più, così il gesto non si perde
 * se il puntatore esce dalla finestra o passa sopra a un altro nodo.
 */
function trackPointer(el, event, { move, end }) {
  const id = event.pointerId;
  try { el.setPointerCapture(id); } catch { /* niente cattura: bastano gli eventi su window */ }

  const onMove = (ev) => { if (ev.pointerId === id) move(ev); };
  const onUp = (ev) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    try { el.releasePointerCapture(id); } catch { /* già rilasciata */ }
    end(ev);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/**
 * Prende una card e la muove.
 *
 * Usa i pointer event con la cattura: il puntatore può uscire dalla card,
 * finire sopra un'altra o fuori dalla finestra, e gli eventi continuano ad
 * arrivare qui. Con mousemove su window bastava un iframe o un pulsante del
 * mouse rilasciato fuori fuoco per lasciare la card incollata al cursore.
 */
function startNodeDrag(el, node, event) {
  const start = toWorld(event.clientX, event.clientY);
  const from = { x: node.x, y: node.y };
  let moved = false;

  el.style.zIndex = ++zTop;

  trackPointer(el, event, {
    move(ev) {
      const p = toWorld(ev.clientX, ev.clientY);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!moved && Math.hypot(dx * view.k, dy * view.k) < DRAG_THRESHOLD) return;
      moved = true;
      el.classList.add('dragging');
      node.x = Math.round(from.x + dx);
      node.y = Math.round(from.y + dy);
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      queueWires();
    },
    end() {
      el.classList.remove('dragging');
      if (moved) {
        persistLocal();
        drawWires();
      }
    },
  });
}

/**
 * Inizia a tirare un filo da una porta.
 *
 * Da un'uscita nasce un collegamento nuovo. Da un ingresso già occupato si
 * stacca quello che c'era e se ne sposta il capo: è il gesto che ci si
 * aspetta, e senza si è costretti a cancellare e rifare.
 */
function startLink(portEl, event) {
  const nodeId = portEl.dataset.node;
  const portId = portEl.dataset.port;
  const side = portEl.classList.contains('out') ? 'out' : 'in';

  let anchor = { node: nodeId, port: portId, side };
  let restore = null;

  if (side === 'in') {
    // L'ultimo arrivato è quello che si stacca: è anche quello disegnato
    // sopra agli altri, quindi è quello che l'occhio si aspetta di prendere.
    const attached = graph.edges.filter((e) => e.to === nodeId && e.toPort === portId);
    const edge = attached[attached.length - 1];
    if (edge) {
      restore = edge;
      graph.edges = graph.edges.filter((e) => e.id !== edge.id);
      anchor = { node: edge.from, port: edge.fromPort, side: 'out' };
    }
  }

  const p = toWorld(event.clientX, event.clientY);
  linking = { anchor, x: p.x, y: p.y, restore, over: null };

  const canvas = $('canvas');
  canvas.classList.add('linking');
  drawWires();

  trackPointer(canvas, event, {
    move(ev) {
      const w = toWorld(ev.clientX, ev.clientY);
      linking.x = w.x;
      linking.y = w.y;
      // Il bersaglio si calcola dalla geometria, non da chi sta sotto al
      // puntatore: azzeccare un cerchio da 13 pixel sarebbe un test di
      // mira, non un'interfaccia.
      linking.over = dropTarget(ev.clientX, ev.clientY);
      paintTargets();
      queueWires();
    },
    end() {
      canvas.classList.remove('linking');

      const target = linking.over;
      const back = linking.restore;
      linking = null;
      paintTargets();

      if (target) {
        if (anchor.side === 'out') connect(anchor.node, anchor.port, target.node, target.port);
        else connect(target.node, target.port, anchor.node, anchor.port);
      } else if (back) {
        // Mollato nel vuoto: il collegamento che stavi spostando torna dov'era.
        graph.edges.push(back);
        changed();
      } else {
        drawWires();
      }
    },
  });
}

/**
 * Dove si attaccherebbe il filo se mollassi adesso.
 *
 * Si accetta tutta la card, non solo il pallino: si sceglie la porta
 * compatibile più vicina in verticale. Una card con un ingresso solo si
 * prende il filo ovunque la tocchi.
 */
function dropTarget(clientX, clientY) {
  if (!linking) return null;
  const want = linking.anchor.side === 'out' ? 'inputs' : 'outputs';
  const side = want === 'inputs' ? 'in' : 'out';

  for (const node of graph.nodes) {
    if (node.id === linking.anchor.node) continue;
    const el = nodeEls.get(node.id);
    if (!el) continue;
    const box = el.getBoundingClientRect();
    // Un margine morbido intorno alla card: si aggancia anche se sei poco
    // fuori, che è come si comporta ogni editor a nodi decente.
    const pad = 26;
    if (clientX < box.left - pad || clientX > box.right + pad) continue;
    if (clientY < box.top - pad || clientY > box.bottom + pad) continue;

    const ports = typeOf(node)[want];
    if (!ports || !ports.length) continue;

    let best = null;
    let bestGap = Infinity;
    ports.forEach((port, i) => {
      const y = box.top + (box.height * (i + 1)) / (ports.length + 1);
      const gap = Math.abs(clientY - y);
      if (gap < bestGap) {
        bestGap = gap;
        best = port;
      }
    });
    if (best) return { node: node.id, port: best.id, side };
  }
  return null;
}

/** Evidenzia la porta su cui il filo sta per atterrare. */
function paintTargets() {
  const over = linking && linking.over;
  document.querySelectorAll('.port.armed').forEach((p) => p.classList.remove('armed'));
  document.querySelectorAll('.node.target').forEach((n) => n.classList.remove('target'));
  if (!over) return;
  const el = nodeEls.get(over.node);
  if (!el) return;
  el.classList.add('target');
  const port = el.querySelector(`.port.${over.side}[data-port="${over.port}"]`);
  if (port) port.classList.add('armed');
}

/* --- tela ---------------------------------------------------------- */

function wireCanvas() {
  const canvas = $('canvas');

  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', (e) => {
    const type = e.dataTransfer.getData('text/node');
    if (!type) return;
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    addNode(type, { x: p.x - NODE_W / 2, y: p.y - 40 });
  });

  // Pan sul vuoto o col tasto centrale. Anche qui con la cattura, o
  // trascinando fuori dalla finestra la tela resta attaccata al cursore.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node') || e.target.closest('.zoom')) return;
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target.closest('[data-edge]')) return;

    select(null);
    const from = { x: view.x - e.clientX, y: view.y - e.clientY };
    canvas.classList.add('panning');

    trackPointer(canvas, e, {
      move(ev) {
        view.x = from.x + ev.clientX;
        view.y = from.y + ev.clientY;
        applyView();
      },
      end() {
        canvas.classList.remove('panning');
        persistLocal();
      },
    });
  });

  // I fili si gestiscono per delega: vengono ridisegnati di continuo, e
  // riattaccare un listener a ognuno a ogni fotogramma è il modo migliore
  // per perderli a metà gesto.
  const wires = $('wires');
  wires.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-edge]');
    if (!hit) return;
    graph.edges = graph.edges.filter((x) => x.id !== hit.dataset.edge);
    changed();
  });
  wires.addEventListener('pointerover', (e) => {
    const hit = e.target.closest('[data-edge]');
    if (hit) wires.querySelectorAll(`[data-edge="${hit.dataset.edge}"]`).forEach((p) => p.classList.add('hover'));
  });
  wires.addEventListener('pointerout', (e) => {
    const hit = e.target.closest('[data-edge]');
    if (hit) wires.querySelectorAll(`[data-edge="${hit.dataset.edge}"]`).forEach((p) => p.classList.remove('hover'));
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX, y: e.clientY });
  }, { passive: false });

  $('zoomIn').addEventListener('click', () => zoomBy(1.2));
  $('zoomOut').addEventListener('click', () => zoomBy(1 / 1.2));
  $('zoomFit').addEventListener('click', fit);

  window.addEventListener('keydown', (e) => {
    // Il bersaglio non è per forza un elemento: se nessuno ha il fuoco
    // l'evento può arrivare dal documento, che `matches` non ce l'ha, e
    // l'eccezione si porterebbe via anche l'Escape qui sotto.
    const on = e.target;
    if (on && typeof on.matches === 'function' && on.matches('input, textarea, select')) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      removeNode(selected);
    }
    if (e.key === 'Escape') {
      if (linking) {
        if (linking.restore) graph.edges.push(linking.restore);
        linking = null;
        $('canvas').classList.remove('linking');
        paintTargets();
        drawWires();
        return;
      }
      if (panelFor) {
        panelFor = null;
        renderPanel();
        renderNodes();
        return;
      }
      select(null);
      closeSheets();
    }
  });

  applyView();
}

function connect(from, fromPort, to, toPort) {
  if (from === to) return drawWires();
  // Una porta d'ingresso accetta più fili: le liste in arrivo si sommano.
  // Un doppione invece no, sarebbe lo stesso contenuto contato due volte.
  const already = graph.edges.some((e) => e.from === from && e.fromPort === fromPort && e.to === to && e.toPort === toPort);
  if (already) return drawWires();
  graph.edges.push({ id: uid(), from, fromPort, to, toPort });
  changed();
}

function removeNode(id) {
  graph.nodes = graph.nodes.filter((n) => n.id !== id);
  graph.edges = graph.edges.filter((e) => e.from !== id && e.to !== id);
  if (selected === id) selected = null;
  if (panelFor === id) panelFor = null;
  changed();
}

/**
 * Selezionare è cambiare una classe, non ridisegnare la tela.
 *
 * Selezione e impostazioni sono due cose diverse: toccare una scheda per
 * spostarla non deve aprirti un pannello addosso. Le impostazioni le
 * apre il pulsante sulla scheda, o il doppio clic.
 */
function select(id) {
  if (selected === id) return;
  selected = id;
  for (const [nodeId, el] of nodeEls) el.classList.toggle('sel', nodeId === id);

  // Col pannello già aperto, toccare un'altra scheda lo sposta lì. Aprirlo
  // è una scelta, ma una volta aperto deve mostrare la scheda che stai
  // toccando: restare sulla precedente vuol dire cambiare i parametri
  // sbagliati credendo di cambiare quelli giusti.
  if (panelFor && panelFor !== id) {
    panelFor = id;
    renderPanel();
    renderNodes();
  }
}

function openSettings(id) {
  panelFor = panelFor === id ? null : id;
  select(id);
  renderPanel();
  renderNodes();
}

/* --- disegno ------------------------------------------------------- */

function portXY(nodeId, portId, side) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const type = typeOf(node);
  if (!type) return null;
  const ports = side === 'out' ? type.outputs : type.inputs;
  const index = Math.max(0, ports.findIndex((p) => p.id === portId));
  // L'altezza della scheda dipende da cosa c'è scritto dentro, quindi si
  // legge. `offsetHeight` non risente dello zoom, che invece falserebbe
  // una misura presa da getBoundingClientRect.
  const el = nodeEls.get(nodeId);
  const height = el ? el.offsetHeight : 92;
  return {
    x: node.x + (side === 'out' ? NODE_W : 0),
    y: node.y + (height * (index + 1)) / (ports.length + 1),
  };
}

function curve(a, b) {
  const dx = Math.max(38, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

// Durante un trascinamento i fili si ridisegnano a ogni movimento del
// puntatore: accorparli al fotogramma evita di rifare lo stesso lavoro
// tre volte prima che lo schermo se ne accorga.
let wireFrame = null;
function queueWires() {
  if (wireFrame) return;
  wireFrame = requestAnimationFrame(() => {
    wireFrame = null;
    drawWires();
  });
}

function drawWires() {
  const parts = [];
  const counts = (budget && budget.outputs) || {};

  for (const edge of graph.edges) {
    const a = portXY(edge.from, edge.fromPort, 'out');
    const b = portXY(edge.to, edge.toPort, 'in');
    if (!a || !b) continue;
    const d = curve(a, b);
    const state = run && run.nodes && run.nodes[edge.from];
    const mood = state && state.status === 'running' ? 'live' : state && state.status === 'done' ? 'hot' : '';

    // Due tracciati sovrapposti: uno spesso e invisibile che raccoglie il
    // puntatore, uno sottile che si vede. Un filo da due pixel è
    // impossibile da centrare col mouse.
    parts.push(`<path class="grab" d="${d}" data-edge="${edge.id}" />`);
    parts.push(`<path class="wire ${mood}" d="${d}" data-edge="${edge.id}" />`);

    // Quanti elementi passano di qui: è l'informazione che fa capire in
    // un colpo d'occhio quanto sta per moltiplicarsi il flusso.
    const n = counts[edge.from];
    if (n) parts.push(`<text class="count" x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 8}">${n}</text>`);
  }

  if (linking) {
    const a = portXY(linking.anchor.node, linking.anchor.port, linking.anchor.side);
    if (a) {
      const loose = { x: linking.x, y: linking.y };
      // Se sto tirando all'indietro (da un ingresso verso un'uscita) la
      // curva va disegnata al contrario, o fa un cappio.
      const d = linking.anchor.side === 'out' ? curve(a, loose) : curve(loose, a);
      parts.push(`<path class="wire draft" d="${d}" />`);
    }
  }

  $('wires').innerHTML = parts.join('');
}

/**
 * Se il Wizard resta su ffmpeg o passa a un modello. Deve dare la stessa
 * risposta di `wizardIsExact` nel backend, o la tela promette "gratis" su
 * una run che poi arriva col conto.
 */
function wizardIsExact(config) {
  if (config.level !== 'slight') return false;
  if ((config.engine || 'exact') !== 'exact') return false;
  return !(config.cleanup || []).length;
}

/** Le due righe che ogni nodo mostra senza doverlo aprire. */
function nodeLines(node) {
  const c = node.config || {};
  const label = (list, value) => {
    const found = (list || []).find((x) => x.id === value || x.value === value);
    return found ? found.label : value;
  };

  if (node.type === 'source') {
    const n = (c.assetIds || []).length;
    return [n ? `${n} content${n === 1 ? 'o' : 'i'}` : 'nessun contenuto scelto'];
  }
  if (node.type === 'wizard') {
    const cleanup = c.cleanup || [];
    const exact = wizardIsExact(c);
    const lines = [
      `<span class="line"><em>Cambia</em> <b>${esc(label(catalog.levels, c.level))}</b></span>`,
      `<span class="line"><em>Su</em> <b>${esc(label(catalog.targets, c.target))}</b></span>`,
      `<span class="line"><em>Varianti</em> <b>${c.count}</b> ${exact ? '· esatte, gratis' : ''}</span>`,
    ];
    if (cleanup.length) {
      const what = cleanup.map((id) => label(catalog.cleanup, id)).join(', ').toLowerCase();
      lines.push(`<span class="line"><em>Toglie</em> <b>${esc(what)}</b></span>`);
    }
    return lines;
  }
  if (node.type === 'text') {
    const list = hooksOf(c);
    const styles = stylesOf(c);
    const names = styles.map((id) => {
      const s = (catalog.textStyles || []).find((x) => x.id === id);
      return s ? s.label : id;
    });
    if (!list.length) return ['<span class="line" style="color:var(--amber)">nessun hook</span>'];
    return [
      `<span class="line"><em>Hook</em> <b>${list.length}</b> × <b>${esc(names.join(' + '))}</b></span>`,
      `<span class="line">“${esc(list[0].slice(0, 40))}”${list.length > 1 ? ` <em>+${list.length - 1}</em>` : ''}</span>`,
      `<span class="line"><em>Fa</em> <b>×${list.length * styles.length}</b> per contenuto</span>`,
    ];
  }
  if (node.type === 'merge') {
    const lanes = mergeLanes(node.id);
    return [
      lanes.length >= 2
        ? `<span class="line"><em>Incrocia</em> <b>${lanes.length}</b> ingressi</span>`
        : '<span class="line" style="color:var(--amber)">servono due ingressi</span>',
      `<span class="line"><em>Tetto</em> <b>${c.limit}</b> combinazioni</span>`,
    ];
  }
  if (node.type === 'save') {
    const folder = storage.folders.find((f) => f.id === c.folderId);
    return [
      `<span class="line"><em>In</em> <b>${esc(folder ? folder.path : 'Output / questa run')}</b></span>`,
      '<span class="line"><em>Divisi in</em> <b>Video</b> e <b>Foto</b></span>',
    ];
  }
  return [];
}

function statusRow(node) {
  const s = run && run.nodes && run.nodes[node.id];
  if (!s) {
    const cost = budget && budget.nodes.find((n) => n.nodeId === node.id);
    if (cost && cost.usd > 0) return `<div class="status">${money(cost.usd)} · ${cost.jobs} generazioni</div>`;
    if (cost && cost.jobs) return `<div class="status">${cost.jobs} in uscita · gratis</div>`;
    return '';
  }
  if (s.status === 'done') return `<div class="status ok">${TICK} ${s.outputs} in uscita</div>`;
  if (s.status === 'error') return `<div class="status bad">${BANG} ${esc(s.error || 'errore')}</div>`;
  if (s.status === 'waiting') return `<div class="status wait">${BANG} ${esc(s.note || 'in attesa')}</div>`;
  if (s.status === 'running') {
    const p = s.progress;
    const ago = s.job && s.job.since ? Math.max(0, Math.round((Date.now() - Date.parse(s.job.since)) / 1000)) : 0;
    const clock = ago >= 8 ? ` · ${Math.floor(ago / 60)}:${String(ago % 60).padStart(2, '0')}` : '';
    const hint = ago >= 8 * 60
      ? '<div class="status wait">fal è ancora in corso: un video corto di solito esce in 1–4 min</div>'
      : '';
    return `<div class="status">${SPIN} ${esc(s.note || 'in corso')}${p ? ` · ${p.done}/${p.total}` : ''}${clock}</div>` +
      (p && p.total ? `<div class="bar"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></div>` : '') +
      hint;
  }
  return '<div class="status">in attesa</div>';
}

/** Costruisce la scheda una volta sola e le attacca i gesti. */
function buildNode(node) {
  const t = typeOf(node);
  const el = document.createElement('div');
  el.className = 'node';
  el.dataset.id = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;

  // I due comandi stanno sulla scheda e non altrove: la X qui toglie la
  // scheda, e quella del pannello chiude il pannello. Prima era la stessa
  // X in due posti con due significati.
  const head = document.createElement('div');
  head.className = 'head';
  head.innerHTML =
    `<span class="ico ${t.tint}">${svg(ICONS[t.id])}</span><strong>${esc(t.label)}</strong>` +
    `<button class="act cog" type="button" title="Impostazioni">${GEAR}</button>` +
    `<button class="act kill" type="button" title="Elimina la scheda">${CROSS}</button>`;
  head.querySelector('.cog').addEventListener('click', (e) => {
    e.stopPropagation();
    openSettings(node.id);
  });
  head.querySelector('.kill').addEventListener('click', (e) => {
    e.stopPropagation();
    removeNode(node.id);
  });

  const body = document.createElement('div');
  body.className = 'body';

  // Le porte stanno in un livello a parte, così aggiornare il corpo della
  // scheda non le butta via mentre ci stai tirando un filo.
  const ports = document.createElement('div');
  ports.className = 'ports';
  // Le etichette delle porte stanno nascoste: stampate sempre, tre
  // schede vicine diventano un muro di parole sospese nel vuoto. Escono
  // passandoci sopra e mentre tiri un filo, cioè quando servono davvero.
  const tag = (p) => `<span class="tag">${esc(p.label)}</span>`;
  ports.innerHTML = [
    ...t.inputs.map((p, i) => `<div class="port in" data-node="${node.id}" data-port="${p.id}" style="top:${((i + 1) / (t.inputs.length + 1)) * 100}%">${tag(p)}</div>`),
    ...t.outputs.map((p, i) => `<div class="port out" data-node="${node.id}" data-port="${p.id}" style="top:${((i + 1) / (t.outputs.length + 1)) * 100}%">${tag(p)}</div>`),
  ].join('');

  el.append(head, body, ports);

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // Non rubare il gesto a quello che c'è dentro la scheda.
    if (e.target.closest('button, a, input, select, textarea')) return;
    e.stopPropagation();

    const current = graph.nodes.find((n) => n.id === node.id);
    if (!current) return;

    const port = e.target.closest('.port');
    if (port) {
      startLink(port, e);
      return;
    }
    select(node.id);
    startNodeDrag(el, current, e);
  });

  // Il doppio clic resta la scorciatoia per chi la cerca.
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('.act, .port')) return;
    if (panelFor !== node.id) openSettings(node.id);
  });
  return el;
}

/** Aggiorna quello che cambia: posizione, stato, righe di testo. */
function paintNode(el, node) {
  const s = run && run.nodes && run.nodes[node.id];
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;
  el.classList.toggle('sel', selected === node.id);
  el.classList.toggle('open', panelFor === node.id);
  el.querySelector('.act.cog').classList.toggle('on', panelFor === node.id);
  el.classList.toggle('running', !!s && s.status === 'running');
  el.classList.toggle('error', !!s && s.status === 'error');
  el.classList.toggle('waiting', !!s && s.status === 'waiting');

  const previews = s && s.preview && s.preview.length
    ? `<div class="thumbs">${s.preview.slice(0, 5).map((p) => `<img loading="lazy" src="${API}/asset/${p.assetId}/file?thumb=1" alt="">`).join('')}${s.outputs > 5 ? `<span class="more">+${s.outputs - 5}</span>` : ''}</div>`
    : '';
  const html = `${nodeLines(node).join('')}${statusRow(node)}${previews}`;
  const body = el.querySelector('.body');
  // Riscrivere lo stesso HTML farebbe ripartire le miniature da zero a
  // ogni giro di polling.
  if (body.dataset.sig !== html) {
    body.dataset.sig = html;
    body.innerHTML = html;
  }
}

function renderNodes() {
  const host = $('nodes');
  const alive = new Set();

  for (const node of graph.nodes) {
    if (!typeOf(node)) continue;
    alive.add(node.id);
    let el = nodeEls.get(node.id);
    if (!el) {
      el = buildNode(node);
      nodeEls.set(node.id, el);
      host.appendChild(el);
    }
    paintNode(el, node);
  }

  for (const [id, el] of nodeEls) {
    if (alive.has(id)) continue;
    el.remove();
    nodeEls.delete(id);
  }

  $('blank').hidden = graph.nodes.length > 0;
  drawWires();
}

function draw() {
  renderNodes();
  renderPanel();
}

/* ------------------------------------------------------------------ */
/* Pannello di configurazione                                          */
/* ------------------------------------------------------------------ */

/** Un campo si mostra solo se le condizioni del suo `when` sono vere. */
function visible(field, config, kind) {
  if (!field.when) return true;
  return Object.entries(field.when).every(([key, value]) => {
    if (key === 'kind') return kind === value;
    // Le leve del ritocco hanno senso solo se il nodo gira davvero su
    // ffmpeg: chiedere una pulizia lo sposta sull'AI e quelle non servono più.
    if (key === 'exact') return wizardIsExact(config) === value;
    return (config[key] || '') === value;
  });
}

/** Che tipo di roba arriva a questo nodo: serve a mostrare le opzioni video solo quando servono. */
function inboundKind(nodeId, seen = new Set()) {
  if (seen.has(nodeId)) return 'image';
  seen.add(nodeId);
  const incoming = graph.edges.filter((e) => e.to === nodeId);
  for (const edge of incoming) {
    const from = graph.nodes.find((n) => n.id === edge.from);
    if (!from) continue;
    if (from.type === 'merge') return 'video';
    if (from.type === 'source') {
      const ids = (from.config || {}).assetIds || [];
      if (ids.some((id) => (storage.assets.find((a) => a.id === id) || {}).kind === 'video')) return 'video';
      continue;
    }
    if (inboundKind(from.id, seen) === 'video') return 'video';
  }
  return 'image';
}

function renderPanel() {
  const panel = $('panel');
  const node = graph.nodes.find((n) => n.id === panelFor);
  $('body').classList.toggle('with-panel', Boolean(node));
  panel.hidden = !node;
  if (!node) return;

  const t = typeOf(node);
  const config = { ...t.defaults, ...node.config };
  const kind = inboundKind(node.id);

  const fields = t.fields.filter((f) => visible(f, config, kind)).map((f) => renderField(f, config, node)).join('');

  panel.innerHTML = `
    <div class="ph">
      <span class="ico ${t.tint}">${svg(ICONS[t.id])}</span>
      <strong>${esc(t.label)}</strong>
      <button class="btn small ghost" id="shutPanel" type="button" title="Chiudi le impostazioni">${CROSS}</button>
    </div>
    <div class="pb">
      <p class="summary">${esc(t.summary)}</p>
      ${fields}
      ${node.type === 'text' ? '<div class="f"><label>Anteprima</label><div class="cap-preview" id="capPreview"></div><span class="help">Le fasce rosse sono le zone coperte dalla UI di TikTok.</span></div>' : ''}
    </div>`;

  // Chiude il pannello e basta: la scheda si elimina dalla sua X.
  $('shutPanel').addEventListener('click', () => {
    panelFor = null;
    renderPanel();
    renderNodes();
  });
  wireFields(node, config);
  if (node.type === 'text') schedulePreview(node);
}

function renderField(field, config, node) {
  const value = config[field.key];
  const help = field.help ? `<span class="help">${esc(field.help)}</span>` : '';
  const id = `f_${field.key}`;

  // Gli sfondi dipendono dallo stile scelto adesso, non da quello che era
  // impostato quando il server ha compilato il catalogo: Snapchat ha solo
  // la barra grigia, TikTok ne ha quattro.
  if (field.key === 'background' && node.type === 'text') {
    const style = (catalog.textStyles || []).find((s) => s.id === stylesOf(config)[0]);
    field = { ...field, options: (style ? style.backgrounds : []).map((b) => ({ value: b.id, label: b.label })) };
  }

  switch (field.type) {
    case 'segment':
      return `<div class="f"><label>${esc(field.label)}</label>
        <div class="segbox" data-key="${field.key}">
          ${field.options.map((o) => `<button type="button" data-v="${esc(o.value)}" class="${value === o.value ? 'on' : ''}" title="${esc(o.help || '')}">${esc(o.label)}</button>`).join('')}
        </div>
        <span class="help">${esc((field.options.find((o) => o.value === value) || {}).help || field.help || '')}</span></div>`;

    case 'select':
      return `<div class="f"><label for="${id}">${esc(field.label)}</label>
        <select id="${id}" data-key="${field.key}">
          ${field.options.map((o) => `<option value="${esc(o.value)}" ${value === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        <span class="help">${esc((field.options.find((o) => o.value === value) || {}).help || field.help || '')}</span></div>`;

    case 'folder': {
      const options = [
        { value: '', label: 'Output / cartella della run' },
        ...storage.folders.map((f) => ({ value: f.id, label: f.path })),
      ];
      return `<div class="f"><label for="${id}">${esc(field.label)}</label>
        <select id="${id}" data-key="${field.key}">
          ${options.map((o) => `<option value="${esc(o.value)}" ${(value || '') === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>${help}</div>`;
    }

    case 'chips':
      return `<div class="f"><label>${esc(field.label)}</label>
        <div class="chipbox" data-key="${field.key}">
          ${field.options.map((o) => `<button type="button" data-v="${esc(o.value)}" class="${(value || []).includes(o.value) ? 'on' : ''}">${esc(o.label)}</button>`).join('')}
        </div>${help}</div>`;

    case 'toggle':
      return `<div class="f"><label class="toggle">
          <input type="checkbox" data-key="${field.key}" ${value ? 'checked' : ''}>
          <span><span class="t">${esc(field.label)}</span>${help}</span>
        </label></div>`;

    case 'number':
      return `<div class="f"><label for="${id}">${esc(field.label)}</label>
        <input id="${id}" type="number" data-key="${field.key}" value="${esc(value)}" min="${field.min}" max="${field.max}" step="${field.step || 1}">${help}</div>`;

    case 'range': {
      const shown = value === null || value === undefined ? 'auto' : Number(value).toFixed(2);
      return `<div class="f"><label for="${id}">${esc(field.label)} <span class="rangeval" data-for="${field.key}">${shown}</span></label>
        <input id="${id}" type="range" data-key="${field.key}" value="${value === null || value === undefined ? (field.min + field.max) / 2 : value}" min="${field.min}" max="${field.max}" step="${field.step}">${help}</div>`;
    }

    case 'textarea':
      return `<div class="f"><label for="${id}">${esc(field.label)}</label>
        <textarea id="${id}" data-key="${field.key}" placeholder="${esc(field.placeholder || '')}">${esc(value || '')}</textarea>${help}</div>`;

    case 'assets': {
      const chosen = (value || []).map((aid) => storage.assets.find((a) => a.id === aid)).filter(Boolean);
      return `<div class="f"><label>${esc(field.label)}</label>
        <div class="picked">${chosen.map((a) => `<span class="it"><img src="${API}/asset/${a.id}/file?thumb=1" alt="${esc(a.name)}" title="${esc(a.name)}"><button class="x" type="button" data-drop="${a.id}">×</button></span>`).join('')}</div>
        <button class="btn small" type="button" id="pickAssets">${chosen.length ? 'Cambia' : 'Scegli o carica'}</button>${help}</div>`;
    }

    default:
      return `<div class="f"><label for="${id}">${esc(field.label)}</label>
        <input id="${id}" type="text" data-key="${field.key}" value="${esc(value || '')}" placeholder="${esc(field.placeholder || '')}">${help}</div>`;
  }
}

function wireFields(node, config) {
  const panel = $('panel');
  const set = (key, value) => {
    node.config = { ...config, ...node.config, [key]: value };
    // Cambiando stile lo sfondo di prima può non esistere più: "contorno"
    // non vuol dire niente su Snapchat. Si riparte dal default dello
    // stile invece di lasciare un valore che il server non riconosce.
    if (key === 'styles' && node.type === 'text') {
      const style = (catalog.textStyles || []).find((s) => s.id === stylesOf(node.config)[0]);
      if (style && !style.backgrounds.some((b) => b.id === node.config.background)) {
        node.config.background = style.defaultBackground;
      }
    }
    changed({ keepPanel: true });
  };

  panel.querySelectorAll('.segbox').forEach((box) => {
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => set(box.dataset.key, b.dataset.v)));
  });
  panel.querySelectorAll('.chipbox').forEach((box) => {
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const current = new Set(node.config[box.dataset.key] || []);
      current.has(b.dataset.v) ? current.delete(b.dataset.v) : current.add(b.dataset.v);
      set(box.dataset.key, [...current]);
    }));
  });
  panel.querySelectorAll('select[data-key]').forEach((el) => {
    el.addEventListener('change', () => set(el.dataset.key, el.value || null));
  });
  panel.querySelectorAll('input[type="checkbox"][data-key]').forEach((el) => {
    el.addEventListener('change', () => set(el.dataset.key, el.checked));
  });
  panel.querySelectorAll('input[type="number"][data-key]').forEach((el) => {
    el.addEventListener('change', () => set(el.dataset.key, Number(el.value)));
  });

  // I campi continui non ridisegnano a ogni pixel: si aggiorna
  // l'etichetta subito e lo stato quando si molla la maniglia.
  panel.querySelectorAll('input[type="range"][data-key]').forEach((el) => {
    const out = panel.querySelector(`.rangeval[data-for="${el.dataset.key}"]`);
    el.addEventListener('input', () => {
      if (out) out.textContent = Number(el.value).toFixed(2);
      node.config[el.dataset.key] = Number(el.value);
      if (node.type === 'text') schedulePreview(node);
    });
    el.addEventListener('change', () => set(el.dataset.key, Number(el.value)));
  });

  panel.querySelectorAll('input[type="text"][data-key], textarea[data-key]').forEach((el) => {
    el.addEventListener('input', () => {
      node.config[el.dataset.key] = el.value;
      renderNodes();
      if (node.type === 'text') schedulePreview(node);
    });
    el.addEventListener('change', () => set(el.dataset.key, el.value));
  });

  const pick = $('pickAssets');
  if (pick) pick.addEventListener('click', () => openStorage({ pickFor: node.id }));
  panel.querySelectorAll('[data-drop]').forEach((b) => {
    b.addEventListener('click', () => {
      set('assetIds', (node.config.assetIds || []).filter((x) => x !== b.dataset.drop));
    });
  });
}

/* --- anteprima della didascalia ------------------------------------ */

let previewTimer = null;
let previewUrl = null;

function schedulePreview(node) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => renderPreview(node), 420);
}

async function renderPreview(node) {
  const host = $('capPreview');
  if (!host) return;
  const c = node.config;
  // Se al nodo arriva davvero un contenuto, si prova su quello: una
  // didascalia su fondo grigio non dice se è leggibile.
  const upstream = graph.edges.filter((e) => e.to === node.id).map((e) => graph.nodes.find((n) => n.id === e.from)).filter(Boolean);
  const sourceAsset = upstream.find((n) => n.type === 'source' && (n.config.assetIds || []).length);

  try {
    const res = await fetch(`${API}/caption/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assetId: sourceAsset ? sourceAsset.config.assetIds[0] : null,
        // L'anteprima è del primo hook nel primo stile: gli altri sono
        // lo stesso disegno con parole diverse, mostrarli tutti sarebbe
        // una galleria che nessuno guarda.
        style: stylesOf(c)[0], background: c.background, text: hooksOf(c)[0] || ' ',
        y: c.y, scale: c.scale,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    const safe = (res.headers.get('X-Caption-Safe') || '150-1670').split('-').map(Number);
    host.innerHTML = `<img src="${previewUrl}" alt="anteprima">
      <span class="zone" style="top:0;height:${(safe[0] / 1920) * 100}%"></span>
      <span class="zone" style="bottom:0;height:${((1920 - safe[1]) / 1920) * 100}%"></span>`;
  } catch (e) {
    host.innerHTML = `<div style="padding:14px;font-size:11px;color:var(--muted)">Anteprima non disponibile: ${esc(e.message)}</div>`;
  }
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

let storageMode = null;   // { pickFor } quando si sta scegliendo per un Source
let openFolder = null;
let picked = new Set();

async function loadStorage() {
  try {
    storage = await api('/storage');
  } catch (e) {
    // Lo storage che non risponde è un problema, ma non un motivo per
    // lasciare la tela bianca: il flusso si disegna e si configura lo
    // stesso, sono i contenuti che mancano.
    storage = { folders: [], assets: [] };
    toast(`Storage non raggiungibile: ${e.message}`, true);
  }
}

function openStorage(mode) {
  storageMode = mode || null;
  picked = new Set();
  if (mode && mode.pickFor) {
    const node = graph.nodes.find((n) => n.id === mode.pickFor);
    (node.config.assetIds || []).forEach((id) => picked.add(id));
  }
  $('storageDone').hidden = !(mode && mode.pickFor);
  $('storageTitle').textContent = mode && mode.pickFor ? 'Scegli i contenuti' : 'Storage';
  $('storage').hidden = false;
  renderStorage();
}

function closeSheets() {
  $('storage').hidden = true;
  $('gate').hidden = true;
}

function renderStorage() {
  const folders = storage.folders;
  const countIn = (id) => storage.assets.filter((a) => (a.folderId || null) === id).length;

  const row = (id, name, depth, count) => `
    <div class="row ${openFolder === id ? 'on' : ''}" data-folder="${id === null ? '' : id}" style="padding-left:${8 + depth * 13}px">
      <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      <span class="n">${esc(name)}</span><span class="c">${count || ''}</span>
      ${id === null ? '' : `<button class="act" type="button" data-del="${id}" title="Elimina la cartella (i contenuti risalgono)">🗑</button>`}
    </div>`;

  const lines = [row(null, 'Tutto', 0, storage.assets.length)];
  const walk = (parentId, depth) => {
    folders.filter((f) => (f.parentId || null) === parentId).forEach((f) => {
      lines.push(row(f.id, f.name, depth, countIn(f.id)));
      walk(f.id, depth + 1);
    });
  };
  walk(null, 1);
  $('tree').innerHTML = lines.join('');

  const shown = openFolder === null ? storage.assets : storage.assets.filter((a) => (a.folderId || null) === openFolder);
  $('storageCount').textContent = `${shown.length} element${shown.length === 1 ? 'o' : 'i'}`;

  const tiles = shown.map((a) => {
    const seconds = a.meta && a.meta.duration ? `${a.meta.duration.toFixed(1)}s` : a.kind === 'image' ? 'foto' : '';
    return `<div class="tile ${picked.has(a.id) ? 'on' : ''}" data-asset="${a.id}" draggable="true">
      <div class="ph">
        ${a.thumbPath ? `<img loading="lazy" src="${API}/asset/${a.id}/file?thumb=1" alt="">` : ''}
        ${seconds ? `<span class="badge">${esc(seconds)}</span>` : ''}
        <span class="pick">✓</span>
      </div>
      <div class="nm" title="${esc(a.name)}">${esc(a.name)}</div>
    </div>`;
  });
  if (!tiles.length) tiles.push('<div class="drop-hint">Niente qui. Trascina dei file, o premi Carica.</div>');
  $('files').innerHTML = tiles.join('');

  $('tree').querySelectorAll('[data-folder]').forEach((el) => {
    const id = el.dataset.folder || null;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      openFolder = id;
      renderStorage();
    });
    // Trascinando un contenuto su una cartella lo si sposta: è il modo
    // naturale di mettere ordine, e non richiede un menù.
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drop');
      const assetId = e.dataTransfer.getData('text/asset');
      if (!assetId) return;
      await api(`/asset/${assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: id }),
      });
      await loadStorage();
      renderStorage();
    });
  });

  $('tree').querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Elimino la cartella? I contenuti dentro risalgono al livello sopra, non si perdono.')) return;
      await api(`/folder/${b.dataset.del}`, { method: 'DELETE' });
      if (openFolder === b.dataset.del) openFolder = null;
      await loadStorage();
      renderStorage();
    });
  });

  $('files').querySelectorAll('[data-asset]').forEach((el) => {
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/asset', el.dataset.asset));
    el.addEventListener('click', () => {
      const id = el.dataset.asset;
      if (storageMode && storageMode.pickFor) {
        picked.has(id) ? picked.delete(id) : picked.add(id);
        renderStorage();
      } else {
        window.open(`${API}/asset/${id}/file`, '_blank');
      }
    });
  });
}

function wireStorage() {
  $('openStorage').addEventListener('click', () => openStorage(null));
  $('storageClose').addEventListener('click', closeSheets);
  $('storage').addEventListener('click', (e) => { if (e.target === $('storage')) closeSheets(); });

  $('newFolder').addEventListener('click', async () => {
    const name = prompt('Nome della cartella');
    if (!name) return;
    // La nuova cartella nasce dentro quella aperta: è quasi sempre quello
    // che si vuole, ed è così che si fanno le sottocartelle senza UI in più.
    await api('/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId: openFolder }),
    });
    await loadStorage();
    renderStorage();
  });

  $('uploadBtn').addEventListener('click', () => $('uploadInput').click());
  $('uploadInput').addEventListener('change', (e) => upload([...e.target.files]));

  const files = $('files');
  files.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    files.classList.add('dragging');
  });
  files.addEventListener('dragleave', () => files.classList.remove('dragging'));
  files.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    files.classList.remove('dragging');
    upload([...e.dataTransfer.files]);
  });

  $('storageDone').addEventListener('click', () => {
    const node = graph.nodes.find((n) => n.id === storageMode.pickFor);
    if (node) {
      node.config.assetIds = [...picked];
      changed();
    }
    closeSheets();
  });
}

async function upload(list) {
  if (!list.length) return;
  let done = 0;
  for (const file of list) {
    toast(`Carico ${file.name}… (${done + 1}/${list.length})`);
    try {
      const query = new URLSearchParams({ name: file.name, contentType: file.type });
      if (openFolder) query.set('folderId', openFolder);
      const asset = await api(`/upload?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      // Se si sta scegliendo per un Source, quello che carichi è quasi
      // certamente quello che vuoi usare: si seleziona da solo.
      if (storageMode && storageMode.pickFor) picked.add(asset.id);
      done++;
    } catch (e) {
      toast(`${file.name}: ${e.message}`, true);
    }
  }
  await loadStorage();
  renderStorage();
  if (done) toast(`${done} caricat${done === 1 ? 'o' : 'i'}`);
}

/* ------------------------------------------------------------------ */
/* Flussi: salvataggio e ripristino                                    */
/* ------------------------------------------------------------------ */

const LOCAL = 'vego-dist-draft';

function persistLocal() {
  // La bozza resta nel browser: chiudere la scheda per sbaglio non deve
  // costare il lavoro di mezz'ora sulla tela.
  localStorage.setItem(LOCAL, JSON.stringify({ graph, flowId, name: $('flowName').value, view, dirty }));
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL) || 'null');
    if (!saved || !saved.graph || !saved.graph.nodes.length) {
      seed();
    } else {
      graph = saved.graph;
      flowId = saved.flowId || null;
      dirty = saved.dirty !== false;
      if (saved.name) $('flowName').value = saved.name;
      if (saved.view) { view = saved.view; applyView(); }
      estimate();
    }
  } catch {
    seed();
  }
  renderFlowState();
}

/** La tela vuota è scoraggiante: si parte da un flusso minimo che si capisce. */
function seed() {
  const a = { id: uid(), type: 'source', x: 40, y: 140, config: { assetIds: [] } };
  const b = { id: uid(), type: 'wizard', x: 360, y: 120, config: { ...catalog.nodes.find((n) => n.id === 'wizard').defaults } };
  const c = { id: uid(), type: 'save', x: 680, y: 150, config: { folderId: null, prefix: '' } };
  graph = {
    nodes: [a, b, c],
    edges: [
      { id: uid(), from: a.id, fromPort: 'out', to: b.id, toPort: 'in' },
      { id: uid(), from: b.id, fromPort: 'out', to: c.id, toPort: 'in' },
    ],
  };
}

async function loadFlows() {
  try {
    const { flows } = await api('/flows');
    known = flows;
    $('flowPick').innerHTML = `<option value="">— flussi salvati —</option>` +
      flows.map((f) => `<option value="${f.id}" ${f.id === flowId ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  } catch { /* la lista è un comfort, non una dipendenza */ }
  renderFlowState();
}

/**
 * Cosa sta guardando l'utente: un flusso salvato, lo stesso flusso con
 * un nome nuovo (cioè un rinomina in attesa), o una bozza che vive solo
 * nel browser. Prima non lo diceva nessuno e "Salva" dopo aver cambiato
 * nome rinominava il vecchio invece di crearne uno, perdendolo.
 */
function renderFlowState() {
  const el = $('flowState');
  const saved = known.find((f) => f.id === flowId);
  const name = $('flowName').value.trim();
  $('delFlow').disabled = !saved;
  $('dupFlow').disabled = !graph.nodes.length;

  if (!flowId) {
    el.className = 'state off';
    el.textContent = 'bozza, mai salvata';
  } else if (saved && saved.name !== name) {
    el.className = 'state off';
    el.textContent = `Salva rinomina «${saved.name}»`;
  } else if (dirty) {
    el.className = 'state off';
    el.textContent = 'modifiche non salvate';
  } else {
    el.className = 'state';
    el.textContent = 'salvato';
  }
}

/**
 * Chiede conferma prima di buttare via una tela non salvata. Il flusso
 * di partenza non conta come lavoro: chiedere anche per quello sarebbe
 * una finestra che si impara a chiudere senza leggere.
 */
function mayLeave() {
  if (!dirty) return true;
  return confirm('Quello che hai sulla tela non è salvato. Lo abbandono?');
}

async function openFlow(id) {
  const flow = await api(`/flow/${id}`);
  graph = flow.graph;
  flowId = flow.id;
  $('flowName').value = flow.name;
  run = null;
  selected = null;
  panelFor = null;
  dirty = false;
  persistLocal();
  await loadFlows();
  draw();
  estimate();
  fit();
}

/** Scrive su Firestore. Senza `id` nasce un flusso nuovo. */
async function storeFlow(id) {
  const saved = await api('/flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id || null, name: $('flowName').value.trim() || 'Flusso senza nome', graph }),
  });
  flowId = saved.id;
  dirty = false;
  persistLocal();
  await loadFlows();
  return saved;
}

function wireTop() {
  $('flowName').addEventListener('input', renderFlowState);
  $('flowName').addEventListener('change', () => { persistLocal(); renderFlowState(); });

  $('flowPick').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) return renderFlowState();
    if (!mayLeave()) {
      e.target.value = flowId || '';
      return;
    }
    try {
      await openFlow(id);
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('newFlow').addEventListener('click', () => {
    if (!mayLeave()) return;
    flowId = null;
    run = null;
    selected = null;
    panelFor = null;
    $('flowName').value = 'Flusso senza nome';
    seed();
    dirty = false;
    persistLocal();
    loadFlows();
    draw();
    estimate();
    fit();
    toast('Tela nuova. Il flusso di prima resta nell’elenco.');
  });

  $('dupFlow').addEventListener('click', async () => {
    try {
      // Senza id il server ne crea uno nuovo: è il modo di partire da un
      // flusso che funziona senza rischiare di sovrascriverlo.
      await storeFlow(null);
      toast('Copia salvata come flusso a parte');
    } catch (e) {
      toast(e.message, true);
    }
  });

  $('delFlow').addEventListener('click', async () => {
    const saved = known.find((f) => f.id === flowId);
    if (!saved) return;
    if (!confirm(`Elimino «${saved.name}»? I contenuti che ha prodotto restano nello storage.`)) return;
    try {
      await api(`/flow/${flowId}`, { method: 'DELETE' });
      // La tela resta com'è: il flusso non c'è più su Firestore ma il
      // lavoro è ancora lì, e "Salva" lo ricrea da capo se serve.
      flowId = null;
      dirty = true;
      persistLocal();
      await loadFlows();
      toast('Flusso eliminato');
    } catch (e) {
      toast(e.message, true);
    }
  });

  $('save').addEventListener('click', async () => {
    try {
      const before = known.find((f) => f.id === flowId);
      const saved = await storeFlow(flowId);
      toast(before && before.name !== saved.name ? `Rinominato in «${saved.name}»` : 'Flusso salvato');
    } catch (e) {
      toast(e.message, true);
    }
  });

  $('run').addEventListener('click', startRun);
}

/** Ogni modifica: si ridisegna, si salva la bozza e si rifà il preventivo. */
let estimateTimer = null;
function changed(options = {}) {
  dirty = true;
  renderFlowState();
  persistLocal();
  renderNodes();
  if (!options.keepPanel) renderPanel();
  else {
    // Il pannello si ridisegna comunque: cambiando livello compaiono e
    // spariscono campi. Si conserva però il fuoco, o scrivere diventa
    // impossibile.
    const active = document.activeElement;
    const key = active && active.dataset ? active.dataset.key : null;
    const start = active && active.selectionStart;
    renderPanel();
    if (key) {
      const again = $('panel').querySelector(`[data-key="${key}"]`);
      if (again && again.focus) {
        again.focus();
        if (start != null && again.setSelectionRange) {
          try { again.setSelectionRange(start, start); } catch { /* non tutti i campi lo supportano */ }
        }
      }
    }
  }
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(estimate, 450);
}

async function estimate() {
  try {
    budget = await api('/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph }),
    });
  } catch (e) {
    budget = null;
  }
  renderCost();
  renderNodes();
}

function renderCost() {
  const el = $('cost');
  if (!budget) return (el.textContent = '');
  const problems = budget.problems || [];
  const out = Object.entries(budget.outputs || {}).reduce((max, [, n]) => Math.max(max, n), 0);

  if (problems.length) {
    el.className = 'cost warn';
    el.innerHTML = `<b>${problems.length}</b> da sistemare · ${esc(problems[0])}`;
    el.title = problems.join('\n');
    return;
  }
  el.className = 'cost';
  el.title = '';
  el.innerHTML = budget.usd > 0
    ? `stima <b>${money(budget.usd)}</b> · fino a ${out} uscite`
    : `<b>gratis</b> · fino a ${out} uscite`;
}

/* ------------------------------------------------------------------ */
/* Esecuzione                                                          */
/* ------------------------------------------------------------------ */

async function startRun() {
  if (budget && budget.problems && budget.problems.length) {
    return toast(budget.problems[0], true);
  }
  const spend = budget ? budget.usd : 0;
  if (spend > 0 && !confirm(`Questa run costa circa ${money(spend)}. Procedo?`)) return;

  $('run').disabled = true;
  try {
    const started = await api('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph, flowId, name: $('flowName').value }),
    });
    run = { id: started.runId, nodes: {}, status: 'running', createdAt: new Date().toISOString() };
    openConsole();
    toast('Run avviata');
    poll(started.runId);
  } catch (e) {
    toast(e.message, true);
    $('run').disabled = false;
  }
}

function poll(runId) {
  clearInterval(poller);
  poller = setInterval(async () => {
    try {
      const state = await api(`/run/${runId}`);
      run = { id: runId, ...state };
      renderNodes();
      renderConsole();

      const waiting = Object.entries(state.nodes || {}).find(([, s]) => s.status === 'waiting' && s.awaiting);
      if (waiting) showGate(runId, waiting[0], waiting[1].awaiting);
      else if ($('gate').hidden === false) $('gate').hidden = true;

      if (['done', 'error', 'cancelled'].includes(state.status)) {
        clearInterval(poller);
        $('run').disabled = false;
        renderConsole();
        await loadStorage();
        if (state.status === 'done') toast(`Fatto. Speso ${money(state.spentUsd || 0)}`);
        else if (state.status === 'error') toast(state.error || 'Run fallita', true);
        else toast('Run annullata');
      }
    } catch (e) {
      clearInterval(poller);
      $('run').disabled = false;
      toast(e.message, true);
    }
  }, 1300);
}

/* --- il diario della run -------------------------------------------- */

// Le categorie del diario. I nodi si chiamano col loro nome, le fasi
// interne con quello che sono: così si vede a colpo d'occhio se il tempo
// se ne va su fal, su ffmpeg o nell'attesa che tu approvi.
const STEP_LABEL = {
  source: 'Source', wizard: 'Wizard', text: 'Testo', merge: 'Merge', save: 'Save',
  testo: 'Testo', lettura: 'Lettura', piano: 'Piano', taglio: 'Preparazione',
  immagine: 'Immagini', video: 'Video', attesa: 'Aspetta te', errore: 'Errori', altro: 'Altro',
};
const RUN_TITLE = { running: 'In corso', waiting: 'Aspetta te', done: 'Finita', error: 'Fallita', cancelled: 'Fermata' };

let consoleTasks = [];
let consoleTicker = null;

function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
const clockOf = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour12: false });

function openConsole() {
  $('console').hidden = false;
  $('console').classList.remove('fold');
  renderConsole();
  // Il cronometro vive nel browser e non nel polling: aggiornare i
  // secondi non deve costare una richiesta al server.
  clearInterval(consoleTicker);
  consoleTicker = setInterval(tickConsole, 500);
}

function wireConsole() {
  $('consoleFold').addEventListener('click', () => {
    const el = $('console');
    el.classList.toggle('fold');
    $('consoleFold').textContent = el.classList.contains('fold') ? '+' : '–';
  });
  $('consoleStop').addEventListener('click', async () => {
    // A run finita lo stesso tasto chiude il pannello: quando non c'è
    // più niente da fermare, l'unica cosa che vuoi è toglierlo di mezzo.
    if (!run || !['running', 'waiting'].includes(run.status)) {
      $('console').hidden = true;
      clearInterval(consoleTicker);
      return;
    }
    if (!confirm('Fermo la run? Quello che è già generato resta, il resto no.')) return;
    await api(`/run/${run.id}/cancel`, { method: 'POST' }).catch((e) => toast(e.message, true));
  });
}

function renderConsole() {
  if (!run) return;
  const el = $('console');
  el.hidden = false;

  const live = ['running', 'waiting'].includes(run.status);
  consoleTasks = (run.tasks || []).slice().reverse();
  const totals = run.totals || {};

  $('consoleDot').className = `dot ${
    run.status === 'running' ? 'run' : run.status === 'waiting' ? 'wait' : run.status === 'error' ? 'bad' : ''
  }`;
  $('consoleTitle').textContent = RUN_TITLE[run.status] || 'Run';
  $('consoleSpent').textContent = run.spentUsd > 0 ? `speso ${money(run.spentUsd)}` : 'niente speso';

  const clock = $('consoleClock');
  if (live) clock.dataset.since = run.createdAt || new Date().toISOString();
  else {
    delete clock.dataset.since;
    clock.textContent = run.finishedAt && run.createdAt
      ? dur(Date.parse(run.finishedAt) - Date.parse(run.createdAt))
      : '';
  }

  const stop = $('consoleStop');
  stop.textContent = live ? 'Stop' : 'Chiudi';
  stop.className = `btn small ${live ? 'danger' : 'ghost'}`;

  $('consoleSteps').innerHTML = Object.entries(totals)
    .filter(([, t]) => t.count)
    .map(([step, t]) => `
      <span class="chip ${t.running ? 'on' : ''}" data-step="${esc(step)}" data-base="${t.ms || 0}">
        <b>${esc(STEP_LABEL[step] || step)}</b> ${t.count}${t.running ? ` · ${t.running} in corso` : ''}
        <span class="t">${dur(t.ms || 0)}</span>
      </span>`)
    .join('');

  const log = $('consoleLog');
  const keep = log.scrollTop;
  log.innerHTML = consoleTasks.length
    ? consoleTasks.map((t) => {
        const running = t.state === 'running';
        const cls = running ? 'live' : t.state === 'error' ? 'bad' : '';
        const time = running
          ? `<span class="t" data-since="${t.at}"></span>`
          : `<span class="t">${t.ms ? dur(t.ms) : clockOf(t.at)}</span>`;
        return `<li class="${cls}">
          <div class="what"><span class="tag">${esc(STEP_LABEL[t.step] || t.step)}</span>${esc(t.label)}</div>
          ${time}
          ${t.note ? `<div class="sub">${esc(t.note)}</div>` : ''}
        </li>`;
      }).join('')
    : '<li class="empty">Ancora niente da raccontare.</li>';
  log.scrollTop = keep;

  tickConsole();
  if (!live) clearInterval(consoleTicker);
}

/** I secondi che scorrono: solo testo, nessun DOM ricostruito. */
function tickConsole() {
  const now = Date.now();
  document.querySelectorAll('#console [data-since]').forEach((el) => {
    el.textContent = dur(now - Date.parse(el.dataset.since));
  });
  // Il tempo di una categoria è quello già finito più quello dei lavori
  // ancora aperti, altrimenti una fase lunga sembra ferma a zero.
  document.querySelectorAll('#console .chip[data-step]').forEach((chip) => {
    const step = chip.dataset.step;
    const open = consoleTasks
      .filter((t) => t.step === step && t.state === 'running')
      .reduce((sum, t) => sum + (now - Date.parse(t.at)), 0);
    chip.querySelector('.t').textContent = dur(Number(chip.dataset.base || 0) + open);
  });
}

/* --- la pausa di approvazione -------------------------------------- */

let gateFor = null;
let gatePicked = new Set();

function showGate(runId, nodeId, anchors) {
  if (gateFor && gateFor.runId === runId && gateFor.nodeId === nodeId && !$('gate').hidden) return;
  gateFor = { runId, nodeId, anchors };
  gatePicked = new Set(anchors.map((a) => a.assetId));
  $('gate').hidden = false;
  renderGate();
}

function renderGate() {
  const { anchors } = gateFor;
  $('gateHint').textContent = `${anchors.length} proposte · scarta quelle che non convincono, i video partono solo dalle approvate`;
  $('gateList').innerHTML = anchors.map((a) => `
    <div class="an ${gatePicked.has(a.assetId) ? 'on' : ''}" data-id="${a.assetId}">
      <img loading="lazy" src="${API}/asset/${a.assetId}/file" alt="">
      <div class="cap"><b>${esc(a.label)}</b><span>${esc(a.instruction)}</span></div>
    </div>`).join('');
  $('gateList').querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      gatePicked.has(id) ? gatePicked.delete(id) : gatePicked.add(id);
      renderGate();
    });
  });
  $('gateCost').textContent = `${gatePicked.size} video da generare`;
}

function wireGate() {
  $('gateAll').addEventListener('click', () => {
    const all = gatePicked.size === gateFor.anchors.length;
    gatePicked = all ? new Set() : new Set(gateFor.anchors.map((a) => a.assetId));
    renderGate();
  });
  $('gateGo').addEventListener('click', async () => {
    if (!gatePicked.size) return toast('Non hai approvato niente', true);
    $('gate').hidden = true;
    await api(`/run/${gateFor.runId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: gateFor.nodeId, accepted: [...gatePicked] }),
    }).catch((e) => toast(e.message, true));
  });
  $('gateStop').addEventListener('click', async () => {
    $('gate').hidden = true;
    await api(`/run/${gateFor.runId}/cancel`, { method: 'POST' }).catch(() => {});
  });
}

boot();
