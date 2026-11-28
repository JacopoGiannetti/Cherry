import { useState } from 'react';
import { resetPassword, signInWithEmail, signUpWithEmail } from '../lib/auth';

/** Email e password nella pagina: niente finestre esterne, quindi funziona anche dentro Instagram e Facebook.
 *  Dopo il login ci pensa chi osserva l'utente (onboarding, SignIn) a portarlo avanti. */
export function EmailAuth({ mode }: { mode: 'signup' | 'signin' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
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
      {/* Ogni campo ha la sua icona davanti (si vede nella schermata di accesso). */}
      <label className="nx-email__field">
        <svg className="nx-email__ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2.2V8l8 4.9L20 8v-.8l-8 4.9L4 7.2Z" /></svg>
        <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
          placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {/* La password si può guardare mentre la scrivi: un errore di battitura in meno. */}
      <label className="nx-email__field nx-email__pw">
        <svg className="nx-email__ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10V8a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1Zm2.2 0h5.6V8a2.8 2.8 0 0 0-5.6 0v2Z" /></svg>
        <input type={show ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="Password" aria-label="Password"
          autoCapitalize="none" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="button" className="nx-email__eye" onClick={(e) => { e.preventDefault(); setShow((v) => !v); }} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" />
            {!show && <path d="M4 4l16 16" />}
          </svg>
        </button>
      </label>
      {error && <p className="err" role="alert">{error}</p>}
      {note && <p className="nx-email__note">{note}</p>}
      <button type="submit" className="btn btn--ink btn--block" disabled={busy}>
        {busy ? <span className="spinner" /> : mode === 'signup' ? 'Sign up' : 'Sign in'}
      </button>
      {mode === 'signin' && <button type="button" className="nx-email__forgot" onClick={forgot}>Forgot password?</button>}
    </form>
  );
}
