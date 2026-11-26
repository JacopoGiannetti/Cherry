// Le sezioni della landing, condivise tra la pagina in produzione (main.tsx) e quella nuova in prova (next.tsx).
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react';
import '../styles/tokens.css';
import '../styles/landing.css';
import { Icon, Logo } from '../components/Icon';
import { LoopDemo } from '../components/LoopDemo';
import { getPlans, money, perMonth, savePct, type Plan } from '../lib/plans';
import { onUser } from '../lib/auth';
import { openCookiePrefs } from '../lib/meta';

export const START = '/app/start';
export const APP = '/app/';

/** "Sign in" porta alla pagina di login (email e password, o Google). Chi non ha l'account passa da "Create account". */
export function SignIn({ className }: { className?: string }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => onUser((u) => setSignedIn(!!u)), []);
  if (signedIn) return <a href={APP} className={className}>Open Cherry</a>;
  return <a href="/app/signin" className={className}>Sign in</a>;
}

export function Nav() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`nav ${solid ? 'nav--solid' : ''}`}>
      <a href="#top" aria-label="Cherry home"><Logo size={32} /></a>
      <nav className="nav__links" aria-label="Main">
        <a href="#how">How it works</a>
        <a href="#cook">Cook mode</a>
        <a href="#pricing">Pricing</a>
        <a href="#faq">FAQ</a>
      </nav>
      <div className="nav__cta">
        <SignIn className="nav__signin" />
        <a href={START} className="btn btn--ink btn--sm">Create account</a>
      </div>
    </header>
  );
}

/** Un piatto nella riga del titolo: sta accanto alle parole, non sopra. */
export function Plate({ name, className, delay = 0 }: { name: string; className: string; delay?: number }) {
  return (
    <motion.span className={`plate ${className}`} aria-hidden="true"
      initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 120, damping: 14, delay }}>
      <img src={`/assets/food/${name}.jpg`} alt="" />
    </motion.span>
  );
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const down = useTransform(scrollYProgress, [0, 1], [0, 70]);
  return (
    <section className="hero" id="top" ref={ref}>
      <div className="hero__stage">
        <motion.h1 className="display shout hero__title" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}>
          <span>Saved it. <Plate name="v-tacos" className="hero__p" delay={0.25} /></span>
          <span><Plate name="v-ramen" className="hero__p" delay={0.35} /> Now <em>cook</em> it.</span>
        </motion.h1>
        <motion.div className="hero__phone" style={{ y: down }} initial={{ opacity: 0, y: 60, rotate: 8 }} animate={{ opacity: 1, rotate: 4 }} transition={{ type: 'spring', stiffness: 70, damping: 15, delay: 0.2 }}>
          <LoopDemo />
        </motion.div>
      </div>
      <div className="hero__foot">
        <motion.p className="hero__lead" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          Paste any TikTok or Instagram recipe. Cherry writes it out and builds a cook mode where every step <b>loops its exact moment of the video.</b>
        </motion.p>
        <motion.div className="hero__cta" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <a href={START} className="btn btn--cherry btn--xl">Turn a video into dinner <Icon name="next" stroke={2.6} /></a>
          <span className="hero__sub">Takes two minutes. Try it on your own recipe first.</span>
        </motion.div>
      </div>
    </section>
  );
}

export function Marquee() {
  const words = ['Paste the link', 'Cherry watches', 'You cook', 'No rewinding', 'Every amount', 'One grocery list'];
  const row = [...words, ...words];
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee__track">
        {row.map((w, i) => <span key={i}>{w}<i /></span>)}
      </div>
    </div>
  );
}

export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.62, delay, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

