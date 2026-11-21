import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls } from 'motion/react';

// Un pannello sale dal bottone che lo apre, scurisce la pagina dietro
// e se ne va per la stessa strada. `from` è il bottone (il suo rettangolo):
// il pannello cresce da lì, non da un punto qualsiasi dello schermo.

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

  // Il pannello è largo quanto lo schermo (max 560) e attaccato al fondo:
  // il punto di partenza è il bottone, espresso in coordinate del pannello.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = Math.min(vw, 560);
  const left = (vw - width) / 2;
  const ox = from ? `${from.x - left}px` : '50%';
  const oy = from ? `${Math.max(0, from.y - vh * 0.35)}px` : '100%';

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sheet-dim"
            onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
          />
          <motion.div
            className="sheet"
            role="dialog" aria-modal="true" aria-label={label}
            style={{ transformOrigin: `${ox} ${oy}` }}
            initial={{ opacity: 0, scale: 0.2, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.2, y: 40 }}
            transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.9 }}
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
