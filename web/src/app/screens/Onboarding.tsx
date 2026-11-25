import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'wouter';
import { Icon, Logo } from '../../components/Icon';
import { CookMode } from '../../components/CookMode';
import { GoogleButton } from '../../components/GoogleButton';
import { LoopDemo } from '../../components/LoopDemo';
import { useSession } from '../../lib/store';
import { signInWithGoogle } from '../../lib/firebase';
import { metaForServer, once, track } from '../../lib/meta';
import { getPreview, saveProfile, sendRegistrationEvent, startPreview } from '../../lib/api';
import { DEMO_URL, derive, HOME_USD, loadFunnel, saveFunnel, TAKEOUT_USD, type Funnel } from '../../lib/funnel';
import { extractLink, minutes } from '../../lib/kitchen';
import { journey } from '../../lib/journey';
import demo from '../../lib/demo.json';
import type { Recipe } from '../../lib/types';

// Il funnel: ogni schermata usa i numeri che l'utente ha appena dato, e
// prima di chiedere qualsiasi cosa gli fa trovare pronta UNA SUA ricetta.
// Al paywall arriva con la sua cena in mano.
//
//  1 saved     quante ricette hai salvato            (il mucchio)
//  2 cooked    quante ne hai cucinate                (il vuoto)
//  3 reveal    "ne cucini 1 su N"                    (lo specchio)
//  4 blockers  cosa ti ferma                         (la causa)
//  5 fix       la cook mode risponde a quei blocchi  (la risposta)
//  6 table     per quanti, quante sere               (l'impegno)
//  7 takeout   quante sere di asporto                (il costo di oggi)
//  8 math      quanto vale cambiare                  (il valore)
//  9 paste     incolla una tua ricetta               (la prova)
// 10 ready     la tua ricetta, primi passi veri      (l'aha)
// 11 account   salvala                               (→ paywall)

const STEPS = ['saved', 'cooked', 'reveal', 'blockers', 'fix', 'table', 'takeout', 'math', 'paste', 'ready', 'account'] as const;
type Step = typeof STEPS[number];
type Set = (patch: Partial<Funnel> | ((f: Funnel) => Partial<Funnel>)) => void;
const DARK: Step[] = ['reveal', 'math'];

const SAVED_STOPS = [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500];
// Dove atterra ogni piatto attorno al numero: [left%, top%, larghezza%, rotazione].
const SPOTS: [number, number, number, number][] = [
  [2, 6, 30, -8], [66, 0, 32, 7], [70, 58, 28, -5], [0, 60, 31, 6], [36, -8, 26, 3], [38, 72, 27, -4],
  [-8, 32, 24, 10], [84, 30, 24, -9], [20, -4, 20, -12], [58, 76, 22, 9], [16, 78, 21, -7], [60, -10, 19, 12],
];

const BLOCKERS = [
  { id: 'rewind', label: 'I keep rewinding with messy hands', fix: 'Every step loops by itself. Hands stay in the bowl.' },
  { id: 'fast', label: 'The video goes way too fast', fix: 'One step at a time. It waits for you.' },
  { id: 'amounts', label: 'Amounts are missing or buried in comments', fix: 'Every ingredient written out, with amounts.' },
  { id: 'lost', label: 'I can never find the recipe again', fix: 'One cookbook, searchable, on every device.' },
  { id: 'shopping', label: 'I never have the ingredients', fix: 'One tap turns recipes into a grocery list by aisle.' },
];

/** Le risposte, senza la ricetta intera. */
function answersOf(f: Funnel) {
  const platform = f.url ? (/instagram/.test(f.url) ? 'instagram' : /tiktok/.test(f.url) ? 'tiktok' : /youtu/.test(f.url) ? 'youtube' : 'other') : undefined;
  return { saved: f.saved, cooked: f.cooked, blockers: f.blockers, household: f.household, nights: f.nights, takeout: f.takeout, paste: f.recipe ? (f.demo ? 'demo' : 'own') : undefined, platform: f.demo ? undefined : platform };
}

