import { useEffect, useRef, useState } from 'react';
import '../styles/phone.css';

/**
 * Un iPhone con dentro l'app vera: una registrazione dello schermo di Cherry (ricettario,
 * ricetta, cook mode) che gira da sola, muta, in loop. La cornice è disegnata in CSS,
 * così resta nitida a ogni grandezza; il video parte solo quando si vede.
 */
const CLIPS = ['tiktok', 'recipe', 'instagram', 'groceries', 'finish'];

export function PhoneDemo({ className = '' }: { className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [n, setN] = useState(0);
  const visible = useRef(false);
  useEffect(() => {
    const v = video.current;
    if (!v || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      visible.current = e.isIntersecting;
      if (e.isIntersecting) v.play().catch(() => { /* autoplay negato: resta l'immagine */ });
      else v.pause();
    }, { threshold: 0.2 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  // Finita una clip parte la successiva: cook mode, ricetta, foto degli step, spesa, finale.
  useEffect(() => { if (visible.current) video.current?.play().catch(() => {}); }, [n]);
  const clip = CLIPS[n];
  return (
    <div className={`phone ${className}`} aria-label="Cherry on an iPhone: the cookbook, a recipe and cook mode">
      <div className="phone__screen">
        <video ref={video} key={clip} src={`/assets/demo/clip-${clip}.mp4`} poster={`/assets/demo/clip-${clip}.jpg`}
          muted playsInline preload="metadata" disablePictureInPicture autoPlay onEnded={() => setN((x) => (x + 1) % CLIPS.length)} />
        <i className="phone__island" aria-hidden="true" />
      </div>
    </div>
  );
}
