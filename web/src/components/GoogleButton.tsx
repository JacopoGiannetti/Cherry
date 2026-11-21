import { useState } from 'react';
import { signInWithGoogle, signInWithApple, APPLE_ENABLED } from '../lib/firebase';

/** Google e, quando è configurato, Apple. */
export function SignInButtons() {
  return (
    <div className="signin-buttons">
      {APPLE_ENABLED && <ProviderButton provider="apple" />}
      <ProviderButton provider="google" />
    </div>
  );
}

export function GoogleButton() {
  return <SignInButtons />;
}

function ProviderButton({ provider }: { provider: 'google' | 'apple' }) {
  const label = provider === 'apple' ? 'Continue with Apple' : 'Continue with Google';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const click = async () => {
    setBusy(true);
    setError(null);
    try {
      await (provider === 'apple' ? signInWithApple() : signInWithGoogle());
    } catch (e: any) {
      const code = String(e?.code || e?.message || 'unknown').replace('auth/', '');
      if (code === 'popup-closed-by-user' || code === 'cancelled-popup-request') return;
      console.error('[signin]', e);
      setError(code === 'popup-blocked'
        ? 'Your browser blocked the sign-in window. Allow pop-ups for hellocherry.app and try again.'
        : code === 'web-storage-unsupported' || code === 'operation-not-supported-in-this-environment'
          ? 'This browser can’t sign in. Open hellocherry.app in Safari or Chrome and try again.'
          : `${provider === 'apple' ? 'Apple' : 'Google'} sign-in did not work (${code}). Try again.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={`btn btn--block gbtn ${provider === 'apple' ? 'btn--ink' : 'btn--white'}`} onClick={click} disabled={busy}>
        {busy ? <span className="spinner" /> : provider === 'apple' ? (
          <svg width="18" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74s1.78.74 3 .72c1.24-.02 2.02-1.12 2.77-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.41-3.69zM14.1 5.86c.63-.77 1.06-1.83.94-2.89-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.28z"/></svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
        )}
        {label}
      </button>
      {error && <p className="err" role="alert">{error}</p>}
    </>
  );
}
