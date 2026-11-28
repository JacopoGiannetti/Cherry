import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';
import { Icon } from '../components/Icon';
import { START } from './sections';
import '../styles/phone.css';
import '../styles/tour.css';

// L'apertura della landing è un racconto che si svolge scendendo. Il telefono resta sullo
// schermo e cambia lato; a ogni capitolo cambiano la clip dentro il telefono, il testo accanto
// e il colore di tutto lo sfondo.
//   0  apertura: il cook mode in video, con il selettore TikTok / Instagram
//   1  la lista degli ingredienti
//   2  la spesa
//   3  il ricettario
// I video stanno solo in apertura (public/assets/demo/clip-*.mp4, registrazioni vere dell'app
// fatte con lib/dev-tour.ts). Dopo, ogni capitolo è una schermata ferma (shot-*.jpg): si legge
// il testo, si guarda una cosa sola.

type Source = 'tiktok' | 'instagram';
type Theme = 'paper' | 'ink' | 'blush' | 'cherry';
type Chapter = { shot: string; theme: Theme; kicker: string; title: React.ReactNode; body: string };
const CHAPTERS: Chapter[] = [
  { shot: 'ingredients', theme: 'ink', kicker: 'Ingredients', title: <>Every amount, <em>written out.</em></>,
    body: 'Cherry watches the video and writes down what you need: real quantities, scaled to how many you are cooking for.' },
  { shot: 'groceries', theme: 'blush', kicker: 'Groceries', title: <>One tap. <em>One list.</em></>,
    body: 'Send a recipe to your grocery list and it sorts itself by aisle. Tick things off as you walk the shop.' },
  { shot: 'cookbook', theme: 'cherry', kicker: 'Cookbook', title: <>Every save, <em>in one place.</em></>,
    body: 'Everything you saved from TikTok and Instagram, in one cookbook. Tonight\u2019s dinner is already in there.' },
];
const STEPS = CHAPTERS.length + 1;
const CLIPS: Source[] = ['tiktok', 'instagram'];

export function AppTour() {
  const wrap = useRef<HTMLDivElement>(null);
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<Source>('tiktok');
  const dir = useRef(1);
  const { scrollYProgress } = useScroll({ target: wrap, offset: ['start start', 'end end'] });
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const next = Math.min(STEPS - 1, Math.max(0, Math.floor(v * STEPS)));
    setStep((cur) => { if (next !== cur) dir.current = next > cur ? 1 : -1; return next; });
  });
  // Mentre scendi il telefono respira appena, e il numero dietro scorre più lento.
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.6 });
  const float = useTransform(smooth, (v) => Math.sin(v * STEPS * Math.PI) * -10);
  const numberY = useTransform(smooth, [0, 1], ['5%', '-14%']);

  const chapter = step === 0 ? null : CHAPTERS[step - 1];
  const clip = chapter ? null : source;
  const theme: Theme = chapter ? chapter.theme : 'paper';
  const side = step % 2 === 0 ? 'right' : 'left';

  useEffect(() => {
    for (const [name, v] of Object.entries(videos.current)) {
      if (!v) continue;
      if (name === clip) { v.currentTime = 0; v.play().catch(() => { /* autoplay negato: resta la prima immagine */ }); }
      else v.pause();
    }
  }, [clip]);

  return (
    <section className="tour" ref={wrap} id="top" style={{ ['--steps' as string]: STEPS }}>
      <div className={`tour__stage is-${side} ${step === 0 ? 'is-intro' : ''}`} data-theme={theme}>
        <div className="tour__in">
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
                    <p className="tour__lead">Cherry turns a recipe video into a cook mode: every step, right in front of you, while you cook.</p>
                    <a href={START} className="btn btn--cherry btn--xl tour__go">Start cooking <Icon name="next" stroke={2.6} /></a>
                    <small className="tour__note">Try a recipe first. No card needed to start.</small>
                  </>
                ) : (
                  <>
                    <p className="tour__kicker"><b>{String(step).padStart(2, '0')}</b>{chapter.kicker}</p>
                    <h2 className="display tour__title">{chapter.title}</h2>
                    <p className="tour__body">{chapter.body}</p>
                    {step === STEPS - 1 && <a href={START} className="btn btn--xl tour__end">Start cooking <Icon name="next" stroke={2.6} /></a>}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <motion.div className="tour__device" layout transition={{ type: 'spring', stiffness: 90, damping: 19, mass: 0.9 }}>
            {/* In apertura: come si vede un video di TikTok e come un reel di Instagram. */}
            <div className={`tour__switch ${step === 0 ? '' : 'is-off'}`} role="tablist" aria-label="Where the recipe comes from">
              {(['tiktok', 'instagram'] as const).map((s) => (
                <button key={s} type="button" role="tab" aria-selected={source === s} tabIndex={step === 0 ? 0 : -1}
                  className={source === s ? 'is-on' : ''} onClick={() => setSource(s)}>
                  {source === s && <motion.span layoutId="tour-switch" className="tour__switch-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                  <span>{s === 'tiktok' ? 'From TikTok' : 'From Instagram'}</span>
                </button>
              ))}
            </div>
            <div className="tour__phone">
              <motion.div className="tour__tilt" style={{ y: float }} animate={{ rotate: step === 0 ? 0 : side === 'left' ? -3 : 3 }} transition={{ type: 'spring', stiffness: 80, damping: 22 }}>
                <div className="phone" aria-label="Cherry on an iPhone">
                  <div className="phone__screen">
                    {CLIPS.map((name) => (
                      <video key={name} ref={(el) => { videos.current[name] = el; }} className={name === clip ? 'is-on' : ''}
                        src={`/assets/demo/clip-${name}.mp4?v=2`} poster={`/assets/demo/clip-${name}.jpg?v=2`}
                        muted loop playsInline disablePictureInPicture preload="auto" />
                    ))}
                    {CHAPTERS.map((c) => (
                      <img key={c.shot} className={c === chapter ? 'is-on' : ''} src={`/assets/demo/shot-${c.shot}.jpg`} alt="" decoding="async" />
                    ))}
                    <i className="phone__island" aria-hidden="true" />
                  </div>
                </div>
              </motion.div>
            </div>
            <p className={`tour__caption ${step === 0 ? '' : 'is-off'}`}>
              {source === 'tiktok' ? 'Each step loops its own moment of the video.' : 'Each step gets its own photos from the reel.'}
            </p>
          </motion.div>

          <ol className="tour__rail" aria-hidden="true">
            {CHAPTERS.map((c, n) => <li key={c.shot} className={n + 1 === step ? 'is-on' : n + 1 < step ? 'is-past' : ''} />)}
          </ol>
        </div>
      </div>
    </section>
  );
}
