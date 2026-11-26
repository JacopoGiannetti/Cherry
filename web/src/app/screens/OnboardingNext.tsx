import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'wouter';
import '../../styles/flow-next.css';
import { Icon } from '../../components/Icon';
import { CookMode } from '../../components/CookMode';
import { GoogleButton } from '../../components/GoogleButton';
import { EmailAuth } from '../../components/EmailAuth';
import { MagicStage, Orbit, PLATES, plate, SomedayBox } from '../../components/Scenes';
import { useSession } from '../../lib/store';
import { metaForServer, once, track } from '../../lib/meta';
import { saveProfile, sendRegistrationEvent } from '../../lib/api';
import { DEMO_URL, derive, hasFunnel, loadFunnel, saveFunnel, TAKEOUT_USD, type Funnel } from '../../lib/funnel';
import { journey } from '../../lib/journey';
import { isPreview } from '../../lib/preview';
import demo from '../../lib/demo.json';
import type { Recipe } from '../../lib/types';

// L'onboarding (/app/start, dal 26 nov 2026). Ogni schermata è una scena con
// una sua idea visiva, non un testo con un bottone. Niente soldi da pagare,
// prezzi o checkout prima del paywall.
//
//  1 hello     la presentazione: i piatti in orbita, "Saved it. Now cook it."
//  2 saved     lo specchio: i reel salvati cadono nella scatola "Someday"
//  3 cooked      …da cui escono solo quelli cucinati
//  4 reveal      …e diventa buio: "1 su N". Non è colpa tua.
//  5 blockers  la causa: il video che torna indietro, i commenti di tutti
//  6 magic     la soluzione: un video si apre in passi, davanti a te (poi la provi)
//  7 nights    l'impegno: quante sere a settimana, un numero e sette posti a tavola
//  8 receipt   il costo di oggi: lo scontrino dell'asporto che si allunga
//  9 chart     il futuro con i suoi numeri: il ritmo di oggi contro quello con Cherry
// 10 team      chi c'è dietro: una nota firmata dal team
// 11 account   salva il piano (→ paywall)

const ALL = ['hello', 'saved', 'cooked', 'reveal', 'blockers', 'magic', 'nights', 'receipt', 'chart', 'team', 'account'] as const;
type Step = typeof ALL[number];
const MIRROR: Step[] = ['saved', 'cooked', 'reveal'];
const DARK: Step[] = ['hello', 'reveal'];
const DEMO: Partial<Funnel> = { recipe: demo as unknown as Recipe, url: DEMO_URL, demo: true };
type Set = (patch: Partial<Funnel> | ((f: Funnel) => Partial<Funnel>)) => void;
const EASE = [0.2, 0.8, 0.2, 1] as const;

const SAVED_STOPS = [10, 20, 30, 50, 75, 100, 150, 200, 300, 500];
const SAVED_PILE = [4, 7, 10, 14, 18, 22, 27, 31, 36, 40];
const savedLabel = (n: number) => (n >= 300 ? 'A full-blown archive.' : n >= 100 ? 'A serious collection.' : n >= 30 ? 'A healthy habit.' : 'Just getting started.');