export function Onboarding() {
  const [, navigate] = useLocation();
  const { user, entitled, ready } = useSession();
  const [f, setF] = useState<Funnel>(() => loadFunnel());
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [cooking, setCooking] = useState(false);
  const name = STEPS[step];
  const d = useMemo(() => derive(f), [f]);

  useEffect(() => { saveFunnel(f); }, [f]);
  // Per la dashboard: a che schermata è arrivato e cosa ha risposto fin lì.
  useEffect(() => { void journey('step', { id: name, answers: answersOf(f) }); }, [name]);
  const set: Set = (patch) => setF((cur) => ({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }));

  // Chi è già dentro non rifà il percorso; chi ha già l'account va al paywall.
  useEffect(() => {
    if (!ready || !user) return;
    if (entitled) { navigate('/'); return; }
    if (name === 'account' || (step === 0 && f.recipe)) {
      saveProfile({
        firstName: user.displayName?.split(' ')[0],
        household: String(f.household), cookingFrequency: String(f.nights),
        goals: f.blockers, saveHabit: `${f.cooked}/${f.saved}`, completed: true,
      }).catch(() => {});
      // Browser e server con lo stesso id: Meta lo conta una volta (il server una volta per account).
      void journey('account', { answers: answersOf(f) });
      once(`reg-${user.uid}`, async () => {
        const id = `reg_${user.uid}`;
        const meta = await metaForServer(id);
        if (meta) void sendRegistrationEvent(meta, id);
        return track('CompleteRegistration', { status: true, content_name: 'Cherry account' }, id);
      });
      navigate('/join');
    }
  }, [ready, user, entitled, name]);

  const go = (n: number) => { setDir(n > step ? 1 : -1); setStep(Math.max(0, Math.min(STEPS.length - 1, n))); };
  const next = () => go(step + 1);
  const dark = DARK.includes(name);

  return (
    <div className={`flow ${dark ? 'flow--dark' : ''}`}>
      <header className="flow__top">
        {step > 0
          ? <button className="flow__back" onClick={() => go(step - 1)} aria-label="Back"><Icon name="back" /></button>
          : <a className="flow__back" href="/" aria-label="Back to home"><Icon name="back" /></a>}
        <div className="flow__bar" role="progressbar" aria-valuenow={step + 1} aria-valuemax={STEPS.length}>
          <i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <a href="/app/signin" className="flow__signin" onClick={(e) => {
          // Chi ha già l'account: login Google subito. La pagina /signin fa da rete (popup chiuso o bloccato) e smista dopo il login.
          e.preventDefault();
          navigate('/signin');
          signInWithGoogle().catch(() => {});
        }}>Sign in</a>
      </header>

      <AnimatePresence mode="wait" custom={dir} initial={false}>
        <motion.section
          key={name}
          className="flow__body"
          initial={{ opacity: 0, x: dir * 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -28 }}
          transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {name === 'saved' && <Saved f={f} set={set} onNext={next} />}
          {name === 'cooked' && <Cooked f={f} set={set} onNext={next} />}
          {name === 'reveal' && <Reveal f={f} onNext={next} />}
          {name === 'blockers' && <Blockers f={f} set={set} onNext={next} />}
          {name === 'fix' && <Fix f={f} onNext={next} />}
          {name === 'table' && <Table f={f} set={set} onNext={next} />}
          {name === 'takeout' && <Takeout f={f} set={set} onNext={next} />}
          {name === 'math' && <MathScreen f={f} onNext={next} />}
          {name === 'paste' && <Paste f={f} set={set} onReady={next} />}
          {name === 'ready' && f.recipe && <Ready f={f} onCook={() => setCooking(true)} onNext={next} />}
          {name === 'ready' && !f.recipe && <Paste f={f} set={set} onReady={() => {}} />}
          {name === 'account' && <Account f={f} />}
        </motion.section>
      </AnimatePresence>

      {cooking && f.recipe && (
        <CookMode recipe={f.recipe} limit={2} onClose={() => setCooking(false)} onUnlock={() => { setCooking(false); go(STEPS.indexOf('account')); }} />
      )}
      <span className="sr-only" aria-live="polite">{d.savedLabel}</span>
    </div>
  );
}

