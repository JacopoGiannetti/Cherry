import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Embed } from '../lib/types';
import { instagramVideo } from '../lib/api';

// Il video originale, sempre dai server della piattaforma.
// TikTok (Embed Player) si comanda via postMessage: salto allo spezzone e
// loop, come la Dynamic view dell'app. Instagram: l'embed in un iframe non si
// può comandare, quindi si prende il file del reel sul CDN di Instagram e lo si
// riproduce in un <video> nostro (come fa l'app iOS dentro la pagina embed).
// Se il file non si trova, resta l'embed: si guarda e basta.

export type PlayerHandle = {
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  mute: (m: boolean) => void;
};

type Props = {
  embed: Embed;
  /** Per i reel che la pagina embed non espone: il backend li chiede al servizio dell'import. */
  recipeId?: string;
  /** Il player si può comandare (salto e loop). */
  onControl?: (on: boolean) => void;
  onReady?: () => void;
  /** t = secondo corrente; duration = durata del video, quando il player la sa. */
  onTime?: (t: number, duration?: number) => void;
  onEnded?: () => void;
  onFail?: () => void;
  /** Instagram: il file del reel non c'è. Se passato, al posto dell'embed bloccato non si mostra niente
      (ci pensa chi usa il player, con un link al video originale). */
  onUnavailable?: () => void;
};

const TIKTOK_PARAMS = [
  'controls=0', 'autoplay=1', 'loop=0', 'muted=1', 'progress_bar=0', 'play_button=0',
  'volume_control=0', 'fullscreen_button=0', 'timestamp=0', 'rel=0', 'music_info=0',
  'description=0', 'native_context_menu=0', 'closed_caption=0',
].join('&');

export const VideoPlayer = forwardRef<PlayerHandle, Props>(function VideoPlayer(props, ref) {
  if (props.embed.type === 'instagram') return <InstagramPlayer {...props} shortcode={props.embed.shortcode} ref={ref} />;
  if (props.embed.type === 'file') return <NativePlayer {...props} src={props.embed.url} ref={ref} />;
  return <EmbedPlayer {...props} ref={ref} />;
});

const EmbedPlayer = forwardRef<PlayerHandle, Props>(function EmbedPlayer({ embed, onReady, onTime, onEnded, onFail, onControl }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cbs = useRef({ onReady, onTime, onEnded, onFail });
  cbs.current = { onReady, onTime, onEnded, onFail };
  useEffect(() => { onControl?.(embed.type === 'tiktok'); }, [embed]);

  const send = (type: string, value?: unknown) => {
    if (embed.type !== 'tiktok') return;
    frame.current?.contentWindow?.postMessage({ type, value, 'x-tiktok-player': true }, '*');
  };

  useImperativeHandle(ref, () => ({
    seek: (t) => send('seekTo', t),
    play: () => send('play'),
    pause: () => send('pause'),
    mute: (m) => send(m ? 'mute' : 'unMute'),
  }), [embed]);

  useEffect(() => {
    if (embed.type !== 'tiktok') return;
    let ready = false;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      let d: any = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (!d || !d['x-tiktok-player']) return;
      if (d.type === 'onPlayerReady') { ready = true; cbs.current.onReady?.(); }
      else if (d.type === 'onCurrentTime') cbs.current.onTime?.(Number(d.value?.currentTime), Number(d.value?.duration) || undefined);
      else if (d.type === 'onStateChange' && Number(d.value) === 0) cbs.current.onEnded?.();
    };
    window.addEventListener('message', onMessage);
    const t = setTimeout(() => { if (!ready) cbs.current.onFail?.(); }, 15000);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(t); };
  }, [embed]);

  const src = embed.type === 'tiktok'
    ? `https://www.tiktok.com/player/v1/${embed.postId}?${TIKTOK_PARAMS}`
    : embed.type === 'instagram' ? `https://www.instagram.com/reel/${embed.shortcode}/embed/` : '';

  return (
    <iframe
      ref={frame}
      key={src}
      src={src}
      title="Original recipe video"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#000' }}
    />
  );
});

// ---------- Instagram: il file del reel; poi lo stesso <video> dei video tuoi ----------

const InstagramPlayer = forwardRef<PlayerHandle, Props & { shortcode: string }>(function InstagramPlayer(props, ref) {
  const { shortcode, recipeId } = props;
  const [src, setSrc] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setSrc(undefined);
    instagramVideo(shortcode, recipeId).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [shortcode, recipeId]);

  // Prima dei return: gli hook vanno chiamati sempre nello stesso ordine.
  useEffect(() => { if (src === null) props.onUnavailable?.(); }, [src]);

  if (src === undefined) return <div className="cook__wait"><span className="spinner" /></div>;
  if (src === null) return props.onUnavailable ? null : <EmbedPlayer {...props} />;
  return (
    <NativePlayer {...props} ref={ref} src={src}
      // Il link del CDN può essere scaduto: se ne chiede uno nuovo, una volta sola; poi l'embed.
      refresh={() => instagramVideo(shortcode, recipeId, true)}
      onGiveUp={() => setSrc(null)} />
  );
});

/** Un file video normale, comandato da noi: salto allo spezzone, loop, audio. */
const NativePlayer = forwardRef<PlayerHandle, Props & { src: string; refresh?: () => Promise<string | null>; onGiveUp?: () => void }>(
  function NativePlayer({ src: initial, refresh, onGiveUp, onReady, onTime, onEnded, onControl, onFail }, ref) {
    const [src, setSrc] = useState(initial);
    const video = useRef<HTMLVideoElement>(null);
    const retried = useRef(false);
    const cbs = useRef({ onReady, onTime, onEnded });
    cbs.current = { onReady, onTime, onEnded };

    useEffect(() => { setSrc(initial); retried.current = false; }, [initial]);
    useEffect(() => { onControl?.(true); }, []);

    // timeupdate arriva 4 volte al secondo: troppo poco per chiudere il loop sul punto giusto.
    useEffect(() => {
      const v = video.current;
      if (!v) return;
      let raf = 0;
      const tick = () => { cbs.current.onTime?.(v.currentTime, v.duration || undefined); raf = requestAnimationFrame(tick); };
      const start = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
      const stop = () => { cancelAnimationFrame(raf); cbs.current.onTime?.(v.currentTime, v.duration || undefined); };
      v.addEventListener('playing', start);
      v.addEventListener('pause', stop);
      v.addEventListener('seeked', stop);
      return () => { cancelAnimationFrame(raf); v.removeEventListener('playing', start); v.removeEventListener('pause', stop); v.removeEventListener('seeked', stop); };
    }, [src]);

    useImperativeHandle(ref, () => ({
      seek: (t) => { const v = video.current; if (v) v.currentTime = Math.max(0, t); },
      play: () => { video.current?.play().catch(() => {}); },
      pause: () => video.current?.pause(),
      mute: (m) => { if (video.current) video.current.muted = m; },
    }), [src]);

    return (
      <video
        ref={video}
        key={src}
        src={src}
        playsInline
        muted
        autoPlay
        preload="auto"
        onLoadedMetadata={() => cbs.current.onReady?.()}
        onEnded={() => cbs.current.onEnded?.()}
        onError={async () => {
          if (refresh && !retried.current) {
            retried.current = true;
            const u = await refresh();
            if (u && u !== src) { setSrc(u); return; }
          }
          if (onGiveUp) onGiveUp(); else onFail?.();
        }}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }}
      />
    );
  });
