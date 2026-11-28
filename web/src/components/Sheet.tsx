import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls } from 'motion/react';

// Un foglio che sale dal basso, scurisce la pagina dietro e se ne va per la stessa
// strada (anche trascinandolo giù). Sale intero, come ogni foglio dell'app:
// prima cresceva da un punto e sembrava comparire dal nulla.
// `from` resta per chi lo passa già, ma non serve più.

export type Origin = { x: number; y: number } | null;

export function originOf(el: Element | null): Origin {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function Sheet({ open, onClose, from, children, label }: {
  open: boolean; onClose: () => void; from?: Origin; children: ReactNode; label: string;
}) {
  const drag = useDragControls();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sheet-dim"
            onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
          />
          <motion.div
            className="sheet"
            role="dialog" aria-modal="true" aria-label={label}
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: { type: 'spring', stiffness: 380, damping: 38, mass: 1 } }}
            exit={{ y: '100%', transition: { duration: 0.26, ease: [0.4, 0, 1, 1] } }}
            drag="y" dragControls={drag} dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 90 || info.velocity.y > 600) onClose(); }}
          >
            <div className="sheet__grab" onPointerDown={(e) => drag.start(e)}><i /></div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