const BLOCKERS = [
  { id: 'rewind', label: 'I keep rewinding with messy hands', fix: 'Every step loops by itself. Hands stay in the bowl.' },
  { id: 'fast', label: 'The video goes way too fast', fix: 'One step at a time. It waits for you.' },
  { id: 'amounts', label: 'Amounts are missing or buried in comments', fix: 'Every ingredient written out, with amounts.' },
  { id: 'lost', label: 'I can never find the recipe again', fix: 'One cookbook, searchable, on every device.' },
  { id: 'shopping', label: 'I never have the ingredients', fix: 'One tap turns recipes into a grocery list by aisle.' },
];

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
  // Chi arriva senza risposte parte da 10 salvate: la scatola si riempie mentre sali.
  // (Il default condiviso resta 50, lo usa il percorso in produzione.)
  // La ricetta da provare è sempre la nostra demo: una ricetta rimasta salvata dal percorso di prima
  // (quando si poteva incollare un proprio link) non deve ricomparire qui.
  const [f, setF] = useState<Funnel>(() => {
    const cur = hasFunnel() ? loadFunnel() : { ...loadFunnel(), saved: 10 };
    return cur.recipe && !cur.demo ? { ...cur, recipe: undefined, url: undefined } : cur;
  });
  const [step, setStep] = useState(() => {
    const want = preview ? new URLSearchParams(location.search).get('step') : null;
    return Math.max(0, STEPS.indexOf(want as Step));
  });
  const [dir, setDir] = useState(1);
  const [cooking, setCooking] = useState(false);
  const name = STEPS[step];
  const scene = MIRROR.includes(name) ? 'mirror' : name;

  useEffect(() => { saveFunnel(f); }, [f]);
  // Le scene scure arrivano fino ai bordi: barra di stato e barra del browser prendono
  // il colore della scena, non restano chiare sopra e sotto.
  const dark = DARK.includes(name);
  useEffect(() => {
    const color = dark ? '#1B1313' : name === 'account' ? '#FFFFFF' : '#F4EEE4';
    const meta = document.querySelector('meta[name="theme-color"]');
    const before = { meta: meta?.getAttribute('content') || '', body: document.body.style.background, html: document.documentElement.style.background };
    meta?.setAttribute('content', color);
    document.body.style.background = color;
    document.documentElement.style.background = color;
    return () => { meta?.setAttribute('content', before.meta); document.body.style.background = before.body; document.documentElement.style.background = before.html; };
  }, [dark, name === 'account']);
  useEffect(() => { void journey('step', { id: name, answers: answersOf(f) }); }, [name]);
  const set: Set = (patch) => setF((cur) => ({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }));

  useEffect(() => {
    if (!ready || !user || preview) return;
    if (entitled) { navigate('/'); return; }
    // Anche chi torna dal login con redirect (la pagina riparte dall'inizio) va dritto al paywall.
    if (name === 'account' || (step === 0 && f.recipe)) finish();
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
    <div className={`flow nx ${dark ? 'flow--dark' : ''} ${name === 'account' ? 'nx--white' : ''}`}>
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
          {scene === 'magic' && <Magic f={f} onCook={() => { set(DEMO); setCooking(true); }} onNext={() => { set(DEMO); next(); }} />}
          {scene === 'nights' && <Nights f={f} set={set} onNext={next} />}
          {scene === 'receipt' && <Receipt f={f} set={set} onNext={next} />}
          {scene === 'chart' && <Chart f={f} onNext={next} />}
          {scene === 'team' && <Team onNext={() => { set(DEMO); next(); }} />}
          {scene === 'account' && <Account f={f} signedInAs={preview && user ? (user.displayName || user.email || 'you') : null} onContinue={finish} />}
        </motion.section>
      </AnimatePresence>

      {cooking && f.recipe && (
        <CookMode recipe={f.recipe} limit={2} onClose={() => setCooking(false)} onUnlock={() => { setCooking(false); go(STEPS.indexOf('nights')); }} />
      )}
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
  const line = (text: React.ReactNode, delay: number) => (
    <span className="nx-mask"><motion.span initial={{ y: '112%' }} animate={{ y: 0 }} transition={{ duration: 0.8, delay, ease: EASE }}>{text}</motion.span></span>
  );
  return (
    <div className="nx-hello">
      <Orbit>
        <motion.div className="nx-orbit__core" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.75 }}>
          <img src="/assets/mascot.png" alt="" />
          <span className="display">Cherry</span>
        </motion.div>
      </Orbit>
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

// 2·3·4 ---------- Lo specchio: la scatola "Someday" (components/Scenes), tre momenti
function Mirror({ phase, f, set, onNext }: { phase: 'saved' | 'cooked' | 'reveal'; f: Funnel; set: Set; onNext: () => void }) {
  const idx = Math.max(0, SAVED_STOPS.indexOf(f.saved));
  const d = derive(f);
  return (
    <div className={`nx-mirror nx-mirror--${phase}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={phase} className="nx-mirror__head" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
          {phase === 'saved' && <Head kicker="On Instagram and TikTok">How many recipe videos have you <em>saved?</em></Head>}
          {phase === 'cooked' && <Head kicker={`Out of ${d.savedLabel} saved`}>How many did you <em>cook</em> last month?</Head>}
          {phase === 'reveal' && <RevealTitle f={f} />}
        </motion.div>
      </AnimatePresence>

      <SomedayBox count={SAVED_PILE[idx]} cooked={f.cooked} phase={phase} />

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
function Magic({ f, onCook, onNext }: { f: Funnel; onCook: () => void; onNext: () => void }) {
  const [phase, setPhase] = useState(0);
  const mine = BLOCKERS.filter((b) => f.blockers.includes(b.id)).slice(0, 2);
  return (
    <>
      <Head kicker="Here's the fix">From video to <em>dinner.</em></Head>
      <MagicStage onPhase={setPhase} />
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

// 7 ---------- L'impegno: quante sere, sette posti a tavola
function Nights({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  const n = f.nights;
  const pick = (k: number) => { navigator.vibrate?.(6); set({ nights: k }); };
  return (
    <>
      <Head kicker="Now, your goal">How many nights a week would you like to <em>cook?</em></Head>
      <div className="nx-nights">
        <div className="nx-pips" role="group" aria-label="Nights per week">
          {[1, 2, 3, 4, 5, 6, 7].map((k) => (
            <button key={k} className={k <= n ? 'on' : ''} onClick={() => pick(k)} aria-label={`${k} night${k === 1 ? '' : 's'}`} aria-pressed={k <= n}>
              <AnimatePresence initial={false}>
                {k <= n && <motion.i key="d" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.02 * k }} />}
              </AnimatePresence>
            </button>
          ))}
        </div>
        <Stepper value={n} min={1} max={7} onChange={(v) => set({ nights: v })} label="Nights per week" />
        <p className="nx-hint"><b>{n} night{n === 1 ? '' : 's'} a week</b> is {Math.round(n * 4.3)} home-cooked dinners a month.</p>
      </div>
      <div className="seg nx-seg" role="radiogroup" aria-label="Cooking for">
        <span className="seg__label">Cooking for</span>
        {[1, 2, 3, 4, 5].map((k) => (
          <button key={k} role="radio" aria-checked={f.household === k} className={f.household === k ? 'on' : ''} onClick={() => set({ household: k })}>{k === 5 ? '5+' : k}</button>
        ))}
      </div>
      <Cta onClick={onNext}>That's my goal</Cta>
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
      <Cta onClick={onNext}>See what changes</Cta>
    </>
  );
}

// 9 ---------- Il futuro con i suoi numeri: il ritmo di oggi contro quello con Cherry
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
  const d = derive(f);
  const money = d.swapped > 0 && d.monthly > 0;
  const goal = Math.round(f.nights * 4.3);
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
              <img src={plate(PLATES[i])} alt="" />
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
          <span>Your goal of {f.nights} night{f.nights === 1 ? '' : 's'} a week, against {f.cooked} cooked last month.</span>
        </motion.p>
      </div>
      {money && (
        <motion.p className="nx-kept" initial={{ opacity: 0, y: 10 }} animate={done ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }} transition={{ delay: 0.5, duration: 0.4 }}>
          <b className="num">${d.monthly}</b>
          <span>of takeout you'd cook instead, every month. <i>Estimate from your answers.</i></span>
        </motion.p>
      )}
      <Cta onClick={onNext}>Continue</Cta>
    </>
  );
}

function Gain({ n, plus }: { n: number; plus: boolean }) {
  const v = useCount(n, 900);
  return <span className="num nx-gain__n">{plus ? '+' : ''}{v}</span>;
}

// 10 ---------- Chi c'è dietro: una nota firmata dal team
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

// 11 ---------- Salva il piano
function Account({ f, signedInAs, onContinue }: { f: Funnel; signedInAs: string | null; onContinue: () => void }) {
  const goal = Math.round(f.nights * 4.3);
  const gain = Math.max(0, goal - f.cooked);
  const rows: [string, string][] = [
    [String(f.nights), `night${f.nights === 1 ? '' : 's'} a week`],
    [f.household === 5 ? '5+' : String(f.household), 'at the table'],
    [gain > 0 ? `+${gain}` : String(goal), gain > 0 ? 'new dishes a month' : 'dinners a month'],
  ];
  return (
    <div className="account nx-account">
      <ul className="nx-plan" aria-label="Your plan">
        {rows.map(([n, l], i) => (
          <motion.li key={l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.1, duration: 0.4 }}>
            <b className="num">{n}</b><span>{l}</span>
          </motion.li>
        ))}
      </ul>
      <h1 className="display nx-q">Your plan is ready. <em>Create your account.</em></h1>
      {signedInAs
        ? <button className="btn btn--cherry btn--block nx-account__go" onClick={onContinue}>Continue as {signedInAs.split(' ')[0]}</button>
        : <>
            <EmailAuth mode="signup" />
            <div className="nx-or"><span>or</span></div>
            <GoogleButton />
          </>}
      <p className="legal">By continuing you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
    </div>
  );
}
