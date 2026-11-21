import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Recipe, Segment } from '../lib/types';
import { fmtTime, scaleQuantity } from '../lib/kitchen';
import { Icon } from './Icon';
import { VideoPlayer, type PlayerHandle } from './VideoPlayer';

type Page = Segment & { fromVideo: boolean };

/** Gli spezzoni mostrabili (come DynamicRecipeView.pages); senza, un passo per pagina. */
function pagesFor(recipe: Recipe): Page[] {
  const nS = recipe.steps.length;
  const nI = recipe.ingredients.length;
  const segs = (recipe.segments || [])
    .map((s) => ({
      ...s,
      steps: (s.steps || []).filter((i) => i >= 0 && i < nS),
      ingredients: (s.ingredients || []).filter((i) => i >= 0 && i < nI),
      fromVideo: true,
    }))
    .filter((s) => s.steps.length && s.end > s.start);
  if (segs.length >= 2) return segs;
  return recipe.steps.map((_, i) => ({ start: 0, end: 0, title: '', steps: [i], ingredients: [], fromVideo: false }));
}

export function CookMode({ recipe, factor = 1, onClose, limit, onUnlock }: {
  recipe: Recipe; factor?: number; onClose: () => void;
  /** Anteprima: solo i primi passi, poi l'invito a sbloccare il resto. */
  limit?: number; onUnlock?: () => void;
}) {
  const all = useMemo(() => pagesFor(recipe), [recipe]);
  const locked = !!limit && all.length > limit;
  const pages = useMemo(() => (locked ? all.slice(0, limit) : all), [all, locked, limit]);
  const lastIndex = locked ? pages.length : pages.length - 1;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  const player = useRef<PlayerHandle>(null);
  const ready = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const state = useRef({ index, paused });
  state.current = { index, paused };

  const embed = recipe.embed;
  const controllable = embed?.type === 'tiktok' && pages[0]?.fromVideo;
  const isLast = index >= lastIndex;
  const onLock = locked && index === pages.length;

  // Lo schermo resta acceso mentre si cucina.
  useEffect(() => {
    let lock: any = null;
    const request = async () => {
      try { lock = await (navigator as any).wakeLock?.request('screen'); } catch { /* non supportato */ }
    };
    request();
    const onVis = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.(); };
  }, []);

  // Frecce e spazio dalla tastiera.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(state.current.index + 1); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(state.current.index - 1); }
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pages.length]);

  // ---------- Loop sullo spezzone (logica del Coordinator iOS) ----------
  const restart = () => {
    const p = pages[state.current.index];
    if (!ready.current || !p?.fromVideo || !controllable) return;
    player.current?.seek(p.start);
    state.current.paused ? player.current?.pause() : player.current?.play();
  };

  useEffect(() => {
    if (locked && index === pages.length) player.current?.pause(); else restart();
  }, [index]);

  const onTime = (t: number) => {
    const p = pages[state.current.index];
    if (!p || state.current.paused || !controllable) return;
    if (t >= p.end - 0.15 || t < p.start - 1) restart();
  };

  function togglePlay() {
    setPaused((p) => {
      const next = !p;
      next ? player.current?.pause() : player.current?.play();
      return next;
    });
  }

  function toggleMute() {
    setMuted((m) => { player.current?.mute(!m); return !m; });
  }

  function go(n: number) {
    if (n < 0 || n > lastIndex) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-n="${n}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // La card che riempie lo schermo decide lo spezzone.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.6) {
          const n = Number((e.target as HTMLElement).dataset.n);
          setIndex(n);
          setPaused(false);
          navigator.vibrate?.(8);
        }
      }
    }, { root, threshold: [0.6] });
    root.querySelectorAll('[data-n]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pages]);

  const page = pages[index];

  return (
    <div className="cook">
      <header className="cook__top">
        <button className="icon-btn icon-btn--dark" onClick={onClose} aria-label="Close cook mode"><Icon name="close" /></button>
        <div className="cook__ticks" aria-hidden="true">
          {all.map((_, n) => <i key={n} className={n <= index ? 'on' : ''} />)}
        </div>
        <span className="cook__count">{Math.min(index + 1, all.length)}/{all.length}</span>
      </header>

      {embed && !videoFailed && (
        <section className="cook__video">
          <VideoPlayer
            ref={player}
            embed={embed}
            onReady={() => { ready.current = true; player.current?.mute(muted); restart(); }}
            onTime={onTime}
            onEnded={() => { if (!state.current.paused) restart(); }}
            onFail={() => { if (embed.type === 'tiktok') setVideoFailed(true); }}
          />
          {controllable && (
            <div className="cook__controls">
              <button className="icon-btn icon-btn--glass" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
                <Icon name={paused ? 'play' : 'pause'} fill={paused ? 'currentColor' : 'none'} />
              </button>
              <button className="icon-btn icon-btn--glass" onClick={toggleMute} aria-label={muted ? 'Sound on' : 'Sound off'}>
                <Icon name={muted ? 'mute' : 'sound'} />
              </button>
            </div>
          )}
          {controllable && page?.fromVideo && (
            <div className="cook__loop"><Icon name="refresh" size={13} stroke={2.6} /> Looping {fmtTime(page.start)}–{fmtTime(page.end)}</div>
          )}
        </section>
      )}
      {embed?.type === 'instagram' && page?.fromVideo && (
        <p className="cook__note">Instagram videos play in their own player: jump to <b>{fmtTime(page.start)}</b> for this step.</p>
      )}

      <div className="cook__pages" ref={scroller}>
        {pages.map((p, n) => (
          <article key={n} data-n={n} className="cook__page">
            <p className="cook__kicker">
              Step {n + 1} of {all.length}
              {p.fromVideo && <span>{fmtTime(p.start)}</span>}
            </p>
            {p.title && <h2 className="cook__title display">{p.title}</h2>}
            <ol className="cook__steps">
              {p.steps.map((i) => (
                <li key={i}>
                  <span className="cook__num">{i + 1}</span>
                  <span>{recipe.steps[i]}</span>
                </li>
              ))}
            </ol>
            {p.ingredients.length > 0 && (
              <div className="cook__ings">
                {p.ingredients.map((i) => {
                  const g = recipe.ingredients[i];
                  return (
                    <span key={i} className="cook__ing">
                      {g.emoji && <span>{g.emoji}</span>}
                      {g.name}
                      {g.quantity && <em>{scaleQuantity(g.quantity, factor)}</em>}
                    </span>
                  );
                })}
              </div>
            )}
          </article>
        ))}
        {locked && (
          <article data-n={pages.length} className="cook__page cook__lock">
            <span className="cook__lockicon"><Icon name="lock" size={22} /></span>
            <h2 className="cook__title display">{all.length - pages.length} more step{all.length - pages.length === 1 ? '' : 's'} to dinner.</h2>
            <p>Save this recipe to your cookbook to cook it all the way through, with every step looping like the ones you just saw.</p>
          </article>
        )}
      </div>

      <footer className="cook__bottom">
        <button className="icon-btn icon-btn--dark" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous step">
          <Icon name="back" />
        </button>
        <AnimatePresence mode="wait" initial={false}>
          <motion.button
            key={onLock ? 'unlock' : isLast ? 'done' : 'next'}
            className="btn btn--cherry cook__next"
            onClick={() => (onLock ? (onUnlock || onClose)() : isLast ? onClose() : go(index + 1))}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {onLock ? 'Save it and keep cooking' : isLast ? 'Done, enjoy!' : 'Next step'}
            <Icon name={onLock ? 'next' : isLast ? 'check' : 'down'} stroke={2.6} />
          </motion.button>
        </AnimatePresence>
      </footer>
    </div>
  );
}
