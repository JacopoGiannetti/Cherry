import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';
import { Icon } from '../components/Icon';
import { START } from './sections';
import '../styles/phone.css';
import '../styles/tour.css';

// L'apertura della landing è un racconto che si svolge scendendo: il telefono resta sullo
// schermo e passa da un lato all'altro, e a ogni capitolo mostra una funzione (una clip
// vera dell'app) mentre il testo accanto dice cosa fa e a cosa serve.
// Le clip sono in public/assets/demo/tour-N.mp4, registrate con lib/dev-tour.ts.

type Chapter = { clip: number; kicker: string; title: React.ReactNode; body: string };
const CHAPTERS: Chapter[] = [
  { clip: 1, kicker: 'Your cookbook', title: <>Every video you saved, <em>finally in one place.</em></>,
    body: 'Paste a TikTok or Instagram link. Cherry watches the video and writes the recipe down, with a cover you can actually recognise.' },
  { clip: 2, kicker: 'The recipe', title: <>Every amount, <em>written out.</em></>,
    body: 'No more “a splash of this”. Ingredients with real quantities you can scale, and the method split into the phases of the video.' },
  { clip: 3, kicker: 'Cook mode', title: <>Each step loops <em>its own moment.</em></>,
    body: 'No rewinding with sticky hands. On TikTok videos, the clip for the step you are on plays on repeat until you tap next.' },
  { clip: 4, kicker: 'Instagram reels', title: <>Reels turn into <em>step photos.</em></>,
    body: 'Instagram does not let a video loop here, so Cherry picks the key frames of every step: before, during, after.' },
  { clip: 5, kicker: 'Groceries', title: <>One tap. <em>One list.</em></>,
    body: 'Send a recipe to your grocery list and it sorts itself by aisle. Tick things off as you walk the shop.' },
  { clip: 6, kicker: 'Dinner', title: <>And then, <em>you eat.</em></>,
    body: 'The one you saved three weeks ago is on the table tonight.' },
];
const STEPS = CHAPTERS.length + 1; // 0 = l'apertura col titolo, poi i capitoli

export function AppTour() {
  const wrap = useRef<HTMLDivElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const [step, setStep] = useState(0);
  const dir = useRef(1);
  const { scrollYProgress } = useScroll({ target: wrap, offset: ['start start', 'end end'] });
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const next = Math.min(STEPS - 1, Math.max(0, Math.floor(v * STEPS)));
    setStep((cur) => { if (next !== cur) dir.current = next > cur ? 1 : -1; return next; });
  });
  // Mentre scendi il telefono respira: sale e scende appena, e il numero dietro scorre più lento.
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.6 });
  const float = useTransform(smooth, (v) => Math.sin(v * STEPS * Math.PI) * -14);
  const numberY = useTransform(smooth, [0, 1], ['6%', '-18%']);

  const chapter = step === 0 ? null : CHAPTERS[step - 1];
  const clip = chapter ? chapter.clip : 1;
  // A sinistra o a destra: il telefono cambia lato a ogni capitolo.
  const side = step % 2 === 0 ? 'right' : 'left';

  useEffect(() => {
    videos.current.forEach((v, n) => {
      if (!v) return;
      if (n + 1 === clip) { v.currentTime = 0; v.play().catch(() => { /* autoplay negato: resta la prima immagine */ }); }
      else v.pause();
    });
  }, [clip]);

  return (
    <section className="tour" ref={wrap} id="top" style={{ ['--steps' as string]: STEPS }}>
      <div className={`tour__stage is-${side} ${step === 0 ? 'is-intro' : ''}`}>
        <motion.span className="tour__num" style={{ y: numberY }} aria-hidden="true">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.b key={step} initial={{ opacity: 0, y: dir.current * 60 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: dir.current * -60 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>{step === 0 ? '' : String(step).padStart(2, '0')}</motion.b>
          </AnimatePresence>
        </motion.span>

        <div className="tour__copy">
          <AnimatePresence mode="popLayout" initial={false} custom={dir.current}>
            <motion.div key={step} className="tour__text" custom={dir.current}
              variants={{
                enter: (d: number) => ({ opacity: 0, y: d * 44 }),
                center: { opacity: 1, y: 0 },
                exit: (d: number) => ({ opacity: 0, y: d * -44 }),
              }}
              initial="enter" animate="center" exit="exit" transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
              {!chapter ? (
                <>
                  <h1 className="display shout tour__hero">Tonight, cook the one <em>you saved.</em></h1>
                  <a href={START} className="btn btn--cherry btn--xl">Start cooking <Icon name="next" stroke={2.6} /></a>
                  <p className="tour__hint"><Icon name="down" size={15} stroke={2.6} /> Scroll to see how it works</p>
                </>
              ) : (
                <>
                  <p className="tour__kicker"><b>{String(step).padStart(2, '0')}</b>{chapter.kicker}</p>
                  <h2 className="display tour__title">{chapter.title}</h2>
                  <p className="tour__body">{chapter.body}</p>
                  {step === STEPS - 1 && <a href={START} className="btn btn--cherry btn--xl">Start cooking <Icon name="next" stroke={2.6} /></a>}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <motion.div className="tour__phone" layout transition={{ type: 'spring', stiffness: 90, damping: 19, mass: 0.9 }}>
          <motion.div style={{ y: float }} animate={{ rotate: step === 0 ? 0 : side === 'left' ? -3.5 : 3.5 }} transition={{ type: 'spring', stiffness: 80, damping: 22 }}>
            <div className="phone" aria-label="Cherry on an iPhone">
              <div className="phone__screen">
                {CHAPTERS.map((c, n) => (
                  <video key={c.clip} ref={(el) => { videos.current[n] = el; }} className={c.clip === clip ? 'is-on' : ''}
                    src={`/assets/demo/tour-${c.clip}.mp4`} poster={`/assets/demo/tour-${c.clip}.jpg`}
                    muted loop playsInline disablePictureInPicture preload={Math.abs(c.clip - clip) <= 1 ? 'auto' : 'none'} />
                ))}
                <i className="phone__island" aria-hidden="true" />
              </div>
            </div>
          </motion.div>
        </motion.div>

        <ol className="tour__rail" aria-hidden="true">
          {CHAPTERS.map((c, n) => <li key={c.clip} className={n + 1 === step ? 'is-on' : n + 1 < step ? 'is-past' : ''} />)}
        </ol>
      </div>
    </section>
  );
}
