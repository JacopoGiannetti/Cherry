import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'wouter';
import '../../styles/flow-next.css';
import { Icon } from '../../components/Icon';
import { CookMode } from '../../components/CookMode';
import { GoogleButton } from '../../components/GoogleButton';
import { DEMO_STEPS } from '../../components/LoopDemo';
import { useSession } from '../../lib/store';
import { metaForServer, once, track } from '../../lib/meta';
import { saveProfile, sendRegistrationEvent } from '../../lib/api';
import { DEMO_URL, derive, loadFunnel, saveFunnel, TAKEOUT_USD, type Funnel } from '../../lib/funnel';
import { journey } from '../../lib/journey';
import { isPreview } from '../../lib/preview';
import demo from '../../lib/demo.json';
import type { Recipe } from '../../lib/types';

// Il percorso nuovo (in prova, /app/start-next). Ogni schermata è una scena con
// una sua idea visiva, non un testo con un bottone. Niente soldi da pagare,
// prezzi o checkout prima del paywall.
//
//  1 hello     la presentazione: i piatti in orbita, "Saved it. Now cook it."
//  2 saved     lo specchio: la tua cartella dei salvati, che si allontana
//  3 cooked      …in cui si accendono solo quelle cucinate
//  4 reveal      …e diventa buia: "1 su N". Non è colpa tua.
//  5 blockers  la causa: il video che torna indietro, i commenti di tutti
//  6 magic     la soluzione: un video si apre in passi, davanti a te (poi la provi)
//  7 week      l'impegno: apparecchi la settimana, un piatto per sera
//  8 receipt   il costo di oggi: lo scontrino dell'asporto che si allunga
//  9 menu      il futuro: il menu della tua settimana, con i tuoi numeri
// 10 chart     la prova con i suoi numeri: il ritmo di oggi contro quello con Cherry
// 11 team      chi c'è dietro: una nota firmata dal team
// 12 account   salva la settimana (→ paywall)

const ALL = ['hello', 'saved', 'cooked', 'reveal', 'blockers', 'magic', 'week', 'receipt', 'menu', 'chart', 'team', 'account'] as const;
type Step = typeof ALL[number];
const MIRROR: Step[] = ['saved', 'cooked', 'reveal'];
const DARK: Step[] = ['hello', 'reveal', 'menu'];
const DEMO: Partial<Funnel> = { recipe: demo as unknown as Recipe, url: DEMO_URL, demo: true };
type Set = (patch: Partial<Funnel> | ((f: Funnel) => Partial<Funnel>)) => void;
const EASE = [0.2, 0.8, 0.2, 1] as const;

// Solo le foto nuove (public/assets/food/v-*.jpg), le stesse della landing.
const PLATES = ['v-pizza', 'v-ramen', 'v-tacos', 'v-teriyaki', 'v-curry', 'v-udon', 'v-dumplings', 'v-fettuccine', 'v-kungpao', 'v-gnocchi', 'v-beans', 'v-grilledcheese'];
const plate = (name: string) => `/assets/food/${name}.jpg`;

const SAVED_STOPS = [10, 20, 30, 50, 75, 100, 150, 200, 300, 500];
const SAVED_COLS = [3, 4, 5, 7, 9, 10, 12, 12, 12, 12];
const savedLabel = (n: number) => (n >= 300 ? 'A full-blown archive.' : n >= 100 ? 'A serious collection.' : n >= 30 ? 'A healthy habit.' : 'Just getting started.');

