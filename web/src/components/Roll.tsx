import { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/**
 * Un numero che scorre quando cambia: sale se aumenta, scende se diminuisce.
 * Si vede che è cambiato, e in che verso, invece di trovarlo diverso di colpo.
 */
export function Roll({ value }: { value: number }) {
  const prev = useRef(value);
  const dir = value >= prev.current ? 1 : -1;
  prev.current = value;
  return (
    <span style={{ display: 'inline-grid', overflow: 'hidden', verticalAlign: 'bottom' }}>
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span key={value} custom={dir} style={{ display: 'block', gridArea: '1 / 1' }}
          variants={{
            enter: (d: number) => ({ y: `${d * 70}%`, opacity: 0 }),
            center: { y: 0, opacity: 1 },
            exit: (d: number) => ({ y: `${d * -70}%`, opacity: 0 }),
          }}
          initial="enter" animate="center" exit="exit" transition={{ type: 'spring', stiffness: 520, damping: 38 }}>
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
