import { useEffect, useState } from 'react';
import '../styles/review.css';
import { Sheet } from './Sheet';
import { toast } from './Toast';
import { api } from '../lib/api';
import { IS_MOCK } from '../lib/store';

// La richiesta di recensione. Compare dopo un momento riuscito (ha finito di cucinare una
// ricetta) oppure alla terza volta che apre l'app, mai mentre cucina. Si chiede al massimo
// due volte: chi la chiude non la rivede per due settimane, chi tocca le stelle mai più.
// Le stelle partono subito verso il server; il testo è un secondo invio facoltativo.
// Si leggono in dashboard: Cherry → Recensioni.

type Trigger = 'cook' | 'visit';
type Memo = { done?: boolean; asked?: number; until?: number; opens?: number };
const KEY = 'cherry.review';
const SNOOZE_MS = 14 * 864e5;

const read = (): Memo => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
const write = (m: Memo) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage spento: si richiederà */ } };

let show: ((t: Trigger) => void) | null = null;

function due() {
  const m = read();
  return !m.done && (m.asked || 0) < 2 && !(m.until && Date.now() < m.until);
}

/** Chiede la recensione, se è il momento. Aspetta che la schermata sotto sia tornata ferma. */
export function askReview(trigger: Trigger) {
  if (!due()) return;
  setTimeout(() => {
    // Mai sopra la cook mode: lì le mani sono occupate.
    if (location.pathname.includes('/cook/') || !due()) return;
    show?.(trigger);
  }, trigger === 'cook' ? 900 : 2500);
}

/** Una volta per sessione del browser: alla terza apertura dell'app si chiede. */
export function countOpen() {
  try {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, '1');
  } catch { return; }
  const m = read();
  if (m.done) return;
  const opens = (m.opens || 0) + 1;
  write({ ...m, opens });
  if (opens >= 3) askReview('visit');
}

const send = (body: Record<string, unknown>) => (IS_MOCK ? Promise.resolve() : api('/review', body));

export function ReviewHost() {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    show = (t) => { setStars(0); setText(''); setShare(false); setTrigger(t); };
    return () => { show = null; };
  }, []);

  const close = () => {
    // Chiusa senza stelle: se ne riparla tra due settimane (e al massimo un'altra volta).
    if (!stars) { const m = read(); write({ ...m, asked: (m.asked || 0) + 1, until: Date.now() + SNOOZE_MS }); }
    setTrigger(null);
  };

  const rate = (n: number) => {
    navigator.vibrate?.(6);
    setStars(n);
    write({ ...read(), done: true });
    send({ stars: n, trigger }).catch(() => { /* il testo, se arriva, le riporta */ });
  };

  const submit = async () => {
    const body = text.trim();
    if (!body) { setTrigger(null); toast('Thank you!'); return; }
    setBusy(true);
    try {
      await send({ stars, text: body, allowPublic: stars >= 4 && share, trigger });
      setTrigger(null);
      toast('Thank you! We read every one.');
    } catch {
      toast("Couldn't send it. Try again in a moment.", 'close');
    } finally { setBusy(false); }
  };

  const happy = stars >= 4;
  return (
    <Sheet open={trigger !== null} onClose={close} label="Rate Cherry">
      <div className="review">
        <h2 className="display review__title">{!stars ? "How's Cherry so far?" : happy ? 'That made our day.' : 'Thanks for being honest.'}</h2>
        <p className="review__lead">{!stars ? 'Tap a star. It takes two seconds.' : happy ? 'What do you like most about it?' : 'What went wrong? We read every one.'}</p>
        <div className="review__stars" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} className={n <= stars ? 'on' : ''} onClick={() => rate(n)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z" /></svg>
            </button>
          ))}
        </div>
        {stars > 0 && (
          <>
            <textarea className="review__text" value={text} onChange={(e) => setText(e.target.value)} maxLength={1200} rows={4}
              placeholder={happy ? 'A line or two is plenty.' : 'Tell us what to fix.'} aria-label="Your review" />
            {happy && (
              <label className="review__share">
                <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
                <span>You can share this with my first name</span>
              </label>
            )}
            <button className="btn btn--cherry btn--block" onClick={submit} disabled={busy}>{text.trim() ? 'Send' : 'Done'}</button>
          </>
        )}
        {!stars && <button className="review__later" onClick={close}>Not now</button>}
      </div>
    </Sheet>
  );
}
