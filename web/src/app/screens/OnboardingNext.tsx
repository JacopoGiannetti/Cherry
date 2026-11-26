import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'wouter';
import '../../styles/flow-next.css';
import { Icon, Logo } from '../../components/Icon';
import { CookMode } from '../../components/CookMode';
import { GoogleButton } from '../../components/GoogleButton';
import { LoopDemo } from '../../components/LoopDemo';
import { useSession } from '../../lib/store';
import { signInWithGoogle } from '../../lib/firebase';
import { metaForServer, once, track } from '../../lib/meta';
import { saveProfile, sendRegistrationEvent } from '../../lib/api';
import { DEMO_URL, derive, HOME_USD, loadFunnel, saveFunnel, TAKEOUT_USD, type Funnel } from '../../lib/funnel';
import { journey } from '../../lib/journey';
import { isPreview } from '../../lib/preview';
import { REVIEWS, REVIEW_PLACEHOLDERS } from '../../lib/reviews';
import demo from '../../lib/demo.json';
import type { Recipe } from '../../lib/types';

// Il percorso nuovo (in prova, /app/start-next): accompagna al paywall invece di
// buttare dentro alle domande. Cinque lavori, in quest'ordine:
//
//  FIDUCIA      1 welcome   cos'è Cherry, quanto dura, cosa succede adesso
//  CAPITO       2 saved     quante ne hai salvate
//               3 cooked    quante ne hai cucinate
//               4 reveal    "ne cucini 1 su N" — e non è colpa tua
//               5 blockers  cosa ti ferma
//  LA SOLUZIONE 6 fix       come Cherry risponde ai TUOI blocchi
//               7 ready     provala su una ricetta vera (l'aha)
//  I BENEFICI   8 table     per quanti, quante sere
//               9 takeout   quante sere di asporto
//              10 math      quanto vale cambiare
//              11 after     stasera / questa settimana / questo mese
//  LA PROVA    12 reviews   recensioni vere (la schermata esiste solo se ce ne sono)
//              13 promise   chi c'è dietro e cosa promettiamo
//              14 account   salva la ricetta (→ paywall)

const ALL = ['welcome', 'saved', 'cooked', 'reveal', 'blockers', 'fix', 'ready', 'table', 'takeout', 'math', 'after', 'reviews', 'promise', 'account'] as const;
type Step = typeof ALL[number];
const DEMO: Partial<Funnel> = { recipe: demo as unknown as Recipe, url: DEMO_URL, demo: true };
type Set = (patch: Partial<Funnel> | ((f: Funnel) => Partial<Funnel>)) => void;
const DARK: Step[] = ['reveal', 'math'];

const SAVED = [
  { n: 10, label: 'A handful', sub: 'Around 10', plates: 1 },
  { n: 50, label: 'Dozens', sub: 'Around 50', plates: 2 },
  { n: 150, label: 'Over a hundred', sub: '100 to 300', plates: 3 },
  { n: 500, label: 'I lost count', sub: '500 or more', plates: 4 },
];
const PLATES = ['v-tacos', 'v-ramen', 'v-pizza', 'v-curry'];

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

