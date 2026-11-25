import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { consentUi, dismissNotice, effectiveConsent, gpc, onConsentChange, onPrefs, setConsent } from '../lib/meta';

// I cookie di misurazione (Meta Pixel), secondo il paese:
// - UE/UK/Svizzera: il banner che chiede, con due bottoni uguali (rifiutare è facile quanto accettare).
// - altrove (USA…): un avviso piccolo che si chiude, con il link per dire di no.
// Più il pannello delle preferenze, che si apre dal footer ("Do Not Sell or Share") e da Account.
export function ConsentBanner() {
  const [ui, setUi] = useState<ReturnType<typeof consentUi>>(null);
  const [prefs, setPrefs] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setUi(consentUi()), 900);
    const off = onConsentChange(() => setUi(consentUi()));
    const offPrefs = onPrefs(setPrefs);
    if (location.hash === '#do-not-sell') setPrefs(true);
    return () => { clearTimeout(t); off(); offPrefs(); };
  }, []);
  const spring = { type: 'spring', stiffness: 420, damping: 36 } as const;

  return (
    <>
      <AnimatePresence>
        {ui === 'banner' && !prefs && (
          <motion.div key="banner" className="consent-sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="consent consent--big" role="dialog" aria-modal="true" aria-labelledby="consent-title"
              initial={{ y: 60 }} animate={{ y: 0 }} exit={{ y: 60 }} transition={spring}>
              <span className="consent__icon" aria-hidden="true">🍪</span>
              <h2 id="consent-title">Can we use cookies?</h2>
              <p>They help us see which of our ads bring people to Cherry, so we can keep it affordable. Cookies that keep you signed in are always on. <a href="/privacy#cookies">Learn more</a></p>
              {/* Rifiutare deve essere facile quanto accettare (GDPR): stessi bottoni, stessa misura. */}
              <div className="consent__actions">
                <button className="btn btn--ink" onClick={() => setConsent('denied')}>Reject all</button>
                <button className="btn btn--ink" onClick={() => setConsent('granted')}>Accept all</button>
              </div>
              <button className="consent__link consent__more" onClick={() => setPrefs(true)}>Choose what to allow</button>
            </motion.div>
          </motion.div>
        )}
        {ui === 'notice' && !prefs && (
          <motion.div key="notice" className="consent consent--notice" role="status"
            initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={spring}>
            <p>We use cookies to measure our ads. <button className="consent__link" onClick={() => setPrefs(true)}>Opt out</button></p>
            <button className="consent__x" onClick={dismissNotice} aria-label="Close">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{prefs && <CookiePrefs onClose={() => { setPrefs(false); if (location.hash === '#do-not-sell') history.replaceState(null, '', location.pathname + location.search); }} />}</AnimatePresence>
    </>
  );
}

function CookiePrefs({ onClose }: { onClose: () => void }) {
  const [on, setOn] = useState(effectiveConsent() === 'granted');
  const blocked = gpc();
  const toggle = () => {
    if (blocked) return;
    const next = !on;
    setOn(next);
    setConsent(next ? 'granted' : 'denied');
  };
  return (
    <motion.div className="consent-prefs" role="dialog" aria-modal="true" aria-labelledby="cp-title"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="consent-prefs__card" onClick={(e) => e.stopPropagation()}
        initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
        <h2 id="cp-title">Cookie preferences</h2>
        <p className="consent-prefs__lead">Do Not Sell or Share My Personal Information</p>
        <div className="consent-prefs__row">
          <div>
            <b>Ad measurement (Meta)</b>
            <small>Lets us see which of our ads bring people to Cherry. Turn it off and we stop sharing with Meta, from your browser and from our servers.</small>
          </div>
          <button className={`switch ${on ? 'is-on' : ''}`} role="switch" aria-checked={on} aria-label="Ad measurement" onClick={toggle} disabled={blocked}><span /></button>
        </div>
        {blocked && <p className="consent-prefs__note">Your browser sends Global Privacy Control, so this stays off.</p>}
        <p className="consent-prefs__note">Cookies that keep you signed in and remember your settings are always on: Cherry doesn’t work without them. <a href="/privacy#cookies">Privacy policy</a></p>
        <button className="btn btn--ink btn--block" onClick={onClose}>Done</button>
      </motion.div>
    </motion.div>
  );
}
