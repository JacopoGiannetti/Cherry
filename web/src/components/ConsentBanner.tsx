import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { needsConsent, onConsentChange, setConsent } from '../lib/meta';

// I cookie di misurazione (Meta Pixel) solo se dici sì. Due bottoni uguali:
// rifiutare è facile quanto accettare, come chiedono le regole europee.
export function ConsentBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(needsConsent()), 900);
    const off = onConsentChange(() => setShow(needsConsent()));
    return () => { clearTimeout(t); off(); };
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="consent" role="dialog" aria-label="Cookies"
          initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
          <p>We use cookies to see which of our ads bring people to Cherry. <a href="/privacy#cookies">Learn more</a></p>
          <div className="consent__actions">
            <button className="btn btn--ghost" onClick={() => setConsent('denied')}>Decline</button>
            <button className="btn btn--ink" onClick={() => setConsent('granted')}>Accept</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
