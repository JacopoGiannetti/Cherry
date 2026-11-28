// SOLO SVILUPPO (VITE_MOCK=1): il giro dell'app per registrare il video dimostrativo.
// Parte toccando il titolo "Cookbook": da lì l'app si guida da sola, con tempi precisi.
// Non entra mai nel sito pubblicato (main.tsx lo carica solo in sviluppo con VITE_MOCK).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
const click = async (sel: string, wait: number) => { $(sel)?.click(); await sleep(wait); };
const glide = async (top: number, wait: number) => { window.scrollTo({ top, behavior: 'smooth' }); await sleep(wait); };
const card = (n: number) => `.grid > div:nth-child(${n}) a.card`;

let running = false;
async function tour() {
  if (running) return;
  running = true;
  await sleep(1600);
  await glide(300, 1000);
  await glide(0, 1100);
  // Una ricetta TikTok: la pagina, la spesa, il cook mode che manda in loop ogni step.
  await click(card(2), 1900);
  await glide(330, 1500);
  await click('.cart-btn', 1500);
  await click('.recipe__go', 5200);
  await click('.cook__next', 3400);
  await click('.cook__next', 3400);
  await click('[aria-label="Close cook mode"]', 1100);
  await click('.recipe__bar [aria-label="Back"]', 1500);
  // Una ricetta Instagram: le foto degli step.
  await click(card(3), 1900);
  await click('.recipe__go', 2600);
  await click('.cook__next', 2400);
  await click('.cook__frame', 1900);
  await click('.cook__zoom', 800);
  await click('[aria-label="Close cook mode"]', 1100);
  await click('.recipe__bar [aria-label="Back"]', 1500);
  // La lista della spesa, con gli ingredienti arrivati dalla ricetta.
  await click('a.tab[href$="/list"]', 2600);
  await glide(260, 1400);
  await glide(0, 900);
  await click('a.tab:first-of-type', 2000);
  running = false;
}

document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.bar__title')) void tour();
});
export {};
