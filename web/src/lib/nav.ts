// Il movimento tra le pagine, con una logica sola: l'app ha una geografia.
//
//   schede (Cookbook, Groceries)   stanno una accanto all'altra  → scorrono di lato
//   una ricetta                    si apre DALLA sua card        → la foto diventa la pagina
//   impostazioni e simili          sono più in profondità        → entrano da destra, indietro escono a destra
//   cook mode, editor              sono fogli sopra la pagina    → salgono dal basso, chiudendo scendono
//
// Indietro è sempre l'esatto contrario dell'andata. Il tipo di passaggio finisce in
// <html data-vt="…"> (View Transitions) o <html data-enter="…"> (browser che non le hanno,
// e passaggi tra schede): gli stili sono in styles/motion.css.
import { flushSync } from 'react-dom';

export type Kind = 'tab-next' | 'tab-prev' | 'open' | 'close' | 'push' | 'pop' | 'up' | 'down' | 'fade';

const TABS = ['/', '/list'];
const isRecipe = (p: string) => /^\/r\/[^/]+$/.test(p);
const isSheet = (p: string) => /^\/cook\//.test(p) || /^\/r\/[^/]+\/edit$/.test(p) || p === '/new';
const level = (p: string) => (TABS.includes(p) ? 0 : isSheet(p) ? 2 : isRecipe(p) || p === '/settings' || p === '/add' ? 1 : -1);

/** Percorso dentro l'app: senza /app e senza query. */
export const pathOf = (p: string) => p.split(/[?#]/)[0].replace(/^\/app(?=\/|$)/, '') || '/';

export function kindFor(from: string, to: string): Kind {
  if (TABS.includes(from) && TABS.includes(to)) return TABS.indexOf(to) > TABS.indexOf(from) ? 'tab-next' : 'tab-prev';
  const a = level(from), b = level(to);
  if (a < 0 || b < 0) return 'fade';
  if (isSheet(to) && !isSheet(from)) return 'up';
  if (isSheet(from) && !isSheet(to)) return 'down';
  if (isRecipe(to) && from === '/') return 'open';
  if (isRecipe(from) && to === '/') return 'close';
  return b >= a ? 'push' : 'pop';
}

/** Da dove si è, che aspetto ha "indietro". */
const backKind = (from: string): Kind => (isSheet(from) ? 'down' : isRecipe(from) ? 'close' : level(from) < 0 ? 'fade' : 'pop');

const SLOW = (() => {
  try {
    const q = new URLSearchParams(location.search).get('slow');
    if (q) sessionStorage.setItem('cherry.slow', q);
    return Number(sessionStorage.getItem('cherry.slow')) || 1;
  } catch { return 1; }
})();

const root = () => document.documentElement;
const startVT = () => (document as any).startViewTransition?.bind(document) as
  | ((cb: () => Promise<void> | void) => { finished: Promise<void>; skipTransition?: () => void })
  | undefined;

/** La card della ricetta che si apre o si chiude: è lei che diventa (o torna da) la pagina. */
function markHero(path: string) {
  const id = (path.match(/^\/r\/([^/]+)$/) || [])[1];
  if (!id) return;
  document.querySelector(`a.card[href$="/r/${CSS.escape(id)}"] .card__img`)?.setAttribute('data-hero', '');
}
const clearHero = () => document.querySelectorAll('[data-hero]').forEach((el) => el.removeAttribute('data-hero'));

/** Le foto visibili della pagina nuova, decodificate: la transizione non parte con buchi grigi. */
async function imagesReady(limit = 150) {
  const h = innerHeight;
  const imgs = [...document.querySelectorAll<HTMLImageElement>('.shell img')].filter((img) => {
    const r = img.getBoundingClientRect();
    return r.bottom > -40 && r.top < h + 40 && r.width > 0;
  }).slice(0, 12);
  if (!imgs.length) return;
  await Promise.race([
    Promise.all(imgs.map((img) => { img.loading = 'eager'; return img.decode().catch(() => {}); })),
    new Promise((r) => setTimeout(r, limit)),
  ]);
}

/** Senza View Transitions (o tra schede): la pagina nuova entra dalla sua direzione. */
let enterTimer = 0;
function enter(kind: Kind, update: () => void) {
  root().dataset.enter = kind;
  update();
  clearTimeout(enterTimer);
  enterTimer = window.setTimeout(() => { delete root().dataset.enter; }, 520);
}

function run(kind: Kind, from: string, to: string | null, update: () => Promise<void> | void) {
  const start = startVT();
  const tabs = kind === 'tab-next' || kind === 'tab-prev';
  // Tra le schede la barra in basso deve restare viva (la pillola scorre): niente foto della pagina.
  if (!start || tabs) return enter(kind, () => { void update(); });

  root().dataset.vt = kind;
  if (kind === 'open' && to) markHero(to);
  // Se il browser non sta disegnando (app in secondo piano) la transizione non parte:
  // dopo 300 ms la pagina cambia lo stesso. Un cambio pagina non si perde mai.
  let ran = false;
  const vt = start(async () => {
    if (ran) return;
    ran = true;
    await update();
    if (kind === 'close') markHero(from);
    if (kind === 'open' || kind === 'close') await imagesReady();
  });
  // Solo in sviluppo: /app/?slow=8 rallenta i passaggi di 8 volte, per guardarli fotogramma per fotogramma.
  if (import.meta.env.DEV && SLOW > 1) (vt as any).ready?.then(() => document.getAnimations().forEach((an) => { an.playbackRate = 1 / SLOW; })).catch(() => {});
  const done = () => { if (root().dataset.vt === kind) delete root().dataset.vt; clearHero(); };
  vt.finished.then(done, done);
  // Una transizione saltata (app in secondo piano) rifiuta anche `ready`: non è un errore.
  (vt as any).ready?.catch(() => {});
  setTimeout(() => { if (!ran) { ran = true; vt.skipTransition?.(); void update(); } }, 300);
}

/** Cambio pagina dell'app (lo usa il router). */
export function transition(from: string, to: string, update: () => void) {
  const a = pathOf(from), b = pathOf(to);
  if (a === b) return update();
  run(kindFor(a, b), a, b, () => flushSync(update));
}

// "Indietro" vero (anche lo swipe di iOS): la pagina dove si torna riprende dalla posizione di prima.
let popped = false;
if (typeof window !== 'undefined') addEventListener('popstate', () => { popped = true; });
export function takePopped() { const p = popped; popped = false; return p; }

/** Indietro dai pulsanti dell'app: come history.back(), ma percorrendo l'andata al contrario. */
export function goBack() {
  const from = pathOf(location.pathname);
  run(backKind(from), from, null, async () => {
    const moved = new Promise<void>((r) => {
      const t = setTimeout(r, 400);
      addEventListener('popstate', () => { clearTimeout(t); r(); }, { once: true });
    });
    history.back();
    await moved;
    // Il router si aggiorna sul popstate: un giro per lasciargli disegnare la pagina.
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => {});
  });
}