export function OnboardingNext() {
  const [, navigate] = useLocation();
  const { user, entitled, ready } = useSession();
  const preview = useMemo(() => isPreview(), []);
  // Senza recensioni vere la schermata non c'è (in anteprima sì, con i segnaposto).
  const STEPS = useMemo(() => ALL.filter((s) => s !== 'reviews' || REVIEWS.length > 0 || preview), [preview]);
  const [f, setF] = useState<Funnel>(() => loadFunnel());
  const [step, setStep] = useState(() => {
    // Solo in anteprima: ?step=promise apre direttamente quella schermata.
    const want = preview ? new URLSearchParams(location.search).get('step') : null;
    return Math.max(0, STEPS.indexOf(want as Step));
  });
  const [dir, setDir] = useState(1);
  const [cooking, setCooking] = useState(false);
  const name = STEPS[step];

  useEffect(() => { saveFunnel(f); }, [f]);
  useEffect(() => { void journey('step', { id: `next.${name}`, answers: answersOf(f) }); }, [name]);
  const set: Set = (patch) => setF((cur) => ({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }));

  // Chi è già dentro non rifà il percorso; chi ha già l'account va al paywall.
  // In anteprima no: il percorso si guarda tutto anche da abbonati.
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
  const withDemo = f.recipe ? f : { ...f, ...DEMO };

  return (
    <div className={`flow nx ${DARK.includes(name) ? 'flow--dark' : ''}`}>
      <header className="flow__top">
        {step > 0
          ? <button className="flow__back" onClick={() => go(step - 1)} aria-label="Back"><Icon name="back" /></button>
          : <a className="flow__back" href="/" aria-label="Back to home"><Icon name="back" /></a>}
        {name === 'welcome'
          ? <span className="nx-top__logo"><Logo size={26} /></span>
          : (
            <div className="flow__bar" role="progressbar" aria-valuenow={step} aria-valuemax={STEPS.length - 1}>
              <i style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
            </div>
          )}
        <a href="/app/signin" className="flow__signin" onClick={(e) => {
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
          {name === 'welcome' && <Welcome onNext={next} />}
          {name === 'saved' && <Saved set={set} onNext={next} />}
          {name === 'cooked' && <Cooked f={f} set={set} onNext={next} />}
          {name === 'reveal' && <Reveal f={f} onNext={next} />}
          {name === 'blockers' && <Blockers f={f} set={set} onNext={next} />}
          {name === 'fix' && <Fix f={f} onNext={() => { if (!f.recipe) set(DEMO); next(); }} />}
          {name === 'ready' && <Ready f={withDemo} onCook={() => { if (!f.recipe) set(DEMO); setCooking(true); }} onNext={next} />}
          {name === 'table' && <Table f={f} set={set} onNext={next} />}
          {name === 'takeout' && <Takeout f={f} set={set} onNext={next} />}
          {name === 'math' && <MathScreen f={f} onNext={next} />}
          {name === 'after' && <After f={f} onNext={next} />}
          {name === 'reviews' && <Reviews onNext={next} />}
          {name === 'promise' && <Promise onNext={() => { if (!f.recipe) set(DEMO); next(); }} />}
          {name === 'account' && <Account f={withDemo} signedInAs={preview && user ? (user.displayName || user.email || 'you') : null} onContinue={finish} />}
        </motion.section>
      </AnimatePresence>

      {cooking && f.recipe && (
        <CookMode recipe={f.recipe} limit={2} onClose={() => setCooking(false)} onUnlock={() => { setCooking(false); go(STEPS.indexOf('table')); }} />
      )}
      {preview && <span className="nx-preview">Preview · {step + 1}/{STEPS.length} · {name}</span>}
    </div>
  );
}

// ---------- Pezzi ----------

function Head({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <>
      <p className="eyebrow flow__kicker">{kicker}</p>
      <h1 className="display flow__q nx-q">{children}</h1>
    </>
  );
}

function Cta({ children, onClick, disabled, note }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; note?: string }) {
  return (
    <div className="flow__cta">
      <button className="btn btn--cherry btn--block" onClick={onClick} disabled={disabled}>{children}</button>
      {note && <p className="nx-cta__note">{note}</p>}
    </div>
  );
}

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

// 1 ---------- Fiducia: cos'è, quanto dura, cosa succede adesso
function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="nx-welcome">
      <motion.div className="nx-welcome__demo" initial={{ opacity: 0, y: 24, rotate: 0 }} animate={{ opacity: 1, y: 0, rotate: -2 }} transition={{ type: 'spring', stiffness: 110, damping: 16 }}>
        <LoopDemo />
      </motion.div>
      <div className="nx-welcome__copy">
        <h1 className="display nx-welcome__title">Finally cook the recipes <em>you save.</em></h1>
        <p className="nx-lead">Cherry turns any TikTok or Instagram recipe video into clear steps you can follow, with amounts and a grocery list.</p>
      </div>
      <div className="flow__cta">
        <button className="btn btn--cherry btn--block" onClick={onNext}>Get started <Icon name="next" stroke={2.6} /></button>
        <ul className="nx-ticks">
          <li><Icon name="clock" size={14} stroke={2.4} />2 minutes</li>
          <li><Icon name="play" size={14} stroke={2.4} />Try a recipe first</li>
          <li><Icon name="check" size={14} stroke={2.8} />Cancel anytime</li>
        </ul>
      </div>
    </div>
  );
}

