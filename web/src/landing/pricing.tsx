import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConsentBanner } from '../components/ConsentBanner';
import { initMeta, keepClickId } from '../lib/meta';
import { Nav } from './home';
import { Footer, Pricing } from './sections';

// I prezzi, su una pagina loro: dalla home ci si arriva solo dal menu in alto.
function PricingPage() {
  return (
    <>
      <Nav home={false} />
      <main className="lprice"><Pricing /></main>
      <Footer />
      <ConsentBanner />
    </>
  );
}

keepClickId();
initMeta();
createRoot(document.getElementById('root')!).render(<StrictMode><PricingPage /></StrictMode>);
