import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { GoogleButton } from '../../components/GoogleButton';
import { EmailAuth } from '../../components/EmailAuth';
import '../../styles/flow-next.css';
import '../../styles/signin.css';
import { Icon } from '../../components/Icon';
import { motion } from 'motion/react';
import { useSession } from '../../lib/store';
import { takeNext } from '../../lib/next';

/** Per chi ha già l'account: login e dritto dentro (o al paywall). */
export function SignIn() {
  const [, navigate] = useLocation();
  const { user, entitled, ready } = useSession();
  useEffect(() => {
    if (ready && user) navigate(entitled ? takeNext() || '/' : '/join');
  }, [ready, user, entitled]);
  return (
    <div className="signin">
      {/* Lo sfondo: una tavola apparecchiata, sfocata. Atmosfera, non decorazione. */}
      <div className="signin__bg" aria-hidden="true" />
      <Link href="/start" className="signin__back" aria-label="Back"><Icon name="back" /></Link>
      <motion.section className="signin__card" initial={{ opacity: 0, y: 26, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 26 }}>
        {/* In cima alla scheda, il logo di Cherry: una tessera sola, come l'icona dell'app. */}
        <motion.span className="signin__logo" aria-hidden="true" initial={{ scale: 0.5, rotate: -18, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.1 }}>
          <img src="/assets/mascot.png" alt="" />
        </motion.span>
        <h1 className="signin__title">Sign in to Cherry</h1>
        <EmailAuth mode="signin" />
        <div className="signin__or"><span>or</span></div>
        <GoogleButton />
      </motion.section>
    </div>
  );
}
