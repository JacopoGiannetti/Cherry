import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useScroll, useTransform } from 'motion/react';
import { Icon } from '../components/Icon';
import { MagicStage, Orbit, SomedayBox } from '../components/Scenes';
import { Closer, Cook, Faq, Footer, Marquee, More, Reveal, SignIn, START } from './sections';
// Dopo sections (che porta tokens.css e landing.css): queste regole devono vincere.
import '../styles/landing-next.css';

// La landing (dal 26 nov 2026). Stesse scene dell'onboarding (i piatti in orbita,
// la scatola "Someday", il video che si apre in passi): chi arriva dal sito e chi arriva
// dalle ads vede lo stesso mondo. Le sezioni che non cambiano vengono da sections.tsx.

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** La barra in alto: larga e trasparente sopra l'hero, si stringe in una pillola mentre scorri. */
export function Nav({ home = true }: { home?: boolean }) {
  // Sulla home i titoletti scorrono alla sezione; dalle altre pagine riportano alla home, a quel punto.
  const to = (id: string) => (home ? `#${id}` : `/#${id}`);
  const ref = useRef<HTMLElement>(null);
  // Sul telefono i titoletti stanno in un menu che si apre dalla barra.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let raf = 0;
    let theme = '';
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const p = Math.min(1, Math.max(0, window.scrollY / 180));
        ref.current?.style.setProperty('--p', p.toFixed(3));
        if (home) {
          // Sopra l'hero (scuro) la barra del browser e il rimbalzo in cima sono scuri anche loro.
          const hero = document.getElementById('top');
          const dark = !!hero && window.scrollY < hero.offsetHeight - 70;
          const color = dark ? '#1B1313' : '#F4EEE4';
          if (theme !== color) {
            theme = color;
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
            document.documentElement.style.background = color;
          }
        }
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => { window.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
  }, []);
  return (
    <header className={`lnav ${home ? '' : 'lnav--paper'}`} ref={ref}>
      <a href={home ? '#top' : '/'} className="lnav__logo" aria-label="Cherry home">
        <img src="/assets/mascot.png" alt="" />
        <span className="display">Cherry</span>
      </a>
      <nav className="lnav__links" aria-label="Main">
        <a href={to('how')}>How it works</a>
        <a href={to('cook')}>Cook mode</a>
        <a href="/pricing" aria-current={home ? undefined : 'page'}>Pricing</a>
        <a href={to('faq')}>FAQ</a>
      </nav>
      <div className="lnav__cta">
        <SignIn className="lnav__signin" />
        <a href={START} className="btn btn--cherry btn--sm">Get started</a>
        <button type="button" className="lnav__menu" aria-label={open ? 'Close menu' : 'Menu'} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? 'close' : 'aisle'} size={20} stroke={2.4} />
        </button>
      </div>
      {open && (
        <nav className="lnav__sheet" aria-label="Menu" onClick={() => setOpen(false)}>
          <a href={to('how')}>How it works</a>
          <a href={to('cook')}>Cook mode</a>
          <a href="/pricing">Pricing</a>
          <a href={to('faq')}>FAQ</a>
          <SignIn />
        </nav>
      )}
    </header>
  );
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const rotate = useTransform(scrollYProgress, [0, 1], [0, 70]);
  const lift = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const line = (text: React.ReactNode, delay: number) => (
    <span className="nx-mask"><motion.span initial={{ y: '112%' }} animate={{ y: 0 }} transition={{ duration: 0.9, delay, ease: EASE }}>{text}</motion.span></span>
  );
  return (
    <section className="lhero" id="top" ref={ref}>
      <div className="lhero__in">
        <motion.div className="lhero__orbit" style={{ rotate, y: lift }}>
          <Orbit>
            <motion.div className="nx-orbit__core" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.75 }}>
              <img src="/assets/mascot.png" alt="" />
            </motion.div>
          </Orbit>
        </motion.div>
        <div className="lhero__text">
          <h1 className="display shout lhero__title">
            {line('Saved it.', 0.35)}
            {line(<>Now <em>cook</em> it.</>, 0.5)}
          </h1>
          <motion.p className="lhero__lead" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.0, duration: 0.5 }}>
            Paste any TikTok or Instagram recipe. Cherry writes it out, with every amount, and builds a cook mode. On TikTok videos, every step <b>loops its exact moment of the video.</b>
          </motion.p>
          <motion.div className="lhero__cta" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.15, duration: 0.5 }}>
            <a href={START} className="btn btn--cherry btn--xl">Turn a video into dinner <Icon name="next" stroke={2.6} /></a>
            <span>Takes two minutes. Try a recipe before you sign up.</span>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

