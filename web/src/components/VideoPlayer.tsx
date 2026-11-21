import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Embed } from '../lib/types';

// Il video originale, sempre dal player ufficiale della piattaforma.
// TikTok (Embed Player) si comanda via postMessage: salto allo spezzone e
// loop, come la Dynamic view dell'app. L'embed di Instagram non ha
// comandi: si guarda e basta, e i passi mostrano i loro minuti.

export type PlayerHandle = {
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  mute: (m: boolean) => void;
};

type Props = {
  embed: Embed;
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

export const VideoPlayer = forwardRef<PlayerHandle, Props>(function VideoPlayer({ embed, onReady, onTime, onEnded, onFail }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cbs = useRef({ onReady, onTime, onEnded, onFail });
  cbs.current = { onReady, onTime, onEnded, onFail };

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
