import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useLocation } from 'wouter';
import { Icon } from '../../components/Icon';
import { importRecipe } from '../../lib/api';
import { extractLink } from '../../lib/kitchen';
import { platform } from '../../lib/pwa';

/** Incolla il link: la ricetta compare subito nel ricettario e si riempie da sola. */
export function Add() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(location.search);
  // Condivisione da Android (share_target) o link ?u=…
  const incoming = params.get('u') || params.get('url') || params.get('text') || '';
  const first = params.has('first');
  const [value, setValue] = useState(extractLink(incoming) || '');
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
      navigate(`/r/${id}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  useEffect(() => {
    if (incoming && extractLink(incoming) && !started.current) { started.current = true; submit(incoming); }
  }, []);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const link = extractLink(text || '');
      if (link) { setValue(link); submit(link); } else { setError('No TikTok or Instagram link on your clipboard yet.'); input.current?.focus(); }
    } catch {
      input.current?.focus();
    }
  };

  const os = platform();

  return (
    <main className="screen add-hero">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Back"><Icon name="back" /></button>
        <span />
      </div>
      <p className="eyebrow">{first ? 'Your first recipe' : 'New recipe'}</p>
      <h1 className="display">Paste a recipe <em>video.</em></h1>
      <p>Cherry watches the whole video and writes every step, synced to the exact moment it happens.</p>

      <motion.button className="btn btn--cherry btn--block paste-big" onClick={paste} disabled={busy} whileTap={{ scale: 0.97 }}>
        {busy ? <><span className="spinner" style={{ borderTopColor: '#fff' }} /> Starting…</> : <><Icon name="paste" stroke={2.4} /> Paste link</>}
      </motion.button>

      <form className="linkbox" style={{ marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Icon name="link" />
        <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} inputMode="url" placeholder="…or type it here" aria-label="Recipe link" />
        <button className="btn btn--ink btn--sm" type="submit" disabled={busy || !value.trim()}>Go</button>
      </form>
      {error && <p className="err" role="alert">{error}</p>}

      <ol className="howlink">
        <li><span>1</span>Open the video on TikTok or Instagram</li>
        <li><span>2</span>{os === 'android' ? 'Tap Share, then Copy link (or share straight to Cherry)' : 'Tap Share, then Copy link'}</li>
        <li><span>3</span>Come back and tap Paste link</li>
      </ol>
    </main>
  );
}
