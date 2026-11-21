import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from './Icon';

// La cook mode in miniatura, con una ricetta vera in quattro passi:
// il "video" resta sul suo pezzo finché non passi al prossimo.
export const DEMO_STEPS = [
  { t: '0:03', end: '0:11', img: '/assets/steps/boil.jpg', title: 'Boil the rigatoni', body: 'Salted water, two minutes shy of the box time.', ing: ['Rigatoni · 1 lb', 'Salt'] },
  { t: '0:11', end: '0:19', img: '/assets/steps/sauce.jpg', title: 'Burst the tomatoes', body: 'Olive oil, garlic, cherry tomatoes. Crush as they soften.', ing: ['Cherry tomatoes · 2 cups', 'Garlic · 3 cloves'] },
  { t: '0:19', end: '0:28', img: '/assets/steps/cream.jpg', title: 'Swirl in the cream', body: 'Lower the heat, pour slowly, shower with parmesan.', ing: ['Heavy cream · ½ cup', 'Parmesan · 1 cup'] },
  { t: '0:28', end: '0:36', img: '/assets/steps/serve.jpg', title: 'Toss and serve', body: 'Pasta into the pan, a splash of pasta water, basil on top.', ing: ['Basil', 'Pasta water'] },
];

export function LoopDemo({ auto = true, className = '' }: { auto?: boolean; className?: string }) {
  const [i, setI] = useState(0);
  const [lap, setLap] = useState(0);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setLap((l) => {
      if (l >= 1) { setI((n) => (n + 1) % DEMO_STEPS.length); return 0; }
      return l + 1;
    }), 1500);
    return () => clearInterval(t);
  }, [auto]);
  const s = DEMO_STEPS[i];
  return (
    <div className={`loopdemo ${className}`}>
      <div className="loopdemo__top">
        <span className="loopdemo__x"><Icon name="close" size={13} stroke={2.6} /></span>
        <div className="loopdemo__ticks">{DEMO_STEPS.map((_, n) => <i key={n} className={n <= i ? 'on' : ''} />)}</div>
        <span className="loopdemo__count">{i + 1}/{DEMO_STEPS.length}</span>
      </div>
      <div className="loopdemo__video">
        <AnimatePresence initial={false}>
          <motion.img key={s.img} src={s.img} alt="" initial={{ opacity: 0, scale: 1.08 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} />
        </AnimatePresence>
        <span className="loopdemo__loop"><Icon name="refresh" size={11} stroke={3} /> {s.t}–{s.end}</span>
        <span className="loopdemo__bar"><motion.i key={`${i}-${lap}`} initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 1.5, ease: 'linear' }} /></span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={i} className="loopdemo__card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}>
          <small>Step {i + 1} of {DEMO_STEPS.length}</small>
          <b>{s.title}</b>
          <p>{s.body}</p>
          <div className="loopdemo__ings">{s.ing.map((x) => <span key={x}>{x}</span>)}</div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