// 2 ---------- Capito: il mucchio (si risponde con un tocco, e si legge)
function Saved({ set, onNext }: { set: Set; onNext: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const pick = (n: number) => {
    navigator.vibrate?.(6);
    setPicked(n);
    set({ saved: n });
    setTimeout(onNext, 260);
  };
  return (
    <>
      <Head kicker="First, about you">How many recipe videos have you <em>saved?</em></Head>
      <p className="nx-lead">On TikTok, Instagram, anywhere. A rough guess is fine.</p>
      <div className="nx-cards">
        {SAVED.map((o, i) => (
          <motion.button key={o.n} className={`nx-card ${picked === o.n ? 'on' : ''}`} onClick={() => pick(o.n)} aria-pressed={picked === o.n}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.3 }}>
            <span className="nx-card__plates" aria-hidden="true">
              {PLATES.slice(0, o.plates).map((p) => <span key={p} className="plate"><img src={`/assets/food/${p}.jpg`} alt="" /></span>)}
            </span>
            <span className="nx-card__text"><b>{o.label}</b><small>{o.sub}</small></span>
            <Icon name="next" size={18} stroke={2.4} />
          </motion.button>
        ))}
      </div>
    </>
  );
}

// 3 ---------- Capito: il vuoto
function Cooked({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  return (
    <>
      <Head kicker="Be honest">And how many did you actually <em>cook</em> last month?</Head>
      <div className="flow__mid">
        <Counter value={f.cooked} min={0} max={12} suffix="+" onChange={(n) => set({ cooked: n })} label="Recipes cooked last month" />
        <p className="flow__hint">{f.cooked === 0 ? 'Zero is a very common answer.' : f.cooked <= 2 ? 'No judgment. Most people say this.' : 'Better than most.'}</p>
      </div>
      <Cta onClick={onNext}>Continue</Cta>
    </>
  );
}

// 4 ---------- Capito: lo specchio, e non è colpa tua
function Reveal({ f, onNext }: { f: Funnel; onNext: () => void }) {
  const d = derive(f);
  const total = Math.min(f.saved, 120);
  const lit = f.cooked === 0 ? 0 : Math.max(1, Math.round((f.cooked / f.saved) * total));
  return (
    <>
      <p className="eyebrow flow__kicker">Your saved folder</p>
      {d.oneIn && d.oneIn > 1 ? (
        <h1 className="display reveal__title">You cook about <span className="reveal__big num">1 in {d.oneIn}</span></h1>
      ) : d.oneIn ? (
        <h1 className="display reveal__title">You cooked <span className="reveal__big num">{f.cooked} of {d.savedLabel}</span></h1>
      ) : (
        <h1 className="display reveal__title">You cooked <span className="reveal__big num">0 of {d.savedLabel}</span></h1>
      )}
      <div className="dots" aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <motion.i key={i} className={i < lit ? 'on' : ''} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 + i * 0.004, duration: 0.2 }} />
        ))}
      </div>
      <p className="reveal__body">
        <b>It's not you.</b> Recipe videos are made to be <em className="voice">watched</em>, not followed: too fast, no amounts, gone the moment you scroll.
      </p>
      <Cta onClick={onNext}>So what's stopping me?</Cta>
    </>
  );
}

// 5 ---------- Capito: la causa
function Blockers({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  const toggle = (id: string) => {
    navigator.vibrate?.(6);
    set((cur) => ({ blockers: cur.blockers.includes(id) ? cur.blockers.filter((b) => b !== id) : [...cur.blockers, id] }));
  };
  return (
    <>
      <Head kicker="Pick all that sound like you">What gets <em>in the way?</em></Head>
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
      <Cta onClick={onNext} disabled={!f.blockers.length}>{f.blockers.length ? 'Continue' : 'Pick at least one'}</Cta>
    </>
  );
}

// 6 ---------- La soluzione: come funziona, e la risposta ai suoi blocchi
function Fix({ f, onNext }: { f: Funnel; onNext: () => void }) {
  const mine = BLOCKERS.filter((b) => f.blockers.includes(b.id));
  const shown = (mine.length ? mine : BLOCKERS).slice(0, 3);
  return (
    <>
      <Head kicker="Here's the fix">Paste a link. Cherry builds <em>this.</em></Head>
      <div className="nx-fix">
        <LoopDemo className="nx-fix__demo" />
        <ol className="nx-fix__how">
          <li><span className="num">1</span>Copy the link of any recipe video</li>
          <li><span className="num">2</span>Cherry watches it and writes it out</li>
          <li><span className="num">3</span>You cook, one looping step at a time</li>
        </ol>
      </div>
      <ul className="fix__list nx-fix__list">
        {shown.map((b, i) => (
          <motion.li key={b.id} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.12 }}>
            <s>{b.label}</s>
            <b>{b.fix}</b>
          </motion.li>
        ))}
      </ul>
      <Cta onClick={onNext}>See it on a real recipe</Cta>
    </>
  );
}

