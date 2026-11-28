import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import '../styles/lightbox.css';

export type Photo = { url: string; caption?: string };

/**
 * Le foto di uno step a tutto schermo, da sfogliare col dito: a sinistra e a destra per
 * passare da una all'altra, in giù (o un tocco fuori) per chiudere. Sotto, la didascalia
 * e i puntini. Prima si ingrandiva una foto alla volta e per vedere la successiva
 * bisognava chiudere e ritoccare.
 */
export function Lightbox({ photos, index, onIndex, onClose }: {
  photos: Photo[] | null; index: number; onIndex: (n: number) => void; onClose: () => void;
}) {
  const open = !!photos?.length;
  const dir = useRef(1);
  const go = (n: number) => {
    if (!photos || n < 0 || n >= photos.length) return;
    dir.current = n > index ? 1 : -1;
    onIndex(n);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); }
      if (e.key === 'ArrowRight') { e.stopImmediatePropagation(); go(index + 1); }
      if (e.key === 'ArrowLeft') { e.stopImmediatePropagation(); go(index - 1); }
    };
    // In cattura: le frecce sfogliano le foto, non gli step del cook mode che sta sotto.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, index, photos]);

  const photo = photos?.[index];
  return createPortal(
    <AnimatePresence>
      {open && photo && (
        <motion.div className="lightbox" role="dialog" aria-modal="true" aria-label="Step photos"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose}>
          <div className="lightbox__stage">
            <AnimatePresence initial={false} mode="popLayout" custom={dir.current}>
              <motion.img
                key={photo.url} src={photo.url} alt={photo.caption || ''} draggable={false}
                custom={dir.current}
                variants={{
                  enter: (d: number) => ({ x: `${d * 60}%`, opacity: 0, scale: 0.94 }),
                  center: { x: 0, y: 0, opacity: 1, scale: 1 },
                  exit: (d: number) => ({ x: `${d * -60}%`, opacity: 0, scale: 0.94 }),
                }}
                initial="enter" animate="center" exit="exit"
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                drag dragDirectionLock dragSnapToOrigin dragElastic={0.7} dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
                onClick={(e) => e.stopPropagation()}
                onDragEnd={(_, info) => {
                  const { offset, velocity } = info;
                  if (Math.abs(offset.y) > Math.abs(offset.x)) { if (offset.y > 90 || velocity.y > 600) onClose(); return; }
                  if (offset.x < -60 || velocity.x < -500) go(index + 1);
                  else if (offset.x > 60 || velocity.x > 500) go(index - 1);
                }}
              />
            </AnimatePresence>
          </div>
          <div className="lightbox__foot" onClick={(e) => e.stopPropagation()}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={photo.url} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
                {photo.caption || ' '}
              </motion.p>
            </AnimatePresence>
            {photos!.length > 1 && (
              <div className="lightbox__dots">
                {photos!.map((p, n) => <button key={p.url} type="button" className={n === index ? 'is-on' : ''} onClick={() => go(n)} aria-label={`Photo ${n + 1} of ${photos!.length}`} />)}
              </div>
            )}
          </div>
          <button type="button" className="lightbox__close" onClick={onClose} aria-label="Close photos">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
