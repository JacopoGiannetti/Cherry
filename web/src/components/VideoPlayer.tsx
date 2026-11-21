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
  onTime?: (t: number) => void;
  onEnded?: () => void;
  onFail?: () => void;
};

const TIKTOK_PARAMS = [
  'controls=0', 'autoplay=1', 'loop=0', 'muted=1', 'progress_bar=0', 'play_button=0',
  'volume_control=0', 'fullscreen_button=0', 'timestamp=0', 'rel=0', 'music_info=0',
  'description=0', 'native_context_menu=0', 'closed_caption=0',
].join('&');

export const VideoPlayer = forwardRef<PlayerHandle, Props>(function VideoPlayer(props, ref) {
  if (props.embed.type === 'instagram') return <InstagramPlayer {...props} shortcode={props.embed.shortcode} ref={ref} />;
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
      else if (d.type === 'onCurrentTime') cbs.current.onTime?.(Number(d.value?.currentTime));
      else if (d.type === 'onStateChange' && Number(d.value) === 0) cbs.current.onEnded?.();
    };
    window.addEventListener('message', onMessage);
    const t = setTimeout(() => { if (!ready) cbs.current.onFail?.(); }, 15000);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(t); };
  }, [embed]);

  const src = embed.type === 'tiktok'
    ? `https://www.tiktok.com/player/v1/${embed.postId}?${TIKTOK_PARAMS}`
    : `https://www.instagram.com/reel/${embed.shortcode}/embed/`;

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

// ---------- Instagram: il file del reel in un <video> nostro ----------

const InstagramPlayer = forwardRef<PlayerHandle, Props & { shortcode: string }>(function InstagramPlayer(props, ref) {
  const { shortcode, recipeId, onReady, onTime, onEnded, onControl } = props;
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const video = useRef<HTMLVideoElement>(null);
  const retried = useRef(false);
  const cbs = useRef({ onReady, onTime, onEnded });
  cbs.current = { onReady, onTime, onEnded };

  useEffect(() => {
    let live = true;
    retried.current = false;
    setSrc(undefined);
    instagramVideo(shortcode, recipeId).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [shortcode, recipeId]);

  useEffect(() => { if (src !== undefined) onControl?.(!!src); }, [src]);

  // timeupdate arriva 4 volte al secondo: troppo poco per chiudere il loop sul punto giusto.
  useEffect(() => {
    const v = video.current;
    if (!src || !v) return;
    let raf = 0;
    const tick = () => { cbs.current.onTime?.(v.currentTime); raf = requestAnimationFrame(tick); };
    const start = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const stop = () => cancelAnimationFrame(raf);
    v.addEventListener('playing', start);
    v.addEventListener('pause', stop);
    return () => { stop(); v.removeEventListener('playing', start); v.removeEventListener('pause', stop); };
  }, [src]);

  useImperativeHandle(ref, () => ({
    seek: (t) => { const v = video.current; if (v) v.currentTime = Math.max(0, t); },
    play: () => { video.current?.play().catch(() => {}); },
    pause: () => video.current?.pause(),
    mute: (m) => { if (video.current) video.current.muted = m; },
  }), [src]);

  if (src === undefined) return <div className="cook__wait"><span className="spinner" /></div>;
  if (src === null) return <EmbedPlayer {...props} />;
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
      onError={() => {
        // Il link del CDN può essere scaduto: se ne chiede uno nuovo, una volta sola; poi l'embed.
        if (retried.current) { setSrc(null); return; }
        retried.current = true;
        instagramVideo(shortcode, recipeId, true).then((u) => setSrc(u && u !== src ? u : null));
      }}
      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }}
    />
  );
});