// 7 ---------- La soluzione: l'aha
function Ready({ f, onCook, onNext }: { f: Funnel; onCook: () => void; onNext: () => void }) {
  const r = f.recipe!;
  const steps = (r.segments?.length || 0) >= 2 ? r.segments!.length : r.steps.length;
  return (
    <>
      <Head kicker="Try it, no account needed">This was a <em>TikTok</em> a minute ago.</Head>
      <div className="ready nx-ready">
        <motion.div className="ready__card" initial={{ opacity: 0, y: 30, rotate: -3 }} animate={{ opacity: 1, y: 0, rotate: -1.5 }} transition={{ type: 'spring', stiffness: 140, damping: 16 }}>
          <img src={r.imageUrl || '/assets/food/serve.jpg'} alt="" />
          <div className="ready__shade" />
          <h2 className="display ready__title">{r.title}</h2>
        </motion.div>
        <ul className="ready__stats">
          <li><span className="num">{r.ingredients.length}</span>ingredients<br />with amounts</li>
          <li><span className="num">{steps}</span>steps synced<br />to the video</li>
          <li><span className="num">{r.cookMinutes || '—'}</span>minutes<br />start to plate</li>
        </ul>
      </div>
      <div className="flow__cta">
        <button className="btn btn--cherry btn--block" onClick={onCook}><Icon name="play" fill="currentColor" size={17} /> Try the first steps</button>
        <button className="flow__link" onClick={onNext}>Skip, keep going</button>
      </div>
    </>
  );
}

// 8 ---------- I benefici: l'impegno
function Table({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  return (
    <>
      <Head kicker="Now, your plan">How many nights a week do you <em>want</em> to cook?</Head>
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

// 9 ---------- I benefici: il costo di oggi
function Takeout({ f, set, onNext }: { f: Funnel; set: Set; onNext: () => void }) {
  return (
    <>
      <Head kicker="Last question">And how many nights is it <em>takeout</em> right now?</Head>
      <div className="flow__mid">
        <Counter value={f.takeout} min={0} max={7} onChange={(n) => set({ takeout: n })} label="Takeout nights per week" />
        <p className="flow__hint">Delivery, drive-thru, "I'll just grab something". All of it.</p>
      </div>
      <Cta onClick={onNext}>Show me my plan</Cta>
    </>
  );
}

// 10 ---------- I benefici: il valore
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
      </ul>
      <Cta onClick={onNext}>What does that look like?</Cta>
    </>
  );
}

// 11 ---------- I benefici: come cambia la vita, in tre tempi
function After({ f, onNext }: { f: Funnel; onNext: () => void }) {
  const d = derive(f);
  const rows = [
    { when: 'Tonight', img: 'serve', title: 'You cook one you saved', body: 'Open it, follow the loop, eat. No rewinding, no guessing amounts.' },
    { when: 'This week', img: 'v-curry', title: `${f.nights} dinner${f.nights === 1 ? '' : 's'}, one grocery run`, body: 'Every ingredient on one list, sorted by aisle, scaled for your table.' },
    d.monthly > 0 && d.swapped > 0
      ? { when: 'This month', img: 'v-pizza', title: `About $${d.monthly} stays with you`, body: `${d.dinners} home-cooked dinners instead of another delivery fee.` }
      : { when: 'This month', img: 'v-pizza', title: `${d.dinners} home-cooked dinners`, body: 'And a saved folder that finally turns into meals.' },
  ];
  return (
    <>
      <Head kicker="With Cherry">Here's what <em>changes.</em></Head>
      <ol className="nx-after">
        {rows.map((r, i) => (
          <motion.li key={r.when} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.14, duration: 0.4 }}>
            <span className="plate nx-after__plate"><img src={`/assets/food/${r.img}.jpg`} alt="" /></span>
            <div>
              <small className="eyebrow">{r.when}</small>
              <b>{r.title}</b>
              <p>{r.body}</p>
            </div>
          </motion.li>
        ))}
      </ol>
      <Cta onClick={onNext}>I want that</Cta>
    </>
  );
}