// ---------- Pezzi ----------

function Head({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <>
      <p className="eyebrow flow__kicker">{kicker}</p>
      <h1 className="display flow__q">{children}</h1>
    </>
  );
}

function Cta({ children, onClick, disabled, note }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; note?: string }) {
  return (
    <div className="flow__cta">
      {note && <p className="flow__note">{note}</p>}
      <button className="btn btn--cherry btn--block" onClick={onClick} disabled={disabled}>{children}</button>
    </div>
  );
}

/** Numero gigante con − e +: si risponde con il pollice, non con la tastiera. */
function Counter({ value, min, max, onChange, suffix, label }: {
  value: number; min: number; max: number; onChange: (n: number) => void; suffix?: string; label: string;
}) {
  const bump = (n: number) => { navigator.vibrate?.(6); onChange(Math.max(min, Math.min(max, value + n))); };
  return (
    <div className="counter" role="group" aria-label={label}>
      <button className="counter__btn" onClick={() => bump(-1)} disabled={value <= min} aria-label="Less">−</button>
      <div className="counter__value">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value} className="num" initial={{ y: 26, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -26, opacity: 0 }} transition={{ duration: 0.16 }}>
            {value}{value >= max && suffix === '+' ? '+' : ''}
          </motion.span>
        </AnimatePresence>
      </div>
      <button className="counter__btn" onClick={() => bump(1)} disabled={value >= max} aria-label="More">+</button>
    </div>
  );
}

// 1 ---------- Il mucchio
function Saved({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  const idx = Math.max(0, SAVED_STOPS.indexOf(f.saved));
  const label = f.saved >= 300 ? 'A full-blown archive.' : f.saved >= 100 ? 'A serious collection.' : f.saved >= 30 ? 'A healthy habit.' : 'Just getting started.';
  const plates = ['v-tacos', 'v-ramen', 'v-dumplings', 'v-pizza', 'v-udon', 'v-curry', 'v-fettuccine', 'v-teriyaki', 'v-beans', 'v-kungpao', 'v-grilledcheese', 'v-gnocchi'];
  const shown = Math.min(plates.length, 2 + idx);
  return (
    <>
      <Head kicker="Let's be honest">How many recipes are sitting in your <em>saved</em> folder?</Head>
      <div className="pile" aria-hidden="true">
        {plates.slice(0, shown).map((p, i) => (
          <motion.div key={p} className="plate pile__plate" style={{ left: `${SPOTS[i][0]}%`, top: `${SPOTS[i][1]}%`, width: `${SPOTS[i][2]}%`, zIndex: i % 3 }}
            initial={{ scale: 0, rotate: -25 }} animate={{ scale: 1, rotate: SPOTS[i][3] }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
            <img src={`/assets/plates/${p}.jpg`} alt="" />
          </motion.div>
        ))}
        <div className="pile__num num">{f.saved >= 500 ? '500+' : f.saved}</div>
      </div>
      <p className="pile__label">{label}</p>
      <input className="range" type="range" min={0} max={SAVED_STOPS.length - 1} step={1} value={idx}
        onChange={(e) => set({ saved: SAVED_STOPS[Number(e.target.value)] })} aria-label="Saved recipes" />
      <div className="range__ends"><span>A few</span><span>Lost count</span></div>
      <Cta onClick={onNext}>That's about right</Cta>
    </>
  );
}

// 2 ---------- Il vuoto
function Cooked({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  return (
    <>
      <Head kicker={`Out of ${f.saved >= 500 ? '500+' : f.saved} saved`}>And how many did you actually <em>cook</em> last month?</Head>
      <div className="flow__mid">
        <Counter value={f.cooked} min={0} max={12} suffix="+" onChange={(n) => set({ cooked: n })} label="Recipes cooked last month" />
        <p className="flow__hint">{f.cooked === 0 ? 'Zero is a very common answer.' : f.cooked <= 2 ? 'No judgment. Most people say this.' : 'Better than most.'}</p>
      </div>
      <Cta onClick={onNext}>Continue</Cta>
    </>
  );
}

// 3 ---------- Lo specchio
function Reveal({ f, onNext }: { f: Funnel; onNext: () => void }) {
  const d = derive(f);
  const total = Math.min(f.saved, 150);
  const lit = f.cooked === 0 ? 0 : Math.max(1, Math.round((f.cooked / f.saved) * total));
  return (
    <>
      <p className="eyebrow flow__kicker">Your saved folder</p>
      {d.oneIn ? (
        <h1 className="display reveal__title">You cook <span className="reveal__big num">1 in {d.oneIn}</span></h1>
      ) : (
        <h1 className="display reveal__title">You cooked <span className="reveal__big num">0 of {d.savedLabel}</span></h1>
      )}
      <div className="dots" aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <motion.i key={i} className={i < lit ? 'on' : ''} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 + i * 0.004, duration: 0.2 }} />
        ))}
      </div>
      <p className="reveal__body">
        {f.cooked === 0 ? 'All' : 'The other'} <b>{d.waiting >= 499 ? 'hundreds' : d.waiting}</b> are still waiting. That's not a willpower problem.
        Recipe videos are made to be <em className="voice">watched</em>, not followed.
      </p>
      <Cta onClick={onNext}>So what's stopping me?</Cta>
    </>
  );
}

