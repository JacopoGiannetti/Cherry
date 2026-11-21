import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useLocation } from 'wouter';
import { confirmCheckout } from '../../lib/api';
import { useSession } from '../../lib/store';
import { InstallGuide } from '../../components/InstallGuide';
import { Icon } from '../../components/Icon';
import { SUPPORT_EMAIL } from '../../lib/pwa';
import { loadFunnel } from '../../lib/funnel';

/** Ritorno da Stripe: si conferma l'abbonamento, festa, poi l'app sulla Home. */
export function Welcome() {
  const { user, entitled } = useSession();
  const [, navigate] = useLocation();
  const [stage, setStage] = useState<'confirming' | 'ready' | 'install' | 'error'>('confirming');
  const session = new URLSearchParams(location.search).get('session');
  const pending = loadFunnel().url;
  const first = pending ? `/add?u=${encodeURIComponent(pending)}` : '/add?first=1';
  const title = loadFunnel().recipe?.title;

  useEffect(() => {
    if (!user) return;
    if (entitled) { setStage((s) => (s === 'confirming' ? 'ready' : s)); return; }
    if (!session) { navigate('/join'); return; }
    let tries = 0;
    const attempt = () => confirmCheckout(session)
      .then((r) => { if (!r.entitled && ++tries < 6) setTimeout(attempt, 1500); else if (!r.entitled) setStage('error'); })
      .catch(() => { if (++tries < 6) setTimeout(attempt, 1500); else setStage('error'); });
    attempt();
  }, [user, entitled]);

  if (stage === 'install') {
    return (
      <div className="flow"><section className="flow__body">
        <InstallGuide onDone={() => navigate(first)} />
      </section></div>
    );
  }

  return (
    <div className="welcome">
      {stage === 'confirming' && (<><span className="spinner" style={{ width: 36, height: 36 }} /><p>Setting up your membership…</p></>)}
      {stage === 'error' && (
        <>
          <h1 className="display">Almost there</h1>
          <p>Your payment went through, we're just waiting for confirmation. This page will update by itself.</p>
          <a className="btn btn--ghost" href={`mailto:${SUPPORT_EMAIL}`}>Contact support</a>
        </>
      )}
      {stage === 'ready' && (
        <>
          <Confetti />
          <motion.img src="/assets/mascot.png" alt="" className="welcome__mascot"
            initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 11 }} />
          <motion.h1 className="display" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            You're <em>in</em>{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}.
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
            One last thing: put Cherry on your Home Screen so it opens like an app.
          </motion.p>
          <motion.button className="btn btn--cherry" onClick={() => setStage('install')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
            Add to Home Screen <Icon name="next" stroke={2.6} />
          </motion.button>
          <button className="flow__link" onClick={() => navigate(first)}>{title ? `Later, take me to ${title}` : 'Later, take me to my cookbook'}</button>
        </>
      )}
    </div>
  );
}

function Confetti() {
  const bits = Array.from({ length: 36 }, (_, i) => i);
  const colors = ['#E8334A', '#1B1313', '#DDD3C3', '#E8334A', '#FFFCF7'];
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((i) => (
        <motion.i key={i} style={{ background: colors[i % colors.length], left: `${(i * 37) % 100}%` }}
          initial={{ y: -40, rotate: 0, opacity: 1 }}
          animate={{ y: '105vh', rotate: 360 + i * 40, opacity: [1, 1, 0.6] }}
          transition={{ duration: 2.2 + (i % 5) * 0.35, delay: (i % 9) * 0.06, ease: [0.2, 0.6, 0.4, 1] }} />
      ))}
    </div>
  );
}
