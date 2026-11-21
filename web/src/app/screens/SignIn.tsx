import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { GoogleButton } from '../../components/GoogleButton';
import { Icon, Logo } from '../../components/Icon';
import { useSession } from '../../lib/store';

/** Per chi ha già l'account: login e dritto dentro (o al paywall). */
export function SignIn() {
  const [, navigate] = useLocation();
  const { user, entitled, ready } = useSession();
  useEffect(() => {
    if (ready && user) navigate(entitled ? '/' : '/join');
  }, [ready, user, entitled]);
  return (
    <div className="flow">
      <header className="flow__top">
        <Link href="/start" className="icon-btn" aria-label="Back"><Icon name="back" /></Link>
        <span />
      </header>
      <section className="flow__body save">
        <Logo size={40} />
        <h1 className="display save__title" style={{ marginTop: 28 }}>Welcome back</h1>
        <p className="save__lead">Sign in to open your cookbook.</p>
        <GoogleButton />
      </section>
    </div>
  );
}
