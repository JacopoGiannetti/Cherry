import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConsentBanner } from '../components/ConsentBanner';
import { initMeta, keepClickId } from '../lib/meta';
import { journey } from '../lib/journey';
import { Closer, Cook, Faq, Footer, Hero, How, Marquee, More, Nav, Pricing, Problem, StickyCta } from './sections';

function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Problem />
        <How />
        <Cook />
        <More />
        <Pricing />
        <Faq />
        <Closer />
      </main>
      <Footer />
      <StickyCta />
      <ConsentBanner />
    </>
  );
}

keepClickId();
initMeta();
void journey('landing', undefined, { once: true });
createRoot(document.getElementById('root')!).render(<StrictMode><Landing /></StrictMode>);
