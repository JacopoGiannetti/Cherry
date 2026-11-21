import { useState } from 'react';
import { motion } from 'motion/react';
import { canPromptInstall, isStandalone, platform, promptInstall } from '../lib/pwa';
import { Icon } from './Icon';

/** "Aggiungi alla Home", spiegato per il telefono che si ha in mano. */
export function InstallGuide({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const os = platform();
  const [installed, setInstalled] = useState(isStandalone());

  if (installed) {
    return (
      <div className="install">
        <div className="install__ok"><Icon name="check" size={28} stroke={3} /></div>
        <h2 className="display">Cherry is on your Home Screen</h2>
        {onDone && <button className="btn btn--cherry btn--block" onClick={onDone}>Continue</button>}
      </div>
    );
  }

  return (
    <div className="install">
      {!compact && <p className="eyebrow">Like an app, without the App Store</p>}
      <h2 className="display install__title">Put Cherry on your Home Screen</h2>
      <p className="install__lead">Full screen, its own icon, opens in one tap. Takes 10 seconds.</p>

      {os === 'ios' && (
        <ol className="install__steps">
          <Step n={1} delay={0.05}>
            Tap <b>Share</b> <span className="kbd"><Icon name="share" size={16} /></span> in Safari's toolbar
            <small>On iPhone it's at the bottom. In Chrome, it's next to the address bar.</small>
          </Step>
          <Step n={2} delay={0.15}>Scroll and tap <b>Add to Home Screen</b> <span className="kbd"><Icon name="plus" size={14} stroke={2.6} /></span></Step>
          <Step n={3} delay={0.25}>Tap <b>Add</b>. Done: open Cherry from its icon.</Step>
        </ol>
      )}
      {os !== 'ios' && canPromptInstall() && (
        <button className="btn btn--ink btn--block" onClick={async () => { if (await promptInstall()) setInstalled(true); }}>
          <Icon name="plus" stroke={2.6} /> Install Cherry
        </button>
      )}
      {os === 'android' && !canPromptInstall() && (
        <ol className="install__steps">
          <Step n={1} delay={0.05}>Open the <b>⋮</b> menu in Chrome</Step>
          <Step n={2} delay={0.15}>Tap <b>Add to Home screen</b> or <b>Install app</b></Step>
        </ol>
      )}
      {os === 'desktop' && !canPromptInstall() && (
        <p className="install__lead">On your computer, Cherry works right here in the browser. Open <b>hellocherry.app</b> on your phone to add it to your Home Screen.</p>
      )}
      {onDone && <button className="flow__link" onClick={onDone}>{os === 'desktop' ? 'Continue' : "I've added it"}</button>}
    </div>
  );
}

function Step({ n, children, delay }: { n: number; children: React.ReactNode; delay: number }) {
  return (
    <motion.li initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <span className="install__n">{n}</span>
      <div>{children}</div>
    </motion.li>
  );
}
