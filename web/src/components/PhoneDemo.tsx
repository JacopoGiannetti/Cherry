import { useEffect, useRef } from 'react';
import '../styles/phone.css';

/**
 * Un iPhone con dentro l'app vera: una registrazione dello schermo di Cherry (ricettario,
 * ricetta, cook mode) che gira da sola, muta, in loop. La cornice è disegnata in CSS,
 * così resta nitida a ogni grandezza; il video parte solo quando si vede.
 */
export function PhoneDemo({ className = '' }: { className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play().catch(() => { /* autoplay negato: resta l'immagine */ });
      else v.pause();
    }, { threshold: 0.2 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <div className={`phone ${className}`} aria-label="Cherry on an iPhone: the cookbook, a recipe and cook mode">
      <div className="phone__screen">
        <video ref={video} src="/assets/demo/cherry-demo.mp4" poster="/assets/demo/cherry-demo.jpg" muted loop playsInline preload="metadata" disablePictureInPicture />
        <i className="phone__island" aria-hidden="true" />
      </div>
    </div>
  );
}