// 4 ---------- La causa
function Blockers({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  const toggle = (id: string) => {
    navigator.vibrate?.(6);
    set((cur) => ({ blockers: cur.blockers.includes(id) ? cur.blockers.filter((b) => b !== id) : [...cur.blockers, id] }));
  };
  return (
    <>
      <Head kicker="Pick all that sound like you">What actually gets <em>in the way?</em></Head>
      <div className="opts">
        {BLOCKERS.map((b, i) => (
          <motion.button key={b.id} className={`opt ${f.blockers.includes(b.id) ? 'on' : ''}`} onClick={() => toggle(b.id)} aria-pressed={f.blockers.includes(b.id)}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i, duration: 0.3 }}>
            <span className="opt__n">{String(i + 1).padStart(2, '0')}</span>
            <span className="opt__label">{b.label}</span>
            <span className="opt__tick"><Icon name="check" size={14} stroke={3.2} /></span>
          </motion.button>
        ))}
      </div>
      <Cta onClick={onNext} disabled={!f.blockers.length}>{f.blockers.length ? `That's my ${f.blockers.length === 1 ? 'one' : f.blockers.length}` : 'Pick at least one'}</Cta>
    </>
  );
}

// 5 ---------- La risposta
function Fix({ f, onNext }: { f: Funnel; onNext: () => void }) {
  const mine = BLOCKERS.filter((b) => f.blockers.includes(b.id));
  return (
    <>
      <Head kicker="Here's the fix">Meet <em>cook mode.</em></Head>
      <div className="fix">
        <LoopDemo className="fix__demo" />
        <ul className="fix__list">
          {mine.slice(0, 3).map((b, i) => (
            <motion.li key={b.id} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.12 }}>
              <s>{b.label}</s>
              <b>{b.fix}</b>
            </motion.li>
          ))}
        </ul>
      </div>
      <Cta onClick={onNext}>I want that</Cta>
    </>
  );
}

// 6 ---------- L'impegno
function Table({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  return (
    <>
      <Head kicker="Make it yours">How many nights a week do you <em>want</em> to cook?</Head>
      <div className="flow__mid">
        <Counter value={f.nights} min={1} max={7} onChange={(n) => set({ nights: n })} label="Nights per week" />
        <p className="flow__hint">{f.nights} night{f.nights === 1 ? '' : 's'} a week is {Math.round(f.nights * 4.3)} dinners a month.</p>
        <div className="seg" role="radiogroup" aria-label="Cooking for">
          <span className="seg__label">Cooking for</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} role="radio" aria-checked={f.household === n} className={f.household === n ? 'on' : ''} onClick={() => set({ household: n })}>{n === 5 ? '5+' : n}</button>
          ))}
        </div>
      </div>
      <Cta onClick={onNext}>That's the goal</Cta>
    </>
  );
}