const BLOCKERS = [
  { id: 'rewind', label: 'I keep rewinding with messy hands', fix: 'Every step loops by itself. Hands stay in the bowl.' },
  { id: 'fast', label: 'The video goes way too fast', fix: 'One step at a time. It waits for you.' },
  { id: 'amounts', label: 'Amounts are missing or buried in comments', fix: 'Every ingredient written out, with amounts.' },
  { id: 'lost', label: 'I can never find the recipe again', fix: 'One cookbook, searchable, on every device.' },
  { id: 'shopping', label: 'I never have the ingredients', fix: 'One tap turns recipes into a grocery list by aisle.' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK = [
  { plate: 'v-tacos', dish: 'Street tacos' },
  { plate: 'v-ramen', dish: 'Miso ramen' },
  { plate: 'v-curry', dish: 'Chickpea curry' },
  { plate: 'v-udon', dish: 'Stir-fried udon' },
  { plate: 'v-pizza', dish: 'Margherita pizza' },
  { plate: 'v-dumplings', dish: 'Crispy dumplings' },
  { plate: 'v-teriyaki', dish: 'Teriyaki salmon bowl' },
];
const DAY_ORDER = [0, 2, 4, 1, 3, 6, 5];
const daysOf = (f: Funnel) => (f.days ? f.days : DAY_ORDER.slice(0, f.nights)).slice().sort((a, b) => a - b);

function answersOf(f: Funnel) {
  return { saved: f.saved, cooked: f.cooked, blockers: f.blockers, household: f.household, nights: f.nights, takeout: f.takeout, paste: f.recipe ? 'demo' : undefined };
}

/** Un numero che sale fino al suo valore, una volta. */
function useCount(to: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}

export function OnboardingNext() {
  const [, navigate] = useLocation();
  const { user, entitled, ready } = useSession();
  const preview = useMemo(() => isPreview(), []);
  const STEPS = ALL;
  const [f, setF] = useState<Funnel>(() => loadFunnel());
  const [step, setStep] = useState(() => {
    const want = preview ? new URLSearchParams(location.search).get('step') : null;
    return Math.max(0, STEPS.indexOf(want as Step));
  });
  const [dir, setDir] = useState(1);
  const [cooking, setCooking] = useState(false);
  const name = STEPS[step];
  const scene = MIRROR.includes(name) ? 'mirror' : name;

  useEffect(() => { saveFunnel(f); }, [f]);
  useEffect(() => { void journey('step', { id: `next.${name}`, answers: answersOf(f) }); }, [name]);
  const set: Set = (patch) => setF((cur) => ({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }));

  useEffect(() => {
    if (!ready || !user || preview) return;
    if (entitled) { navigate('/'); return; }
    if (name === 'account') finish();
  }, [ready, user, entitled, name]);

  function finish() {
    if (!user) return;
    saveProfile({
      firstName: user.displayName?.split(' ')[0],
      household: String(f.household), cookingFrequency: String(f.nights),
      goals: f.blockers, saveHabit: `${f.cooked}/${f.saved}`, completed: true,
    }).catch(() => {});
    void journey('account', { answers: answersOf(f) });
    if (!preview) {
      void once(`reg-${user.uid}`, async () => {
        const id = `reg_${user.uid}`;
        const meta = await metaForServer(id);
        if (meta) void sendRegistrationEvent(meta, id);
        return track('CompleteRegistration', { status: true, content_name: 'Cherry account' }, id);
      });
    }
    navigate(preview ? '/join?preview' : '/join');
  }

  const go = (n: number) => { setDir(n > step ? 1 : -1); setStep(Math.max(0, Math.min(STEPS.length - 1, n))); };
  const next = () => go(step + 1);

  return (
    <div className={`flow nx ${DARK.includes(name) ? 'flow--dark' : ''}`}>
      <header className="flow__top">
        {name === 'hello' ? <span className="nx-top__gap" /> : (
          <>
            <button className="flow__back" onClick={() => go(step - 1)} aria-label="Back"><Icon name="back" /></button>
            <div className="flow__bar" role="progressbar" aria-valuenow={step} aria-valuemax={STEPS.length - 1}>
              <i style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
            </div>
          </>
        )}
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={scene}
          className="flow__body"
          initial={{ opacity: 0, x: dir * 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -28 }}
          transition={{ duration: 0.26, ease: EASE }}
        >
          {scene === 'hello' && <Hello onNext={next} />}
          {scene === 'mirror' && <Mirror phase={name as 'saved' | 'cooked' | 'reveal'} f={f} set={set} onNext={next} />}
          {scene === 'blockers' && <Blockers f={f} set={set} onNext={next} />}
          {scene === 'magic' && <Magic f={f} onCook={() => { if (!f.recipe) set(DEMO); setCooking(true); }} onNext={() => { if (!f.recipe) set(DEMO); next(); }} />}
          {scene === 'week' && <Week f={f} set={set} onNext={next} />}
          {scene === 'receipt' && <Receipt f={f} set={set} onNext={next} />}
          {scene === 'menu' && <Menu f={f} onNext={next} />}
          {scene === 'chart' && <Chart f={f} onNext={next} />}
          {scene === 'team' && <Team onNext={() => { if (!f.recipe) set(DEMO); next(); }} />}
          {scene === 'account' && <Account f={f} signedInAs={preview && user ? (user.displayName || user.email || 'you') : null} onContinue={finish} />}
        </motion.section>
      </AnimatePresence>

      {cooking && f.recipe && (
        <CookMode recipe={f.recipe} limit={2} onClose={() => setCooking(false)} onUnlock={() => { setCooking(false); go(STEPS.indexOf('week')); }} />
      )}
      {preview && <span className="nx-preview">Preview · {step + 1}/{STEPS.length} · {name}</span>}
    </div>
  );
}

// ---------- Pezzi comuni ----------

function Head({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <>
      <p className="eyebrow flow__kicker">{kicker}</p>
      <h1 className="display nx-q">{children}</h1>
    </>
  );
}

function Cta({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flow__cta">
      <button className="btn btn--cherry btn--block" onClick={onClick} disabled={disabled}>{children}</button>
    </div>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  const bump = (n: number) => { navigator.vibrate?.(6); onChange(Math.max(min, Math.min(max, value + n))); };
  return (
    <div className="nx-stepper" role="group" aria-label={label}>
      <button onClick={() => bump(-1)} disabled={value <= min} aria-label="Less">−</button>
      <div className="nx-stepper__value">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value} className="num" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} transition={{ duration: 0.16 }}>
            {value}{value >= max && max > 7 ? '+' : ''}
          </motion.span>
        </AnimatePresence>
      </div>
      <button onClick={() => bump(1)} disabled={value >= max} aria-label="More">+</button>
    </div>
  );
}

// 1 ---------- La presentazione
function Hello({ onNext }: { onNext: () => void }) {
  const ring = PLATES.slice(0, 10);
  const line = (text: React.ReactNode, delay: number) => (
    <span className="nx-mask"><motion.span initial={{ y: '112%' }} animate={{ y: 0 }} transition={{ duration: 0.8, delay, ease: EASE }}>{text}</motion.span></span>
  );
  return (
    <div className="nx-hello">
      <div className="nx-orbit" aria-hidden="true">
        <div className="nx-orbit__ring">
          {ring.map((p, i) => (
            <span key={p} className="nx-orbit__seat" style={{ ['--a' as any]: `${i * 36}deg` }}>
              <motion.span className="plate" initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 150, damping: 14, delay: 0.1 + i * 0.07 }}>
                <img src={plate(p)} alt="" />
              </motion.span>
            </span>
          ))}
        </div>
        <motion.div className="nx-orbit__core" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.75 }}>
          <img src="/assets/mascot.png" alt="" />
          <span className="display">Cherry</span>
        </motion.div>
      </div>
      <div className="nx-hello__copy">
        <h1 className="display shout nx-hello__title">
          {line('Saved it.', 1.0)}
          {line(<>Now <em>cook</em> it.</>, 1.14)}
        </h1>
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.7, duration: 0.5 }}>
          Cherry turns the recipe videos you save into dinners you actually make.
        </motion.p>
      </div>
      <motion.div className="flow__cta" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.0, duration: 0.5, ease: EASE }}>
        <button className="btn btn--cherry btn--block" onClick={onNext}>Get started <Icon name="next" stroke={2.6} /></button>
      </motion.div>
    </div>
  );
}

