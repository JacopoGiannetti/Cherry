import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Icon } from './Icon';
import { importRecipe } from '../lib/api';
import { extractLink } from '../lib/kitchen';

// Incolla un link: la ricetta compare nel ricettario e si riempie da sola.
// Vive nel pannello che sale dal +, e da sola sulla pagina /add (condivisione).

export function AddRecipe({ onDone, autoLink }: { onDone?: () => void; autoLink?: string }) {
  const [, navigate] = useLocation();
  const [value, setValue] = useState(autoLink || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const submit = async (raw = value) => {
    const link = extractLink(raw.trim());
    if (!link) { setError('That doesn’t look like a TikTok or Instagram link.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { id } = await importRecipe(link);
      onDone?.();
      navigate(`/r/${id}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoLink && extractLink(autoLink) && !started.current) { started.current = true; submit(autoLink); }
  }, []);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const link = extractLink(text || '');
      if (link) { setValue(link); submit(link); } else { setError('Copy a TikTok or Instagram link first, then tap Paste.'); input.current?.focus(); }
    } catch {
      input.current?.focus();
    }
  };

  return (
    <div className="add">
      <h2 className="add__title">Add a recipe</h2>
      <p className="add__lead">Paste a TikTok or Instagram link. Cherry writes the recipe and syncs every step to the video.</p>

      <button className={`btn btn--cherry btn--block ${busy ? 'is-busy' : ''}`} onClick={paste} disabled={busy}>
        <Icon name="paste" size={19} /> {busy ? 'Reading the link' : 'Paste link'}
      </button>

      <form className="field" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Icon name="link" size={18} />
        <input ref={input} value={value} onChange={(e) => { setValue(e.target.value); setError(null); }}
          inputMode="url" autoComplete="off" placeholder="or type the link" aria-label="Recipe link" />
        {value.trim() && <button type="submit" className="field__go" disabled={busy} aria-label="Add"><Icon name="next" size={18} stroke={2.6} /></button>}
      </form>
      {error && <p className="add__err" role="alert">{error}</p>}

      <ol className="add__how">
        <li><span>1</span>Open the recipe on TikTok or Instagram</li>
        <li><span>2</span>Tap Share, then Copy link</li>
        <li><span>3</span>Come back and tap Paste link</li>
      </ol>
      <button className="add__own" onClick={() => { onDone?.(); navigate('/new'); }}>
        <span className="add__own-icon"><Icon name="pencil" size={18} /></span>
        <span><b>Write your own recipe</b><small>Your ingredients, steps, photo and video</small></span>
        <Icon name="next" size={18} />
      </button>
    </div>
  );
}
