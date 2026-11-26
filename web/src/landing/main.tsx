import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConsentBanner } from '../components/ConsentBanner';
import { initMeta, keepClickId } from '../lib/meta';
import { journey } from '../lib/journey';
import { Landing } from './home';

keepClickId();
initMeta();
void journey('landing', undefined, { once: true });
createRoot(document.getElementById('root')!).render(<StrictMode><Landing /><ConsentBanner /></StrictMode>);
