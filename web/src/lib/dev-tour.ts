// SOLO SVILUPPO (VITE_MOCK=1): i giri dell'app per registrare le clip della landing.
// Ogni tocco sul titolo "Cookbook" fa partire il capitolo successivo; ogni capitolo
// parte dal ricettario e ci torna. Non entra mai nel sito pubblicato (main.tsx lo
// carica solo in sviluppo con VITE_MOCK).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
const click = async (sel: string, wait: number) => { $(sel)?.click(); await sleep(wait); };
const glide = async (top: number, wait: number) => { window.scrollTo({ top, behavior: 'smooth' }); await sleep(wait); };
const card = (n: number) => `.grid > div:nth-child(${n}) a.card`;
const back = () => click('.recipe__bar [aria-label="Back"]', 1400);
const closeCook = () => click('[aria-label="Close cook mode"]', 1100);

const CHAPTERS: (() => Promise<void>)[] = [
  // Cook mode su un video TikTok: si passa da uno step all'altro, ogni step col suo pezzo di video.
  async () => {
    await click(card(2), 1300);
    await click('.recipe__go', 2600);
    for (let n = 0; n < 4; n++) await click('.cook__next', 1900);
    await closeCook();
    await back();
  },
  // Cook mode su Instagram: si scorre tra gli step, ognuno con le sue foto. Le foto non si aprono.
  async () => {
    await click(card(3), 1300);
    await click('.recipe__go', 1700);
    for (let n = 0; n < 5; n++) {
      const strip = document.querySelectorAll<HTMLElement>('.cook__frames');
      strip.forEach((el) => el.scrollTo({ left: 170, behavior: 'smooth' }));
      await sleep(750);
      await click('.cook__next', 850);
    }
    await closeCook();
    await back();
  },
  // 1. Il ricettario.
  async () => { await sleep(700); await glide(460, 1500); await sleep(300); await glide(0, 1400); },
  // 2. Una ricetta: ingredienti e metodo.
  async () => {
    await click(card(3), 1700);
    await glide(380, 1500); await sleep(500);
    await glide(900, 1700); await sleep(700);
    await glide(0, 1000);
    await back();
  },
  // 5. La spesa: dalla ricetta alla lista, e si spunta.
  async () => {
    await click(card(1), 1500);
    await click('.cart-btn', 1700);
    await back();
    await click('a.tab[href$="/list"]', 1600);
    for (let n = 0; n < 3; n++) { document.querySelectorAll<HTMLElement>('.aisle:not(.aisle--done) .row')[0]?.click(); await sleep(800); }
    await glide(320, 1300);
    await glide(0, 1000);
    await click('a.tab:first-of-type', 1200);
  },
  // 6. Il finale: "Dinner's ready".
  async () => {
    await click(card(2), 1400);
    await click('.recipe__go', 4200);
    for (let n = 0; n < 8; n++) {
      const b = $('.cook__next');
      if (!b) break;
      const last = /Done/.test(b.textContent || '');
      b.click();
      await sleep(last ? 3400 : 650);
      if (last) break;
    }
    await sleep(1400);
    await back();
  },
];

let running = false;
let next = Number(new URLSearchParams(location.search).get('chapter')) || 0;
async function run() {
  if (running) return;
  running = true;
  await sleep(1300);
  await CHAPTERS[next % CHAPTERS.length]();
  next += 1;
  running = false;
}

document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.bar__title')) void run();
});

export {};