// 12 ---------- La prova: recensioni (solo vere; i segnaposto si vedono solo in anteprima)
function Reviews({ onNext }: { onNext: () => void }) {
  const real = REVIEWS.length > 0;
  const list = real ? REVIEWS : REVIEW_PLACEHOLDERS;
  return (
    <>
      <Head kicker="From people cooking with Cherry">Saved folders, turned into <em>dinners.</em></Head>
      {!real && <p className="nx-warn">Preview only: placeholder cards. This screen stays hidden from the public until real reviews are added in <code>lib/reviews.ts</code>.</p>}
      <ul className="nx-reviews">
        {list.slice(0, 3).map((r, i) => (
          <motion.li key={i} className={real ? '' : 'is-placeholder'} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.12, duration: 0.4 }}>
            <p>“{r.quote}”</p>
            <footer>
              {r.plate && <span className="plate"><img src={`/assets/food/${r.plate}.jpg`} alt="" /></span>}
              <span><b>{r.name}</b>{r.detail && <small>{r.detail}</small>}</span>
            </footer>
          </motion.li>
        ))}
      </ul>
      <Cta onClick={onNext}>Continue</Cta>
    </>
  );
}

// 13 ---------- La prova: chi c'è dietro e cosa promettiamo
function Promise({ onNext }: { onNext: () => void }) {
  const rows: [string, string, string][] = [
    ['refresh', 'Cancel in two taps', 'From inside Cherry. No emails, no calls.'],
    ['lock', 'Secure checkout by Stripe', 'Apple Pay and Google Pay. We never see your card.'],
    ['heart', 'Creators always get credit', 'Videos play in the official player, linked to the post.'],
    ['people', 'Works on every device', 'iPhone, Android and computer, always in sync.'],
  ];
  return (
    <>
      <Head kicker="Before you join">A few <em>promises.</em></Head>
      <div className="nx-founder">
        <img src="/assets/founder.jpg" alt="Jacopo, founder of Cherry" width={56} height={56} />
        <p>“We're building Cherry to make eating well easier for everyone, whatever you like to eat.”<small>Jacopo, founder</small></p>
      </div>
      <ul className="nx-promises">
        {rows.map(([icon, t, b], i) => (
          <motion.li key={t} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.08 }}>
            <span className="nx-promises__icon"><Icon name={icon} size={18} stroke={2.3} /></span>
            <div><b>{t}</b><p>{b}</p></div>
          </motion.li>
        ))}
      </ul>
      <Cta onClick={onNext}>Sounds good</Cta>
    </>
  );
}

// 14 ---------- Salvala
function Account({ f, signedInAs, onContinue }: { f: Funnel; signedInAs: string | null; onContinue: () => void }) {
  const r = f.recipe;
  const d = derive(f);
  return (
    <div className="account nx-account">
      {r && (
        <div className="nx-account__recipe">
          <img src={r.imageUrl || '/assets/food/serve.jpg'} alt="" />
          <div><b>{r.title}</b><span>Ready in your cookbook</span></div>
          <span className="nx-account__check"><Icon name="check" size={15} stroke={3.2} /></span>
        </div>
      )}
      <h1 className="display flow__q nx-q">Your plan is ready. <em>Save it.</em></h1>
      <p className="nx-lead">{f.nights} night{f.nights === 1 ? '' : 's'} a week for {f.household === 5 ? '5+' : f.household}{d.monthly > 0 && d.swapped > 0 ? `, about $${d.monthly} back a month` : ''}. One account keeps it in sync on your phone and computer.</p>
      {signedInAs
        ? <button className="btn btn--cherry btn--block nx-account__go" onClick={onContinue}>Continue as {signedInAs.split(' ')[0]}</button>
        : <GoogleButton />}
      <p className="legal">By continuing you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
    </div>
  );
}