const STOPS = [10, 20, 30, 50, 75, 100, 150, 200, 300, 500];
const PILE = [4, 7, 10, 14, 18, 22, 27, 31, 36, 40];
const PAINS = [
  ['Rewind. Pause. Rewind.', 'With sticky hands, on a phone that keeps locking.'],
  ['Amounts? In the comments.', 'Or nowhere. A splash of this, a bit of that.'],
  ['Hundreds saved. A handful cooked.', 'The saved folder is where good dinners go to wait.'],
];

/** Il problema, da toccare: la scatola si riempie da sola quando la vedi, poi il righello è tuo. */
function Someday() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-25% 0px' });
  const touched = useRef(false);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let i = 0;
    const t = setInterval(() => {
      if (touched.current || i >= 6) { clearInterval(t); return; }
      i += 1; setIdx(i);
    }, 260);
    return () => clearInterval(t);
  }, [inView]);
  const n = STOPS[idx];
  return (
    <section className="lsome" id="problem">
      <div className="lsome__copy">
        <Reveal><p className="eyebrow">The problem</p></Reveal>
        <Reveal delay={0.05}><h2 className="display section-title">You saved it for <em>someday.</em></h2></Reveal>
        <Reveal delay={0.1}><p className="lsome__lead">Recipe videos are made for scrolling, not for cooking. Too fast, no amounts, gone the moment you swipe. So they pile up.</p></Reveal>
        <div className="lsome__ctl">
          <div className="nx-readout">
            <span className="num">{n >= 500 ? '500+' : n}</span>
            <em className="voice">recipe videos, saved and waiting</em>
          </div>
          <input className="nx-ruler" type="range" min={0} max={STOPS.length - 1} step={1} value={idx} aria-label="Saved recipe videos"
            onChange={(e) => { touched.current = true; setIdx(Number(e.target.value)); }} />
          <div className="nx-ruler__ends"><span>Drag it: how many have you saved?</span><span>Lost count</span></div>
        </div>
      </div>
      <div className="lsome__box" ref={ref}><SomedayBox count={inView ? PILE[idx] : 0} cooked={0} phase="saved" /></div>
      <ol className="lsome__pains">
        {PAINS.map(([t, b], i) => (
          <Reveal key={t} delay={0.08 * i}><li><span className="num">{String(i + 1).padStart(2, '0')}</span><b>{t}</b><p>{b}</p></li></Reveal>
        ))}
      </ol>
    </section>
  );
}

const HOW = [
  ['Copy the link', 'On TikTok or Instagram, tap Share, then Copy link. Any recipe, any creator.'],
  ['Cherry watches it', 'The whole video. Every ingredient and step gets written out, with amounts.'],
  ['You cook, step by step', 'Big text, screen awake, hands free. On TikTok videos each step loops its moment.'],
];

/** Come funziona, mostrato: il video si apre in passi in loop; i tre punti si accendono mentre scendi. */
function How() {
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const inView = useInView(ref, { margin: '-20% 0px' });
  const [active, setActive] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const items = list.current ? [...list.current.children] as HTMLElement[] : [];
        const line = window.innerHeight * 0.6;
        let k = 0;
        items.forEach((el, i) => { if (el.getBoundingClientRect().top < line) k = i; });
        setActive(k);
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, []);
  return (
    <section className="lhow" id="how">
      <div className="lhow__stage" ref={ref}><MagicStage play={inView} loop /></div>
      <div className="lhow__copy">
        <Reveal><p className="eyebrow">How it works</p></Reveal>
        <Reveal delay={0.05}><h2 className="display section-title">From scroll to stove in <em>under a minute.</em></h2></Reveal>
        <ol className="lhow__steps" ref={list}>
          {HOW.map(([t, b], i) => (
            <li key={t} className={i <= active ? 'on' : ''}>
              <span className="num">{i + 1}</span>
              <div><b>{t}</b><p>{b}</p></div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Someday />
        <How />
        <Cook />
        <More />
        <Faq />
        <Closer />
      </main>
      <Footer />
    </>
  );
}