export function Problem() {
  const pains = [
    ['Rewind. Pause. Rewind.', 'With sticky hands, on a phone that keeps locking.'],
    ['Amounts? In the comments.', 'Or nowhere. A splash of this, a bit of that.'],
    ['Hundreds saved. A handful cooked.', 'Your saved folder is a graveyard of good intentions.'],
  ];
  return (
    <section className="problem">
      <Reveal><p className="eyebrow">The problem</p></Reveal>
      <Reveal delay={0.05}><h2 className="display problem__title">Recipe videos are made for scrolling, <em>not for cooking.</em></h2></Reveal>
      <ol className="problem__list">
        {pains.map(([t, b], i) => (
          <Reveal key={t} delay={0.08 * i}>
            <li><span className="num">{String(i + 1).padStart(2, '0')}</span><div><b>{t}</b><p>{b}</p></div></li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

export function TypingLink() {
  const full = 'tiktok.com/@pastanight/video/7431…';
  const [n, setN] = useState(0);
  const [phase, setPhase] = useState<'type' | 'work' | 'done'>('type');
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.4 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!inView) return;
    if (phase === 'type') {
      if (n < full.length) { const t = setTimeout(() => setN(n + 1), 42); return () => clearTimeout(t); }
      const t = setTimeout(() => setPhase('work'), 350); return () => clearTimeout(t);
    }
    if (phase === 'work') { const t = setTimeout(() => setPhase('done'), 2000); return () => clearTimeout(t); }
    const t = setTimeout(() => { setN(0); setPhase('type'); }, 4200); return () => clearTimeout(t);
  }, [n, phase, inView]);
  return (
    <div className="typing" ref={ref}>
      <div className="typing__field"><span>{full.slice(0, n)}<i className="caret" /></span><span className={`typing__go ${phase !== 'type' ? 'on' : ''}`}><Icon name="next" stroke={2.6} /></span></div>
      <div className="typing__out">
        <AnimatePresence mode="wait">
          {phase === 'work' && (
            <motion.div key="w" className="typing__work" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="spinner" /> Watching the whole video
            </motion.div>
          )}
          {phase === 'done' && (
            <motion.div key="d" className="typing__result" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}>
              <span className="plate"><img src="/assets/food/v-gnocchi.jpg" alt="" /></span>
              <div><b>Baked Gnocchi alla Sorrentina</b><small>9 ingredients · 4 video steps · 25 min</small></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function How() {
  const steps = [
    ['Copy the link', 'On TikTok or Instagram, tap Share, then Copy link. Any recipe, any creator.'],
    ['Paste it in Cherry', 'Cherry watches the entire video and writes every ingredient and step, with amounts.'],
    ['Cook, step by step', 'Each step loops its moment of the video. Big text, screen stays awake, hands stay free.'],
  ];
  return (
    <section className="how" id="how">
      <div className="how__head">
        <Reveal><p className="eyebrow">How it works</p></Reveal>
        <Reveal delay={0.05}><h2 className="display section-title">From scroll to stove in <em>under a minute.</em></h2></Reveal>
      </div>
      <Reveal className="how__demo"><TypingLink /></Reveal>
      <ol className="how__steps">
        {steps.map(([t, b], i) => (
          <Reveal key={t} delay={0.08 * i}>
            <li><span className="num">{i + 1}</span><b>{t}</b><p>{b}</p></li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

export function Cook() {
  return (
    <section className="cookm" id="cook">
      <div className="cookm__inner">
        <div className="cookm__copy">
          <Reveal><p className="eyebrow">Cook mode</p></Reveal>
          <Reveal delay={0.05}><h2 className="display section-title">The video repeats the part <em>you're on.</em></h2></Reveal>
          <ul className="cookm__list">
            {[
              ['Synced to the second', 'Every step is matched to its exact moment. It loops until you move on.'],
              ['Read it from across the counter', 'Big type, one step at a time, screen stays awake.'],
              ['Amounts for your table', 'Cooking for two or six? Every quantity rescales.'],
              ['The creator stays in the frame', 'Videos play in the official TikTok and Instagram players.'],
            ].map(([t, b], i) => (
              <Reveal key={t} delay={0.06 * i}><li><b>{t}</b><p>{b}</p></li></Reveal>
            ))}
          </ul>
        </div>
        <Reveal className="cookm__demo" delay={0.1}>
          <LoopDemo />
          <div className="stamp cookm__stamp">
            <svg viewBox="0 0 100 100" aria-hidden="true"><defs><path id="lc" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" /></defs>
              <text fontSize="9.2" fontWeight="700" letterSpacing="2.2"><textPath href="#lc">ON REPEAT · ON REPEAT · ON REPEAT · </textPath></text></svg>
            <b><Icon name="refresh" size={26} stroke={2.6} /></b>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function More() {
  return (
    <section className="more">
      <Reveal className="more__tile more__tile--list">
        <p className="eyebrow">Groceries</p>
        <h3 className="display">One list, sorted <em>by aisle.</em></h3>
        <ul className="checks">
          {[['Potato gnocchi', '1 lb', true], ['Cherry tomatoes', '2 cups', true], ['Fresh mozzarella', '8 oz', false], ['Basil', '1 bunch', false]].map(([n, q, on], i) => (
            <motion.li key={String(n)} className={on ? 'on' : ''} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 + i * 0.08 }}>
              <span className="cb">{on && <Icon name="check" size={13} stroke={3.4} />}</span><span>{n}</span><em>{q}</em>
            </motion.li>
          ))}
        </ul>
      </Reveal>
      <Reveal className="more__tile more__tile--book" delay={0.08}>
        <p className="eyebrow">Cookbook</p>
        <h3 className="display">Everything you saved, finally <em>findable.</em></h3>
        <div className="more__plates" aria-hidden="true">
          {['v-pizza', 'v-udon', 'v-curry', 'v-fettuccine', 'v-teriyaki', 'v-beans'].map((p) => <span key={p} className="plate"><img src={`/assets/food/${p}.jpg`} alt="" loading="lazy" /></span>)}
        </div>
      </Reveal>
    </section>
  );
}

export function Pricing() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  useEffect(() => { getPlans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);
  const yearly = plans?.find((p) => p.plan === 'yearly');
  const monthly = plans?.find((p) => p.plan === 'monthly');
  const save = yearly && monthly ? savePct(yearly.amount, monthly.amount) : 0;
  return (
    <section className="pricing" id="pricing">
      <Reveal><p className="eyebrow">Pricing</p></Reveal>
      <Reveal delay={0.05}><h2 className="display section-title">Less than one <em>takeout order.</em></h2></Reveal>
      <div className="price-cards">
        <Reveal className="price price--best">
          <span className="price__tag">Most popular{save > 0 ? ` · Save ${save}%` : ''}</span>
          <b>Yearly</b>
          <div className="price__amount num">
            {monthly && <s className="price__was">{money(monthly.amount, monthly.currency)}</s>}
            {yearly ? <>{money(perMonth(yearly.amount), yearly.currency)}<small>/month</small></> : '—'}
          </div>
          <p>{yearly ? <>Billed <b>{money(yearly.amount, yearly.currency)}</b> once a year.</> : 'Billed once a year.'}{yearly?.trialDays ? ` ${yearly.trialDays} days free.` : ''}</p>
          <a href={START} className="btn btn--cherry btn--block">Get yearly</a>
        </Reveal>
        <Reveal className="price" delay={0.08}>
          <b>Monthly</b>
          <div className="price__amount num">{monthly ? <>{money(monthly.amount, monthly.currency)}<small>/month</small></> : '—'}</div>
          <p>Billed monthly. Cancel anytime.</p>
          <a href={START} className="btn btn--ghost btn--block">Get monthly</a>
        </Reveal>
      </div>
      <p className="pricing__fine">Unlimited recipes · Cook mode · Grocery lists · Cancel in two taps</p>
    </section>
  );
}

const FAQ = [
  ['Does it work on my phone?', 'Yes. Cherry works on iPhone, Android, tablets and computers. Add it to your Home Screen for one-tap access, and your cookbook syncs everywhere.'],
  ['Which videos work?', 'Public recipe videos from TikTok and Instagram Reels. If the video shows the cooking, Cherry can turn it into steps. On TikTok each step loops its moment automatically; on Instagram each step shows its timestamp next to the official player.'],
  ['How long does it take?', 'Usually under a minute. Cherry watches the whole video, so a longer recipe takes a bit longer. You can keep browsing while it works.'],
  ['Do creators get credit?', 'Always. Cook mode plays the original video in the official TikTok or Instagram player, with the creator’s name, and every recipe links back to the post.'],
  ['What if a recipe has no amounts?', 'Cherry estimates sensible amounts from what it sees in the video and the caption, and you can scale servings up or down.'],
  ['How do I cancel?', 'In Cherry, go to You, then Manage or cancel. Two taps, no emails, no calls.'],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="faq" id="faq">
      <Reveal><h2 className="display section-title">Questions, <em>answered.</em></h2></Reveal>
      <div className="faq__list">
        {FAQ.map(([q, a], i) => (
          <div key={q} className={`faq__item ${open === i ? 'open' : ''}`}>
            <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{q}<Icon name="plus" stroke={2.4} /></button>
            <AnimatePresence initial={false}>
              {open === i && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
                  <p>{a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Closer() {
  return (
    <section className="closer">
      <div className="closer__plates" aria-hidden="true">
        <span className="plate"><img src="/assets/food/v-kungpao.jpg" alt="" loading="lazy" /></span>
        <span className="plate"><img src="/assets/food/v-grilledcheese.jpg" alt="" loading="lazy" /></span>
      </div>
      <Reveal>
        <h2 className="display shout closer__title">Tonight, cook the one <em>you saved.</em></h2>
        <a href={START} className="btn btn--cherry btn--xl">Start cooking <Icon name="next" stroke={2.6} /></a>
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <Logo size={26} />
      <nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:support@hellocherry.app">Support</a><button className="footer__link" onClick={openCookiePrefs}>Do Not Sell or Share My Personal Information</button><SignIn /></nav>
      <small>© {new Date().getFullYear()} Cherry is a product of <b>Jacopo Giannetti</b>, Italy. Not affiliated with TikTok or Instagram.</small>
    </footer>
  );
}

export function StickyCta() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > window.innerHeight * 0.9);
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.a href={START} className="sticky-cta btn btn--cherry" initial={{ y: 90, x: '-50%' }} animate={{ y: 0, x: '-50%' }} exit={{ y: 90, x: '-50%' }} transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
          Start cooking <Icon name="next" stroke={2.6} />
        </motion.a>
      )}
    </AnimatePresence>
  );
}

