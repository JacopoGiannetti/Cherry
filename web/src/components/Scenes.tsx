import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import '../styles/scenes.css';
import { Icon } from './Icon';
import { DEMO_STEPS } from './LoopDemo';

// Le scene animate condivise tra onboarding e landing. Solo disegno e movimento:
// niente Firebase, niente stato dell'app (la landing resta leggera).

const EASE = [0.2, 0.8, 0.2, 1] as const;

// Solo le foto nuove (public/assets/food/v-*.jpg), le stesse della landing.
export const PLATES = ['v-pizza', 'v-ramen', 'v-tacos', 'v-teriyaki', 'v-curry', 'v-udon', 'v-dumplings', 'v-fettuccine', 'v-kungpao', 'v-gnocchi', 'v-beans', 'v-grilledcheese'];
export const plate = (name: string) => `/assets/food/${name}.jpg`;


/** I piatti in orbita. `children` è quello che sta al centro. */
export function Orbit({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={`nx-orbit ${className}`} aria-hidden="true">
      <div className="nx-orbit__ring">
        {PLATES.slice(0, 10).map((p, i) => (
          <span key={p} className="nx-orbit__seat" style={{ ['--a' as any]: `${i * 36}deg` }}>
            <motion.span className="plate" initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 150, damping: 14, delay: 0.1 + i * 0.07 }}>
              <img src={plate(p)} alt="" />
            </motion.span>
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

/** La scatola "Someday": più ne dichiari, più reel ci cadono dentro; poi escono solo quelli cucinati. */
const PILE = (() => {
  const rows = [6, 5, 6, 5, 5, 4, 4, 3, 2];
  const out: { x: number; b: number; r: number; z: number }[] = [];
  let s = 11;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; };
  rows.forEach((n, row) => {
    for (let i = 0; i < n; i++) out.push({ x: 50 + (i - (n - 1) / 2) * 15.2 + rnd() * 5, b: 56 + row * 19 + rnd() * 8, r: rnd() * 30, z: row });
  });
  return out;
})();

export function SomedayBox({ count, cooked, phase }: { count: number; cooked: number; phase: 'saved' | 'cooked' | 'reveal' }) {
  const out = phase === 'saved' ? 0 : Math.min(cooked, count, 12);
  return (
    <div className={`nx-box ${phase !== 'saved' ? 'is-closed' : ''}`} aria-hidden="true">
      {phase !== 'saved' && (
        <span className="nx-box__shelf">
          <small>Made it out of the box</small>
          {!out && <em className="voice">Not one.</em>}
        </span>
      )}
      <span className="nx-box__back" />
      <AnimatePresence initial={false}>
        {PILE.slice(0, count).map((p, k) => {
          const free = k >= count - out;
          const j = count - 1 - k;
          return (
            <motion.span key={k} layout
              className={`nx-reelcard ${free ? 'is-out' : ''}`}
              style={free ? { left: `${1 + j * Math.min(14.5, 82 / Math.max(1, out - 1))}%`, bottom: 'calc(100% - 84px)', zIndex: 30 + j } : { left: `${p.x}%`, bottom: p.b, zIndex: p.z }}
              initial={{ y: -280 - p.z * 8, opacity: 0, rotate: p.r * 3 }}
              animate={{ y: 0, opacity: 1, rotate: free ? 0 : p.r }}
              exit={{ y: -260, opacity: 0, transition: { duration: 0.22 } }}
              transition={{ type: 'spring', stiffness: 250, damping: 22, delay: (k % 5) * 0.035, layout: { type: 'spring', stiffness: 200, damping: 20, delay: j * 0.06 } }}>
              <img src={plate(PLATES[(k * 5 + p.z * 7) % PLATES.length])} alt="" />
              <i />
            </motion.span>
          );
        })}
      </AnimatePresence>
      <span className="nx-box__front">
        <span className="nx-box__label"><small>I'll make this</small><b className="display">Someday.</b></span>
        <em className="voice">never opened again</em>
      </span>
    </div>
  );
}


/** Un video si apre in passi: il link, la scansione, i passi con il loro momento. Riparte da solo se `loop`. */
const CAPTIONS = ['Paste any recipe link.', 'Cherry watches the whole video.', 'And writes it out, step by step.', 'Every step loops its own moment.'];

export function MagicStage({ onPhase, play = true, loop = false }: { onPhase?: (phase: number) => void; play?: boolean; loop?: boolean }) {
  const [phase, setPhase] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    setPhase(0);
    if (!play) return;
    const t = [setTimeout(() => setPhase(1), 1000), setTimeout(() => setPhase(2), 2900), setTimeout(() => setPhase(3), 4300)];
    if (loop) t.push(setTimeout(() => setRun((r) => r + 1), 9500));
    return () => t.forEach(clearTimeout);
  }, [run, play, loop]);
  useEffect(() => { onPhase?.(phase); }, [phase]);
  const open = phase >= 2;
  return (
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
  );
}