// 7 ---------- Il costo di oggi
function Takeout({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  return (
    <>
      <Head kicker="One more number">And how many nights is it <em>takeout</em> right now?</Head>
      <div className="flow__mid">
        <Counter value={f.takeout} min={0} max={7} onChange={(n) => set({ takeout: n })} label="Takeout nights per week" />
        <p className="flow__hint">Delivery, drive-thru, "I'll just grab something". All of it.</p>
      </div>
      <Cta onClick={onNext}>Show me the math</Cta>
    </>
  );
}

// 8 ---------- Il valore
function MathScreen({ f, onNext }: { f: Funnel; onNext: () => void }) {
  const d = derive(f);
  const money = d.swapped > 0 && d.monthly > 0;
  return (
    <>
      <p className="eyebrow flow__kicker">Your plan</p>
      {money ? (
        <>
          <h1 className="display reveal__title">Cook {d.swapped} of those nights and keep about <span className="reveal__big num">${d.monthly}</span> <span className="reveal__unit">a month.</span></h1>
          <p className="reveal__fine">Estimate for {f.household} {f.household === 1 ? 'person' : 'people'}: ${TAKEOUT_USD} per takeout meal vs ${HOME_USD} home-cooked.</p>
        </>
      ) : (
        <h1 className="display reveal__title">That's <span className="reveal__big num">{d.dinners}</span> <span className="reveal__unit">home-cooked dinners a month.</span></h1>
      )}
      <ul className="planlist">
        <li><span className="num">{f.nights}</span>nights a week, from recipes you already saved</li>
        <li><span className="num">{f.household === 5 ? '5+' : f.household}</span>at the table, amounts scaled for you</li>
        <li><span className="num">{d.savedLabel}</span>saved recipes finally in play</li>
      </ul>
      <Cta onClick={onNext}>Let's start with one recipe</Cta>
    </>
  );
}

// 9 ---------- La prova: una TUA ricetta
function Paste({ f, set, onReady }: { f: Funnel; set: Set; onReady: () => void }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');
  const [stage, setStage] = useState('reading');
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (state !== 'working') return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  const useDemo = () => { set({ recipe: demo as unknown as Recipe, url: DEMO_URL, demo: true }); onReady(); };

  const run = async (raw: string) => {
    const link = extractLink(raw.trim());
    if (!link) { setError("That doesn't look like a TikTok or Instagram link."); setState('error'); return; }
    setState('working'); setError(null); setTick(0); setStage('reading');
    try {
      const { id } = await startPreview(link);
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        if (!alive.current) return;
        const job = await getPreview(id);
        setStage(job.stage);
        if (job.status === 'done' && job.recipe) { set({ recipe: job.recipe, url: link, demo: false }); onReady(); return; }
        if (job.status === 'error') throw new Error(job.error || "We couldn't read that video.");
      }
    } catch (e: any) {
      if (!alive.current) return;
      setError(e.message || "We couldn't read that video.");
      setState('error');
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const link = extractLink(text || '');
      if (link) { setValue(link); run(link); } else { setError('No TikTok or Instagram link on your clipboard yet. Copy one and try again.'); setState('error'); }
    } catch { document.getElementById('paste-input')?.focus(); }
  };

  if (state === 'working') {
    const lines = ['Opening the post', 'Watching the whole video', 'Writing every ingredient', 'Matching each step to its moment'];
    const at = stage === 'reading' ? 0 : Math.min(3, 1 + Math.floor(tick / 9));
    return (
      <>
        <Head kicker="Usually under a minute">Cherry is <em>watching</em> your video.</Head>
        <div className="watch">
          <div className="stamp watch__stamp">
            <svg viewBox="0 0 100 100" aria-hidden="true"><defs><path id="circ" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" /></defs>
              <text fontSize="9.2" fontWeight="700" letterSpacing="2.2"><textPath href="#circ">WATCHING · WRITING · MATCHING · </textPath></text></svg>
            <b>{tick}s</b>
          </div>
          <ul className="watch__list">
            {lines.map((l, i) => (
              <li key={l} className={i < at ? 'done' : i === at ? 'now' : ''}>
                <span>{i < at ? <Icon name="check" size={13} stroke={3.2} /> : String(i + 1)}</span>{l}
              </li>
            ))}
          </ul>
        </div>
        <p className="flow__note">Keep this open. Your recipe appears here the moment it's ready.</p>
      </>
    );
  }

  return (
    <>
      <Head kicker="Now the fun part">Paste one recipe <em>you</em> saved.</Head>
      <p className="flow__lead">We'll turn it into cook mode right now, before you sign up for anything.</p>
      <div className="flow__mid flow__mid--top">
        <button className="btn btn--ink btn--block btn--xl" onClick={paste}><Icon name="paste" /> Paste link</button>
        <form className="linkbox" onSubmit={(e) => { e.preventDefault(); run(value); }}>
          <input id="paste-input" value={value} onChange={(e) => setValue(e.target.value)} inputMode="url" placeholder="or type a TikTok / Instagram link" aria-label="Recipe link" />
          <button className="linkbox__go" type="submit" disabled={!value.trim()} aria-label="Go"><Icon name="next" stroke={2.6} /></button>
        </form>
        {error && <p className="err" role="alert">{error}</p>}
        <ol className="howlink">
          <li><span>1</span>Open the video on TikTok or Instagram</li>
          <li><span>2</span>Tap Share, then Copy link</li>
          <li><span>3</span>Come back and tap Paste link</li>
        </ol>
      </div>
      <div className="flow__cta">
        <button className="flow__link" onClick={useDemo}>{f.recipe && !f.demo ? 'Use a popular recipe instead' : "I don't have one handy, show me a popular one"}</button>
      </div>
    </>
  );
}

