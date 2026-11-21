import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from './Icon';

type T = { id: number; text: string; icon?: string };
let push: ((t: T) => void) | null = null;
let n = 0;

export function toast(text: string, icon = 'check') {
  push?.({ id: ++n, text, icon });
}

export function ToastHost() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems([t]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), 2600);
    };
    return () => { push = null; };
  }, []);
  return (
    <AnimatePresence>
      {items.map((t) => (
        <motion.div key={t.id} className="toast" role="status"
          initial={{ opacity: 0, y: 16, x: '-50%', scale: 0.96 }} animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
          exit={{ opacity: 0, y: 10, x: '-50%' }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
          {t.icon && <Icon name={t.icon} size={18} stroke={2.6} />}{t.text}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
