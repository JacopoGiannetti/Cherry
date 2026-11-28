// Passaggi tra pagine fluidi: ogni cambio pagina (avanti E indietro) passa dalle
// View Transitions, e la "foto" della nuova pagina si scatta solo quando le sue
// immagini sono pronte. Prima l'indietro era un taglio secco e le foto delle card
// comparivano un attimo dopo, come se si ricaricassero.
import { flushSync } from 'react-dom';

const startVT = () => (document as any).startViewTransition?.bind(document) as
  | ((cb: () => Promise<void> | void) => { finished: Promise<void> })
  | undefined;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Le immagini visibili della pagina nuova, decodificate (al massimo 220 ms di attesa). */
async function imagesReady(limit = 220) {
  const h = innerHeight;
  const imgs = [...document.querySelectorAll<HTMLImageElement>('.shell img')].filter((img) => {
    const r = img.getBoundingClientRect();
    return r.bottom > -40 && r.top < h + 40 && r.width > 0;
  }).slice(0, 12);
  if (!imgs.length) return;
  await Promise.race([
    Promise.all(imgs.map((img) => {
      img.loading = 'eager';
      return img.decode().catch(() => {});
    })),
    new Promise((r) => setTimeout(r, limit)),
  ]);
}

/** Esegue il cambio pagina dentro una transizione (se il browser la sa fare). */
export function transition(update: () => void) {
  const start = startVT();
  if (!start || reduced()) return update();
  // Se il browser non disegna (scheda in secondo piano) la transizione non parte mai:
  // dopo 300 ms si cambia pagina lo stesso, senza animazione. Il cambio pagina non si perde mai.
  let ran = false;
  const vt = start(async () => {
    if (ran) return;
    ran = true;
    flushSync(update);
    await imagesReady();
  });
  setTimeout(() => { if (!ran) { ran = true; (vt as any).skipTransition?.(); update(); } }, 300);
}

// "Indietro" vero (anche lo swipe di iOS): la pagina dove si torna riprende dalla posizione di prima.
let popped = false;
if (typeof window !== 'undefined') addEventListener('popstate', () => { popped = true; });
export function takePopped() { const p = popped; popped = false; return p; }

/**
 * Indietro dai pulsanti dell'app: come history.back(), ma con la transizione
 * (la foto della ricetta torna nella sua card). Lo swipe di iOS ha già la sua animazione.
 */
export function goBack() {
  const start = startVT();
  if (!start || reduced()) { history.back(); return; }
  let ran = false;
  const vt = start(async () => {
    if (ran) return;
    ran = true;
    const moved = new Promise<void>((r) => {
      const t = setTimeout(r, 400);
      addEventListener('popstate', () => { clearTimeout(t); r(); }, { once: true });
    });
    history.back();
    await moved;
    // wouter si aggiorna sul popstate: un giro per lasciargli disegnare la pagina.
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => {});
    await imagesReady();
  });
  setTimeout(() => { if (!ran) { ran = true; (vt as any).skipTransition?.(); history.back(); } }, 300);
}