// 10 ---------- L'aha
function Ready({ f, onCook, onNext }: { f: Funnel; onCook: () => void; onNext: () => void }) {
  const r = f.recipe!;
  const steps = (r.segments?.length || 0) >= 2 ? r.segments!.length : r.steps.length;
  return (
    <>
      <p className="eyebrow flow__kicker">{f.demo ? 'A popular one, ready to cook' : 'Yours, ready to cook'}</p>
      <div className="ready">
        <motion.div className="ready__card" initial={{ opacity: 0, y: 30, rotate: -3 }} animate={{ opacity: 1, y: 0, rotate: -1.5 }} transition={{ type: 'spring', stiffness: 140, damping: 16 }}>
          {r.imageUrl ? <img src={r.imageUrl} alt="" /> : <img src="/assets/steps/serve.jpg" alt="" />}
          <div className="ready__shade" />
          <h1 className="display ready__title">{r.title}</h1>
        </motion.div>
        <ul className="ready__stats">
          <li><span className="num">{r.ingredients.length}</span>ingredients<br />with amounts</li>
          <li><span className="num">{steps}</span>steps synced<br />to the video</li>
          <li><span className="num">{r.cookMinutes || '—'}</span>{minutes(r.cookMinutes) ? 'minutes' : 'minutes'}<br />start to plate</li>
        </ul>
      </div>
      <div className="flow__cta">
        <button className="btn btn--cherry btn--block" onClick={onCook}><Icon name="play" fill="currentColor" size={17} /> Try the first steps</button>
        <button className="flow__link" onClick={onNext}>Save it to my cookbook</button>
      </div>
    </>
  );
}

// 11 ---------- Salvala
function Account({ f }: { f: Funnel }) {
  const r = f.recipe;
  return (
    <div className="account">
      <Logo size={30} />
      <h1 className="display flow__q">Save <em>{r ? shorten(r.title) : 'your recipe'}</em> to your cookbook.</h1>
      <p className="flow__lead">One account keeps your recipes and grocery list in sync on your phone and computer.</p>
      <GoogleButton />
      <p className="legal">By continuing you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
    </div>
  );
}

function shorten(t: string) {
  return t.length > 34 ? `${t.slice(0, 32).trim()}…` : t;
}