// 2·3·4 ---------- Lo specchio: una sola griglia che resta, tre momenti
const TILES = Array.from({ length: 144 }, (_, i) => PLATES[((i % 12) * 5 + Math.floor(i / 12) * 7) % PLATES.length]);

function litCells(cols: number, cooked: number) {
  const rows = Math.max(2, Math.floor(cols * 0.8));
  const cells: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(r * 12 + c);
  let s = 7;
  for (let i = cells.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return new Set(cells.slice(0, Math.min(cooked, cells.length)));
}

function Mirror({ phase, f, set, onNext }: { phase: 'saved' | 'cooked' | 'reveal'; f: Funnel; set: Set; onNext: () => void }) {
  const idx = Math.max(0, SAVED_STOPS.indexOf(f.saved));
  const cols = SAVED_COLS[idx];
  const lit = useMemo(() => litCells(cols, f.cooked), [cols, f.cooked]);
  const d = derive(f);
  const more = f.saved > 150 ? f.saved - 144 : 0;
  return (
    <div className={`nx-mirror nx-mirror--${phase}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={phase} className="nx-mirror__head" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
          {phase === 'saved' && <Head kicker="First, your saved folder">How many recipes are <em>sitting</em> in there?</Head>}
          {phase === 'cooked' && <Head kicker={`Out of ${d.savedLabel} saved`}>How many did you <em>cook</em> last month?</Head>}
          {phase === 'reveal' && <RevealTitle f={f} />}
        </motion.div>
      </AnimatePresence>

      <div className="nx-grid" aria-hidden="true">
        <div className="nx-grid__in" style={{ transform: `scale(${3 / cols})` }}>
          {TILES.map((p, i) => (
            <span key={i} className={`nx-tile ${phase !== 'saved' && !lit.has(i) ? 'is-dim' : ''} ${phase !== 'saved' && lit.has(i) ? 'is-lit' : ''}`}>
              <img src={plate(p)} alt="" />
            </span>
          ))}
        </div>
        {more > 0 && <span className="nx-grid__more">+{f.saved >= 500 ? '350' : more} more</span>}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={phase} className="nx-mirror__ctl" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
          {phase === 'saved' && (
            <>
              <div className="nx-readout">
                <span className="num">{f.saved >= 500 ? '500+' : f.saved}</span>
                <em className="voice">{savedLabel(f.saved)}</em>
              </div>
              <input className="nx-ruler" type="range" min={0} max={SAVED_STOPS.length - 1} step={1} value={idx}
                onChange={(e) => { navigator.vibrate?.(4); set({ saved: SAVED_STOPS[Number(e.target.value)] }); }} aria-label="Saved recipes" />
              <div className="nx-ruler__ends"><span>A few</span><span>Lost count</span></div>
            </>
          )}
          {phase === 'cooked' && (
            <>
              <Stepper value={f.cooked} min={0} max={12} onChange={(n) => set({ cooked: n })} label="Recipes cooked last month" />
              <p className="nx-hint">{f.cooked === 0 ? 'Zero is a very common answer.' : f.cooked <= 2 ? 'No judgment. Most people say this.' : 'Better than most.'}</p>
            </>
          )}
          {phase === 'reveal' && (
            <motion.p className="nx-reveal__body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.6 }}>
              <b>It's not you.</b> Recipe videos are made to be <em className="voice">watched</em>, not followed: too fast, no amounts, gone the moment you scroll.
            </motion.p>
          )}
        </motion.div>
      </AnimatePresence>

      <Cta onClick={onNext}>{phase === 'saved' ? "That's about right" : phase === 'cooked' ? 'Continue' : "So what's stopping me?"}</Cta>
    </div>
  );
}

function RevealTitle({ f }: { f: Funnel }) {
  const d = derive(f);
  const n = useCount(d.oneIn && d.oneIn > 1 ? d.oneIn : f.saved >= 500 ? 500 : f.saved, 1000);
  return (
    <>
      <p className="eyebrow flow__kicker">Your saved folder</p>
      {d.oneIn && d.oneIn > 1
        ? <h1 className="display nx-reveal__title">You cook about <span className="num">1 in {n}</span></h1>
        : <h1 className="display nx-reveal__title">You cooked <span className="num">{f.cooked} of {n}{f.saved >= 500 ? '+' : ''}</span></h1>}
    </>
  );
}

// 5 ---------- La causa: il video che torna indietro
const COMMENTS = ['wait, how much butter??', 'too fast, I give up', 'recipe in the comments?', 'what was step 2 again', 'paused it six times', 'anyone have the amounts?'];

function RewindScene() {
  const [n, setN] = useState(3);
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 1700); return () => clearInterval(t); }, []);
  const shown = [0, 1].map((k) => ({ id: n + k, text: COMMENTS[(n + k) % COMMENTS.length] }));
  return (
    <div className="nx-rewind" aria-hidden="true">
      <div className="nx-rewind__video">
        <img src="/assets/food/sauce.jpg" alt="" />
        <motion.span key={n} className="nx-rewind__flash" initial={{ opacity: 0.95, scale: 0.7, rotate: 0 }} animate={{ opacity: 0, scale: 1.25, rotate: -150 }} transition={{ duration: 0.9, ease: 'easeOut' }}>
          <Icon name="refresh" size={26} stroke={2.6} />
        </motion.span>
        <span className="nx-rewind__bar"><motion.i key={n} initial={{ width: `${40 + ((n * 37) % 50)}%` }} animate={{ width: [`${8 + ((n * 13) % 20)}%`, `${40 + (((n + 1) * 37) % 50)}%`] }} transition={{ duration: 1.7, times: [0.12, 1], ease: 'linear' }} /></span>
      </div>
      <div className="nx-rewind__side">
        <span className="nx-rewind__count"><span className="num">{n}</span> rewinds</span>
        <div className="nx-rewind__bubbles">
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map((c) => (
              <motion.span key={c.id} layout className="nx-bubble" initial={{ opacity: 0, y: 14, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.35, ease: EASE }}>{c.text}</motion.span>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Blockers({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  const toggle = (id: string) => {
    navigator.vibrate?.(6);
    set((cur) => ({ blockers: cur.blockers.includes(id) ? cur.blockers.filter((b) => b !== id) : [...cur.blockers, id] }));
  };
  return (
    <>
      <Head kicker="Sound familiar?">What gets <em>in the way?</em></Head>
      <RewindScene />
      <div className="nx-picks">
        {BLOCKERS.map((b, i) => {
          const on = f.blockers.includes(b.id);
          return (
            <motion.button key={b.id} className={`nx-pick ${on ? 'on' : ''}`} onClick={() => toggle(b.id)} aria-pressed={on}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + 0.05 * i, duration: 0.3 }}>
              <span>{b.label}</span>
              <i>{on && <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 16 }}><Icon name="check" size={14} stroke={3.2} /></motion.span>}</i>
            </motion.button>
          );
        })}
      </div>
      <Cta onClick={onNext} disabled={!f.blockers.length}>{f.blockers.length ? 'Continue' : 'Pick at least one'}</Cta>
    </>
  );
}

// 6 ---------- La soluzione: un video si apre in passi
const CAPTIONS = ['Paste any recipe link.', 'Cherry watches the whole video.', 'And writes it out, step by step.', 'Every step loops its own moment.'];

function Magic({ f, onCook, onNext }: { f: Funnel; onCook: () => void; onNext: () => void }) {
  const [phase, setPhase] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    setPhase(0);
    const t = [setTimeout(() => setPhase(1), 1000), setTimeout(() => setPhase(2), 2900), setTimeout(() => setPhase(3), 4300)];
    return () => t.forEach(clearTimeout);
  }, [run]);
  const mine = BLOCKERS.filter((b) => f.blockers.includes(b.id)).slice(0, 2);
  const open = phase >= 2;
  return (
    <>
      <Head kicker="Here's the fix">From video to <em>dinner.</em></Head>
      <div className="nx-magic" aria-hidden="true">
        <motion.div className="nx-link" key={`l${run}`} initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <Icon name="link" size={15} stroke={2.4} />
          <span>tiktok.com/@pastanight/video/7431…</span>
          <i className={phase >= 2 ? 'done' : ''}>{phase >= 2 ? <Icon name="check" size={13} stroke={3.4} /> : phase === 1 ? <span className="spinner" /> : <Icon name="next" size={13} stroke={3} />}</i>
        </motion.div>

        <div className="nx-magic__stage">
          <motion.div className="nx-reel" animate={open ? { x: '-84%', scale: 0.62, rotate: -7 } : { x: '0%', scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 120, damping: 17 }}>
            <img src="/assets/food/serve.jpg" alt="" />
            <span className="nx-reel__ui"><i /><i /><i /></span>
            <span className="nx-reel__cap"><b /><b /></span>
            {phase === 1 && <motion.span className="nx-reel__scan" initial={{ top: '0%' }} animate={{ top: ['0%', '100%', '0%', '100%'] }} transition={{ duration: 1.9, ease: 'easeInOut' }} />}
          </motion.div>
          {DEMO_STEPS.map((s, i) => (
            <motion.div key={s.title} className={`nx-step ${phase >= 3 && i === 0 ? 'is-live' : ''}`}
              initial={false}
              animate={open ? { opacity: 1, x: 0, y: i * 62, scale: 1, rotate: i % 2 ? 1.2 : -1.2 } : { opacity: 0, x: -70, y: 96, scale: 0.5, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 170, damping: 18, delay: open ? i * 0.11 : 0 }}>
              <img src={s.img} alt="" />
              <span><small>{s.t}–{s.end}</small><b>{s.title}</b></span>
              {phase >= 3 && i === 0 && <motion.i initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}><Icon name="refresh" size={13} stroke={3} /></motion.i>}
            </motion.div>
          ))}
        </div>

        <div className="nx-magic__cap">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={phase} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>{CAPTIONS[phase]}</motion.p>
          </AnimatePresence>
          <button onClick={() => setRun((r) => r + 1)} aria-label="Replay"><Icon name="refresh" size={15} stroke={2.6} /></button>
        </div>
      </div>
      {mine.length > 0 && (
        <ul className="nx-fixes">
          {mine.map((b, i) => (
            <motion.li key={b.id} initial={{ opacity: 0, x: 14 }} animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: 14 }} transition={{ delay: i * 0.12 }}>
              <s>{b.label}</s><b>{b.fix}</b>
            </motion.li>
          ))}
        </ul>
      )}
      <div className="flow__cta">
        <button className="btn btn--cherry btn--block" onClick={onCook}><Icon name="play" fill="currentColor" size={17} /> Try it on a real recipe</button>
        <button className="flow__link" onClick={onNext}>Skip, keep going</button>
      </div>
    </>
  );
}

// 7 ---------- L'impegno: apparecchi la settimana
function Week({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  const days = daysOf(f);
  const toggle = (i: number) => {
    navigator.vibrate?.(6);
    const nextDays = days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort((a, b) => a - b);
    set({ days: nextDays, nights: Math.max(1, nextDays.length) });
  };
  const n = days.length;
  return (
    <>
      <Head kicker="Now, your week">Which nights do you <em>want</em> to cook?</Head>
      <div className="nx-week" role="group" aria-label="Nights of the week">
        {DAYS.map((d, i) => {
          const on = days.includes(i);
          return (
            <button key={d} className={`nx-day ${on ? 'on' : ''}`} onClick={() => toggle(i)} aria-pressed={on}>
              <span className="nx-day__plate">
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.img key="p" src={plate(WEEK[i].plate)} alt="" initial={{ scale: 0, rotate: -60 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, rotate: 40 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }} />
                  )}
                </AnimatePresence>
                {!on && <Icon name="plus" size={18} stroke={2.2} />}
              </span>
              <b>{d}</b>
            </button>
          );
        })}
      </div>
      <div className="nx-week__sum">
        <span className="num">{n}</span>
        <p><b>night{n === 1 ? '' : 's'} a week</b><span>{Math.round(n * 4.3)} home-cooked dinners a month</span></p>
      </div>
      <div className="seg nx-seg" role="radiogroup" aria-label="Cooking for">
        <span className="seg__label">Cooking for</span>
        {[1, 2, 3, 4, 5].map((k) => (
          <button key={k} role="radio" aria-checked={f.household === k} className={f.household === k ? 'on' : ''} onClick={() => set({ household: k })}>{k === 5 ? '5+' : k}</button>
        ))}
      </div>
      <Cta onClick={onNext} disabled={!n}>{n ? "That's my week" : 'Pick at least one night'}</Cta>
    </>
  );
}

// 8 ---------- Il costo di oggi: lo scontrino
const TAB = ['Delivery', 'Drive-thru', 'Pizza night', '"Just grabbing something"', 'Delivery, again', 'Late-night order', 'Sunday takeout'];

function Receipt({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  const per = f.household * TAKEOUT_USD;
  const month = Math.round((f.takeout * 4.3 * per) / 5) * 5;
  return (
    <>
      <Head kicker="One honest number">How many nights is it <em>takeout</em> right now?</Head>
      <div className="nx-print">
        <span className="nx-print__slot" aria-hidden="true" />
        <div className="nx-receipt">
          <p className="nx-receipt__head">Takeout · this week</p>
          <ul>
            <AnimatePresence initial={false}>
              {Array.from({ length: f.takeout }).map((_, i) => (
                <motion.li key={i} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 30 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.26, ease: EASE }}>
                  <span>{TAB[i]}</span><i /><b>${per}</b>
                </motion.li>
              ))}
            </AnimatePresence>
            {f.takeout === 0 && <li className="is-empty">Nothing here. Nice.</li>}
          </ul>
          <div className="nx-receipt__total">
            <span>A month of this</span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.b key={month} className="num" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} transition={{ duration: 0.18 }}>${month}</motion.b>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className="nx-receipt__ctl">
        <Stepper value={f.takeout} min={0} max={7} onChange={(n) => set({ takeout: n })} label="Takeout nights per week" />
        <p className="nx-hint">Rough estimate: ${TAKEOUT_USD} a person per meal, for {f.household === 5 ? '5+' : f.household}.</p>
      </div>
      <Cta onClick={onNext}>Now show me my week</Cta>
    </>
  );
}

// 9 ---------- Il futuro: il menu della tua settimana
function Menu({ f, onNext }: { f: Funnel; onNext: () => void }) {
  const d = derive(f);
  const days = daysOf(f);
  const dinners = useCount(Math.round(days.length * 4.3), 900);
  const kept = useCount(d.monthly, 1100);
  const money = d.swapped > 0 && d.monthly > 0;
  return (
    <>
      <Head kicker="With Cherry">Your week, <em>on the table.</em></Head>
      <motion.div className="nx-menu" initial={{ opacity: 0, y: 40, rotate: -4 }} animate={{ opacity: 1, y: 0, rotate: -1.2 }} transition={{ type: 'spring', stiffness: 110, damping: 15, delay: 0.1 }}>
        <p className="nx-menu__head"><span>This week's menu</span><em className="voice">for {f.household === 5 ? '5+' : f.household}</em></p>
        <ul>
          {days.map((i, k) => (
            <motion.li key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 + k * 0.09, duration: 0.35 }}>
              <small>{DAYS[i]}</small>
              <em className="voice">{WEEK[i].dish}</em>
              <i />
              <span className="plate"><img src={plate(WEEK[i].plate)} alt="" /></span>
            </motion.li>
          ))}
        </ul>
        <div className="nx-menu__foot">
          <span><b className="num">{dinners}</b>dinners<br />a month</span>
          <span><b className="num">1</b>grocery list<br />by aisle</span>
          {money
            ? <span><b className="num">${kept}</b>kept<br />a month*</span>
            : <span><b className="num">{d.savedLabel}</b>saved recipes<br />in play</span>}
        </div>
      </motion.div>
      <p className="nx-menu__note">Sample dishes. Yours come from the recipes you saved.{money ? ' *Estimate from your answers.' : ''}</p>
      <Cta onClick={onNext}>I want this week</Cta>
    </>
  );
}

// 10 ---------- La prova con i suoi numeri: il ritmo di oggi contro quello con Cherry
// Non è una media degli utenti (non la mostriamo finché non l'abbiamo misurata): le due
// linee sono le SUE risposte, quante ne ha cucinate il mese scorso e quante sere ha scelto.
const CW = 346, CH = 228, CL = 10, CR = 336, CT = 34, CB = 188;
const RAMP = [0, 0.17, 0.42, 0.71, 1];

function curve(pts: [number, number][]) {
  return pts.map(([x, y], i) => {
    if (!i) return `M${x},${y}`;
    const [px, py] = pts[i - 1];
    const mx = (px + x) / 2;
    return `C${mx},${py} ${mx},${y} ${x},${y}`;
  }).join(' ');
}

function Chart({ f, onNext }: { f: Funnel; onNext: () => void }) {
  const days = daysOf(f);
  const goal = Math.round(days.length * 4.3);
  const now = Math.min(f.cooked, goal);
  const gain = Math.max(0, goal - f.cooked);
  const top = Math.max(goal, 4) * 1.12;
  const px = (i: number) => CL + ((CR - CL) * i) / 4;
  const py = (v: number) => CB - ((CB - CT) * v) / top;
  const withCherry = RAMP.map((r, i) => [px(i), py(goal * r)] as [number, number]);
  const today = RAMP.map((_, i) => [px(i), py((now * i) / 4)] as [number, number]);
  const line = curve(withCherry);
  const [done, setDone] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDone(true), 2500); return () => clearTimeout(t); }, []);
  return (
    <>
      <Head kicker="Same saved folder">Now watch it get <em>cooked.</em></Head>
      <div className="nx-chart">
        <div className="nx-chart__legend">
          <span className="is-cherry"><i />With Cherry</span>
          <span><i />Your pace today</span>
        </div>
        <div className="nx-chart__plot">
          <svg viewBox={`0 0 ${CW} ${CH}`} aria-hidden="true">
            <defs>
              <linearGradient id="nxg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#E8334A" stopOpacity=".3" /><stop offset="1" stopColor="#E8334A" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3].map((k) => <line key={k} className="nx-chart__grid" x1={CL} x2={CR} y1={CT + ((CB - CT) * k) / 3} y2={CT + ((CB - CT) * k) / 3} />)}
            <path className="nx-chart__area" d={`${line} L${CR},${CB} L${CL},${CB} Z`} fill="url(#nxg)" />
            <path className="nx-chart__today" d={curve(today)} pathLength={1} />
            <path className="nx-chart__line" d={line} pathLength={1} />
            {['Today', 'Week 1', 'Week 2', 'Week 3', 'Week 4'].map((t, i) => (
              <text key={t} className="nx-chart__x" x={px(i)} y={CH - 12} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{t}</text>
            ))}
          </svg>
          {withCherry.slice(1).map(([x, y], i) => (
            <motion.span key={i} className="plate nx-chart__plate" style={{ left: `${(x / CW) * 100}%`, top: `${(y / CH) * 100}%` }}
              initial={{ scale: 0, rotate: -50 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 1.25 + i * 0.36 }}>
              <img src={plate(WEEK[days[i % Math.max(1, days.length)] ?? i].plate)} alt="" />
            </motion.span>
          ))}
          <motion.span className="nx-chart__tag" style={{ top: `${(py(goal) / CH) * 100}%` }} initial={{ opacity: 0, y: 8, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 2.5, type: 'spring', stiffness: 260, damping: 16 }}>
            <b className="num">{goal}</b> cooked
          </motion.span>
          <motion.span className="nx-chart__tag is-today" style={{ top: `${(py(now) / CH) * 100}%` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}>
            <b className="num">{f.cooked}</b>
          </motion.span>
        </div>
      </div>
      <div className="nx-gain">
        {done ? <Gain n={gain > 0 ? gain : goal} plus={gain > 0} /> : <span className="num nx-gain__n">&nbsp;</span>}
        <motion.p initial={{ opacity: 0, x: 10 }} animate={done ? { opacity: 1, x: 0 } : { opacity: 0, x: 10 }} transition={{ duration: 0.4 }}>
          <b>{gain > 0 ? 'new dishes on your table, every month' : 'home-cooked dinners, every month'}</b>
          <span>Your plan: {days.length} night{days.length === 1 ? '' : 's'} a week, against {f.cooked} cooked last month.</span>
        </motion.p>
      </div>
      <Cta onClick={onNext}>Continue</Cta>
    </>
  );
}

function Gain({ n, plus }: { n: number; plus: boolean }) {
  const v = useCount(n, 900);
  return <span className="num nx-gain__n">{plus ? '+' : ''}{v}</span>;
}

// 11 ---------- Chi c'è dietro: una nota firmata dal team
function Team({ onNext }: { onNext: () => void }) {
  const rules = ['Made for cooking, not for scrolling.', 'Creators always get the credit.', 'Your cookbook, on every device you own.'];
  return (
    <>
      <Head kicker="Who's behind this">A note from <em>the team.</em></Head>
      <motion.div className="nx-letter" initial={{ opacity: 0, y: 36, rotate: 3 }} animate={{ opacity: 1, y: 0, rotate: 1 }} transition={{ type: 'spring', stiffness: 110, damping: 15, delay: 0.1 }}>
        <div className="stamp nx-letter__stamp" aria-hidden="true">
          <svg viewBox="0 0 100 100"><defs><path id="nxc" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" /></defs>
            <text fontSize="7.4" fontWeight="700" letterSpacing="1.1"><textPath href="#nxc">MADE FOR COOKING · NOT FOR SCROLLING · </textPath></text></svg>
          <img src="/assets/mascot.png" alt="" />
        </div>
        <p className="nx-letter__body">A recipe you saved should end up <em>on a plate</em>, not in a folder. That's the whole idea behind Cherry.</p>
        <ul>
          {rules.map((t, i) => (
            <motion.li key={t} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.12 }}>
              <Icon name="check" size={15} stroke={3} />{t}
            </motion.li>
          ))}
        </ul>
        <p className="nx-letter__sign">
          <em className="voice">The Cherry team</em>
          <svg viewBox="0 0 180 14" aria-hidden="true"><motion.path d="M2 9 C 40 2, 70 13, 104 7 S 160 3, 178 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" initial={{ pathLength: 0 } as any} animate={{ pathLength: 1 } as any} transition={{ delay: 1.0, duration: 0.8, ease: 'easeOut' }} /></svg>
        </p>
      </motion.div>
      <Cta onClick={onNext}>Continue</Cta>
    </>
  );
}

// 12 ---------- Salvala
function Account({ f, signedInAs, onContinue }: { f: Funnel; signedInAs: string | null; onContinue: () => void }) {
  const days = daysOf(f);
  return (
    <div className="account nx-account">
      <div className="nx-account__plates" aria-hidden="true">
        {days.map((i, k) => (
          <motion.span key={i} className="plate" initial={{ scale: 0, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 + k * 0.07 }}>
            <img src={plate(WEEK[i].plate)} alt="" />
          </motion.span>
        ))}
      </div>
      <h1 className="display nx-q">Your week is ready. <em>Save it.</em></h1>
      <p className="nx-lead">One account keeps your cookbook and your grocery list in sync on your phone and computer.</p>
      {signedInAs
        ? <button className="btn btn--cherry btn--block nx-account__go" onClick={onContinue}>Continue as {signedInAs.split(' ')[0]}</button>
        : <GoogleButton />}
      <p className="legal">By continuing you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
    </div>
  );
}
