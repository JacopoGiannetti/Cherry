import { useState } from 'react';
import { resetPassword, signInWithEmail, signUpWithEmail } from '../lib/auth';

// I domini più usati negli USA: chi sbaglia di una o due lettere (gmial.com, iclod.com) riceve il suggerimento.
const DOMAINS = ['gmail.com', 'icloud.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'me.com', 'mac.com',
  'live.com', 'msn.com', 'comcast.net', 'att.net', 'verizon.net', 'sbcglobal.net', 'protonmail.com', 'proton.me', 'ymail.com', 'gmx.com'];

function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

// Domini veri e vicini a quelli sopra: non vanno mai "corretti".
const REAL = ['mail.com', 'email.com', 'gmx.net', 'me.org', 'live.net', 'aim.com', 'att.com', 'ymail.net'];

/** L'email corretta se il dominio sembra un errore di battitura di uno comune, altrimenti null. */
export function suggestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const domain = email.slice(at + 1);
  if (domain.length < 4 || DOMAINS.includes(domain) || REAL.includes(domain)) return null;
  let best: string | null = null;
  let bestD = 3;
  for (const d of DOMAINS) {
    const n = distance(domain, d);
    if (n < bestD) { bestD = n; best = d; }
  }
  // Due lettere di differenza solo sui domini lunghi: su quelli corti si confonderebbero domini veri.
  if (!best || (bestD === 2 && domain.length < 10)) return null;
  return `${raw.trim().slice(0, at)}@${best}`;
}

/** Email e password nella pagina: niente finestre esterne, quindi funziona anche dentro Instagram e Facebook.
 *  Dopo il login ci pensa chi osserva l'utente (onboarding, SignIn) a portarlo avanti. */
export function EmailAuth({ mode }: { mode: 'signup' | 'signin' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const [touched, setTouched] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const suggestion = touched ? suggestEmail(email) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setNote(null);
    setTouched(true);
    if (mode === 'signup' && suggestEmail(email) && !confirmed) { setConfirmed(true); setError(null); return; }
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
        placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} />
      {suggestion && (
        <button type="button" className="nx-email__hint" onClick={() => { setEmail(suggestion); setError(null); }}>
          Did you mean <b>{suggestion.slice(suggestion.indexOf('@'))}</b>?
        </button>
      )}
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
