import { useState } from 'react';
import { resetPassword, signInWithEmail, signUpWithEmail } from '../lib/auth';

/** Email e password nella pagina: niente finestre esterne, quindi funziona anche dentro Instagram e Facebook.
 *  Dopo il login ci pensa chi osserva l'utente (onboarding, SignIn) a portarlo avanti. */
export function EmailAuth({ mode }: { mode: 'signup' | 'signin' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setNote(null);
    if (!validEmail) { setError('Enter a valid email.'); return; }
    if (password.length < 6) { setError(mode === 'signup' ? 'Use at least 6 characters for the password.' : 'Enter your password.'); return; }
    setBusy(true);
    setError(null);
    try {
      await (mode === 'signup' ? signUpWithEmail(email, password) : signInWithEmail(email, password));
    } catch (err: any) {
      const code = String(err?.code || '').replace('auth/', '');
      setError(code === 'wrong-password' || code === 'invalid-credential' || code === 'invalid-login-credentials' || code === 'user-not-found'
        ? (mode === 'signup'
          ? 'This email already has an account. Check the password or use Continue with Google.'
          : 'Wrong email or password. If you signed up with Google, use Continue with Google.')
        : code === 'invalid-email' ? 'Enter a valid email.'
        : code === 'weak-password' ? 'Use at least 6 characters for the password.'
        : code === 'too-many-requests' ? 'Too many attempts. Wait a minute and try again.'
        : code === 'network-request-failed' ? 'No connection. Check your internet and try again.'
        : `That did not work (${code || 'unknown'}). Try again.`);
      setBusy(false);
    }
  };

  const forgot = async () => {
    setError(null);
    if (!validEmail) { setError('Enter your email first, then tap Forgot password.'); return; }
    await resetPassword(email).catch(() => {});
    setNote(`If ${email.trim()} has an account, we sent a link to reset the password.`);
  };

  return (
    <form className="nx-email" onSubmit={submit} noValidate>
      <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
        placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="Password" aria-label="Password"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="err" role="alert">{error}</p>}
      {note && <p className="nx-email__note">{note}</p>}
      <button type="submit" className="btn btn--ink btn--block" disabled={busy}>
        {busy ? <span className="spinner" /> : mode === 'signup' ? 'Sign up' : 'Sign in'}
      </button>
      {mode === 'signin' && <button type="button" className="nx-email__forgot" onClick={forgot}>Forgot password?</button>}
    </form>
  );
}
