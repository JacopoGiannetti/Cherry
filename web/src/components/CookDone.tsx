import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import type { Recipe } from '../lib/types';
import '../styles/cook-done.css';

/**
 * Il finale del cook mode. Hai appena finito di cucinare: per due secondi il piatto arriva
 * in tavola, col suo nome. Poi si torna alla ricetta. Un tocco lo salta.
 * (Di un'esperienza si ricorda soprattutto come finisce.)
 */
export function CookDone({ recipe, onEnd }: { recipe: Recipe; onEnd: () => void }) {
  // Il timer e il tocco chiudono entrambi: vale il primo, una volta sola.
  const ended = useRef(false);
  const end = () => { if (ended.current) return; ended.current = true; onEnd(); };
  useEffect(() => {
    navigator.vibrate?.([10, 60, 18]);
    const t = setTimeout(end, 2300);
    return () => clearTimeout(t);
  }, []);
  const ease = [0.22, 1, 0.36, 1] as const;
  return (
    <motion.button type="button" className="cdone" onClick={end} aria-label="Dinner is ready. Tap to continue"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <motion.span className="cdone__halo" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.9, ease }} />
      <motion.span className="cdone__plate" initial={{ scale: 0.3, rotate: -50, y: 60 }} animate={{ scale: 1, rotate: 0, y: 0 }}
        transition={{ type: 'spring', stiffness: 170, damping: 15, delay: 0.08 }}>
        {recipe.imageUrl ? <img src={recipe.imageUrl} alt="" /> : null}
      </motion.span>
      <span className="cdone__copy">
        <span className="cdone__mask"><motion.b initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ duration: 0.7, delay: 0.35, ease }}>Dinner's ready.</motion.b></span>
        <motion.em initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.75, ease }}>{recipe.title}</motion.em>
      </span>
    </motion.button>
  );
}
