import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/**
 * Un'icona che diventa un'altra: quella vecchia si rimpicciolisce e sfuoca mentre la nuova
 * cresce al suo posto. Senza, il cambio è un taglio secco (cerca → chiudi, play → pausa,
 * carrello → spunta). `id` cambia quando cambia l'icona.
 */
export function Swap({ id, children }: { id: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={id} style={{ display: 'grid' }}
        initial={{ opacity: 0, scale: 0.5, filter: 'blur(4px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, scale: 0.5, filter: 'blur(4px)' }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
        {children}
      </motion.span>
    </AnimatePresence>
  );
}
