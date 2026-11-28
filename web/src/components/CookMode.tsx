import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Recipe, Segment } from '../lib/types';
import { fmtTime, guessItem, scaleQuantity, section } from '../lib/kitchen';
import { Icon } from './Icon';
import { Swap } from './Swap';
import { Lightbox } from './Lightbox';
import { repairSegments } from '../lib/timecode';
import { preload } from '../lib/img';
import { VideoPlayer, type PlayerHandle } from './VideoPlayer';
import '../styles/cook-orig.css';

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
  if (segs.length < 2) return recipe.steps.map((_, i) => ({ start: 0, end: 0, title: '', steps: [i], ingredients: [], fromVideo: false }));
  // Passi senza spezzone (ricette sincronizzate a mano solo in parte): pagine senza video, al loro posto.
  const covered = new Set(segs.flatMap((s) => s.steps));
  const loose: Page[] = recipe.steps.map((_, i) => i).filter((i) => !covered.has(i))
    .map((i) => ({ start: 0, end: 0, title: '', steps: [i], ingredients: [], fromVideo: false }));
  return [...segs, ...loose].sort((a, b) => Math.min(...a.steps) - Math.min(...b.steps));
}

export function CookMode({ recipe, factor = 1, onClose, onDone, limit, onUnlock }: {
  recipe: Recipe; factor?: number; onClose: () => void; onDone?: () => void;
  /** Anteprima: solo i primi passi, poi l'invito a sbloccare il resto. */
  limit?: number; onUnlock?: () => void;
}) {
  // La durata vera del video (la dice il player): serve a correggere i tempi salvati male oltre il minuto.
  const [videoSeconds, setVideoSeconds] = useState(0);
  const all = useMemo(() => {
    const fixed = repairSegments(recipe.segments, videoSeconds);
    return pagesFor(fixed ? { ...recipe, segments: fixed } : recipe);
  }, [recipe, videoSeconds]);
  const locked = !!limit && all.length > limit;
  const pages = useMemo(() => (locked ? all.slice(0, limit) : all), [all, locked, limit]);
  const lastIndex = locked ? pages.length : pages.length - 1;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  // Instagram senza file del reel: niente riquadro grande bloccato, solo un link al video originale.
  const [igOff, setIgOff] = useState(false);
  // Gli ingredienti del passo: chiusi sono solo emoji; aperti restano aperti anche nei passi dopo.
  const [showIngs, setShowIngs] = useState(false);
  const player = useRef<PlayerHandle>(null);
  const ready = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const state = useRef({ index, paused });
  state.current = { index, paused };

  const embed = recipe.embed;
  // Instagram con i fotogrammi degli step: il video grande non serve, resta il link piccolo.
  const frames = useMemo(() => new Map((recipe.stepFrames || []).map((f) => [f.step, f.frames])), [recipe.stepFrames]);
  const hasFrames = frames.size > 0;
  const stills = embed?.type === 'instagram' && hasFrames;
  // Si stanno preparando (circa un minuto dopo l'import): si vede che arrivano, non che mancano.
  // Oltre 6 minuti si smette di aspettare: il server si è fermato a metà.
  // Vale anche quando si rifanno dal menu: le vecchie lasciano il posto ai riquadri che pulsano.
  const preparing = !!embed && recipe.stepFramesStatus === 'working'
    && Date.now() - (recipe.stepFramesSince || 0) < 6 * 60e3;
  const compact = igOff || stills || (embed?.type === 'instagram' && preparing);
  // TikTok: il video in loop è un'opzione in più. Chi vuole solo le foto lo chiude, e resta chiuso
  // anche nelle prossime ricette finché non lo riapre.
  const [videoOff, setVideoOff] = useState(() => { try { return localStorage.getItem('cherry.cook.video') === 'off'; } catch { return false; } });
  const tiktokOff = embed?.type === 'tiktok' && videoOff;
  const setVideo = (on: boolean) => {
    ready.current = false;
    setVideoOff(!on);
    try { localStorage.setItem('cherry.cook.video', on ? 'on' : 'off'); } catch { /* privato */ }
  };
  const showVideo = !!embed && !videoFailed && !compact && !tiktokOff;
  const showFrames = hasFrames && !preparing;
  // Le foto di uno step a tutto schermo: di quale step, e quale foto.
  const [zoom, setZoom] = useState<{ step: number; index: number } | null>(null);
  // Tutte le foto degli step subito, non una pagina alla volta (di solito le ha già scaricate la pagina della ricetta).
  useEffect(() => { preload((recipe.stepFrames || []).flatMap((f) => f.frames.map((x) => x.url))); }, [recipe.stepFrames]);
  // TikTok si comanda sempre; Instagram solo se si è trovato il file del reel.
  const [canControl, setCanControl] = useState(embed?.type === 'tiktok');
  const controlRef = useRef(canControl);
  const anyVideo = pages.some((p) => p.fromVideo);
  const controllable = canControl && anyVideo;
  const isControllable = () => controlRef.current && anyVideo;
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
    if (!ready.current || !p?.fromVideo || !isControllable()) return;
    player.current?.seek(p.start);
    state.current.paused ? player.current?.pause() : player.current?.play();
  };

  useEffect(() => {
    if (locked && index === pages.length) player.current?.pause(); else restart();
  }, [index]);

  const onTime = (t: number, duration?: number) => {
    if (duration && Math.abs(duration - videoSeconds) > 1) setVideoSeconds(duration);
    const p = pages[state.current.index];
    if (!p || state.current.paused || !isControllable()) return;
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
  // In orizzontale, senza video: a sinistra le foto dello step che stai leggendo, grandi.
  const sidePhotos = showFrames && !showVideo && page ? page.steps.flatMap((i) => (frames.get(i) || []).map((f, k) => ({ ...f, step: i, index: k }))) : [];
  const side = showFrames && !showVideo;

  return (
    <div className={`cook ${showVideo || side ? 'cook--split' : ''} ${side ? 'cook--side' : ''}`}>
      <header className="cook__top">
        <button className="icon-btn icon-btn--dark" onClick={onClose} aria-label="Close cook mode"><Icon name="close" /></button>
        <div className="cook__ticks" aria-hidden="true">
          {all.map((_, n) => <i key={n} className={n <= index ? 'on' : ''} />)}
        </div>
        <span className="cook__count">{Math.min(index + 1, all.length)}/{all.length}</span>
      </header>

      {showVideo && embed && (
        <section className="cook__video">
          <VideoPlayer
            ref={player}
            embed={embed}
            recipeId={recipe.id}
            onControl={(on) => { controlRef.current = on; setCanControl(on); }}
            onReady={() => { ready.current = true; player.current?.mute(muted); restart(); }}
            onTime={onTime}
            onEnded={() => { if (!state.current.paused) restart(); }}
            onFail={() => { if (embed.type !== 'instagram') setVideoFailed(true); }}
            onUnavailable={() => setIgOff(true)}
          />
          {controllable && (
            <div className="cook__controls">
              <button className="icon-btn icon-btn--glass" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
                <Swap id={paused ? 'play' : 'pause'}><Icon name={paused ? 'play' : 'pause'} fill={paused ? 'currentColor' : 'none'} /></Swap>
              </button>
              <button className="icon-btn icon-btn--glass" onClick={toggleMute} aria-label={muted ? 'Sound on' : 'Sound off'}>
                <Swap id={muted ? 'mute' : 'sound'}><Icon name={muted ? 'mute' : 'sound'} /></Swap>
              </button>
            </div>
          )}
          {embed.type === 'tiktok' && (
            <button className="cook__hide" onClick={() => setVideo(false)}><Icon name="image" size={15} /> {hasFrames ? 'Photos only' : 'Hide video'}</button>
          )}
          {controllable && page?.fromVideo && (
            <div className="cook__loop"><Icon name="refresh" size={13} stroke={2.6} /> Looping {fmtTime(page.start)}–{fmtTime(page.end)}</div>
          )}
        </section>
      )}
      {tiktokOff && !videoFailed && (
        // TikTok col video chiuso: una riga per riaprirlo, e tutto lo spazio a step e foto.
        <button type="button" className="cook__orig cook__orig--btn" onClick={() => setVideo(true)}>
          <span className="cook__orig-thumb">
            {recipe.imageUrl ? <img src={recipe.imageUrl} alt="" /> : null}
            <Icon name="play" size={16} fill="currentColor" />
          </span>
          <span><b>Show the video</b><small>Each step loops its moment</small></span>
          <Icon name="down" size={15} />
        </button>
      )}
      {side && (
        <aside className="cook__side" data-n={Math.min(sidePhotos.length, 4)} aria-label="Photos of this step">
          {sidePhotos.length ? sidePhotos.map((f) => (
            <button key={`${f.step}-${f.index}`} type="button" className="cook__sidephoto" onClick={() => setZoom({ step: f.step, index: f.index })} aria-label={f.caption || 'Enlarge photo'}>
              <img src={f.url} alt="" decoding="async" />
              {f.caption && <small>{f.caption}</small>}
            </button>
          )) : recipe.imageUrl ? <span className="cook__sidephoto"><img src={recipe.imageUrl} alt="" /></span> : null}
        </aside>
      )}
      {compact && (
        // Instagram non dà il file di questo reel: un link piccolo, e tutto lo spazio agli step.
        <a className="cook__orig" href={recipe.sourceUrl || `https://www.instagram.com/reel/${embed?.type === 'instagram' ? embed.shortcode : ''}/`} target="_blank" rel="noopener">
          {/* La copertina del reel, piccola, con il play sopra: si capisce subito che è il video. */}
          <span className="cook__orig-thumb">
            {recipe.imageUrl ? <img src={recipe.imageUrl} alt="" /> : null}
            <Icon name="play" size={16} fill="currentColor" />
          </span>
          <span><b>Open original video</b><small>No looping on Instagram</small></span>
          <Icon name="external" size={15} />
        </a>
      )}

      <div className="cook__pages" ref={scroller}>
        {pages.map((p, n) => (
          <article key={n} data-n={n} className="cook__page">
            <p className="cook__kicker">
              Step {n + 1} of {all.length}
              {p.fromVideo && <span>{fmtTime(p.start)}</span>}
            </p>
            {p.title && <h2 className="cook__title display">{p.title}</h2>}
            {p.ingredients.length > 0 && (
              <StepIngredients recipe={recipe} ids={p.ingredients} factor={factor} open={showIngs} onToggle={() => setShowIngs((o) => !o)} />
            )}
            {preparing && (
              <p className="cook__preparing" role="status"><span className="cook__spin" /> Picking photos from the video for each step…</p>
            )}
            <ol className="cook__steps">
              {p.steps.map((i) => (
                <li key={i}>
                  <span className="cook__num">{i + 1}</span>
                  <span className="cook__text">
                    {recipe.steps[i]}
                    {showFrames && frames.get(i)?.length ? (
                      <span className="cook__frames">
                        {frames.get(i)!.map((f, k) => (
                          <button key={k} type="button" className="cook__frame" onClick={() => setZoom({ step: i, index: k })} aria-label={f.caption || 'Enlarge photo'}>
                            <img src={f.url} alt="" decoding="async" />
                            {f.caption && <small>{f.caption}</small>}
                          </button>
                        ))}
                      </span>
                    ) : preparing ? (
                      <span className="cook__frames cook__frames--wait" aria-hidden="true"><i /><i /><i /></span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
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

      <Lightbox photos={zoom ? frames.get(zoom.step) || null : null} index={zoom?.index || 0}
        onIndex={(n) => setZoom((z) => (z ? { ...z, index: n } : z))} onClose={() => setZoom(null)} />

      <footer className="cook__bottom">
        <button className="icon-btn icon-btn--dark" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous step">
          <Icon name="back" />
        </button>
        <AnimatePresence mode="wait" initial={false}>
          <motion.button
            key={onLock ? 'unlock' : isLast ? 'done' : 'next'}
            className="btn btn--cherry cook__next"
            onClick={() => (onLock ? (onUnlock || onClose)() : isLast ? (onDone || onClose)() : go(index + 1))}
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

const emojiOf = (g: Recipe['ingredients'][number]) => g.emoji || guessItem(g.name).emoji || section(g.storeSection).emoji;

/** In cima al passo: le emoji di cosa serve. Si toccano e si aprono con nomi e quantità. */
function StepIngredients({ recipe, ids, factor, open, onToggle }: {
  recipe: Recipe; ids: number[]; factor: number; open: boolean; onToggle: () => void;
}) {
  const items = ids.map((i) => recipe.ingredients[i]).filter(Boolean);
  return (
    <div className={`step-ings ${open ? 'is-open' : ''}`}>
      <button className="step-ings__bar" onClick={onToggle} aria-expanded={open}>
        <span className="step-ings__emojis" aria-hidden="true">
          {items.slice(0, 5).map((g, n) => <span key={n} className="step-ings__dot">{emojiOf(g)}</span>)}
          {items.length > 5 && <span className="step-ings__dot step-ings__more">+{items.length - 5}</span>}
        </span>
        <span className="step-ings__label">{open ? 'Hide' : `${items.length} ingredient${items.length === 1 ? '' : 's'}`}</span>
        <motion.span className="step-ings__chev" animate={{ rotate: open ? 180 : 0 }}><Icon name="down" size={16} stroke={2.6} /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul className="step-ings__list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}>
            {items.map((g, n) => (
              <motion.li key={n} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * n }}>
                <span aria-hidden="true">{emojiOf(g)}</span>
                <b>{g.name}</b>
                {g.quantity && <em>{scaleQuantity(g.quantity, factor)}</em>}
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
