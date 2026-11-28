import { StrictMode, Suspense, lazy, useEffect, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Router, Switch, Redirect, useLocation } from 'wouter';
import { useBrowserLocation } from 'wouter/use-browser-location';
import '../styles/tokens.css';
import '../styles/app.css';
import '../styles/flow.css';
import '../styles/motion.css';
import { takePopped, transition } from '../lib/nav';
import { startSession, useSession } from '../lib/store';
import { Join } from './screens/Join';
import { Welcome } from './screens/Welcome';
import { Library } from './screens/Library';
import { Add } from './screens/Add';
import { RecipeScreen } from './screens/RecipeScreen';
import { CookScreen } from './screens/CookScreen';
import { ListScreen } from './screens/ListScreen';
import { Settings } from './screens/Settings';
import { SignIn } from './screens/SignIn';
import { SharedList } from './screens/SharedList';
import { RecipeEditor } from './screens/RecipeEditor';
import { TabBar } from '../components/TabBar';
import { ToastHost } from '../components/Toast';
import { rememberNext } from '../lib/next';
import { countOpen, ReviewHost } from '../components/ReviewPrompt';
import { ConsentBanner } from '../components/ConsentBanner';
import { initMeta, keepClickId, pageView } from '../lib/meta';
import { setJourneyAuth } from '../lib/journey';
import { auth } from '../lib/firebase';
import { used } from '../lib/usage';
import { isPreview } from '../lib/preview';

// L'onboarding (dal 26 nov 2026). Quello di prima resta in screens/Onboarding.tsx, non più collegato.
const OnboardingNext = lazy(() => import('./screens/OnboardingNext').then((m) => ({ default: m.OnboardingNext })));

document.body.classList.add('is-app');
setJourneyAuth(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null));
startSession();
// Chi apre con la chiave d'anteprima (lib/preview.ts) gira come prova: fuori dalle statistiche e dal Pixel.
isPreview();
keepClickId();
initMeta();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

function Boot() {
  return <div className="boot"><img src="/assets/mascot.png" alt="Loading" /></div>;
}

/** Le stanze dell'app: servono login e abbonamento. */
function Member({ children }: { children: React.ReactNode; tabs?: boolean }) {
  const s = useSession();
  const [location] = useLocation();
  if (!s.ready) return <Boot />;
  if (!s.user) {
    // Dopo il login si torna qui (per esempio /add?u=… aperto dal comando "Add to Cherry").
    if (location !== '/') rememberNext(location + window.location.search);
    return <Redirect to={`/start${location === '/' ? '' : `?next=${encodeURIComponent(location)}`}`} />;
  }
  if (!s.entitled) return <Redirect to="/join" />;
  return <><Opened />{children}</>;
}

/** L'apertura del giorno, per la retention (una al giorno, la filtra used). */
function Opened() {
  useEffect(() => { used('app.open'); countOpen(); }, []);
  return null;
}

/**
 * Una sola barra per tutta l'app, fuori dalle pagine: cambiando schermata non
 * viene smontata e ridisegnata (e non entra nella dissolvenza tra pagine),
 * si sposta solo l'indicatore.
 */
const TAB_ROUTES = ['/', '/list', '/settings', '/add'];
function Tabs() {
  const s = useSession();
  const [location] = useLocation();
  if (!s.ready || !s.user || !s.entitled || !TAB_ROUTES.includes(location)) return null;
  return <TabBar />;
}

/**
 * Pagina nuova: si parte dall'alto. Tornando indietro: dalla posizione di prima
 * (prima si ripartiva sempre dall'alto, e la foto non trovava la sua card).
 * useLayoutEffect: succede prima che la transizione fotografi la pagina.
 */
const scrolls = new Map<string, number>();
let lastPath = '';
function ScrollTop() {
  const [location] = useLocation();
  useLayoutEffect(() => {
    // La posizione della pagina che si lascia la tiene già il listener (qui scrollY è già quello nuovo).
    lastPath = location;
    window.scrollTo(0, takePopped() ? scrolls.get(location) || 0 : 0);
    pageView(window.location.pathname);
  }, [location]);
  useEffect(() => {
    const save = () => { if (lastPath) scrolls.set(lastPath, scrollY); };
    addEventListener('scroll', save, { passive: true });
    return () => removeEventListener('scroll', save);
  }, []);
  return null;
}

/** Ogni cambio pagina ha il suo movimento, scelto da dove parti e dove vai (lib/nav.ts). */
const useVtLocation: typeof useBrowserLocation = (opts) => {
  const [loc, nav] = useBrowserLocation(opts);
  return [loc, (to, o) => transition(loc, String(to), () => nav(to, o))];
};

function App() {
  return (
    <Router base="/app" hook={useVtLocation}>
      <ScrollTop />
      <div className="shell">
        <Switch>
          <Route path="/start"><Suspense fallback={<Boot />}><OnboardingNext /></Suspense></Route>
          <Route path="/start-next"><Redirect to="/start" /></Route>
          <Route path="/signin"><SignIn /></Route>
          <Route path="/l/:id">{(p) => <SharedList id={p.id} />}</Route>
          <Route path="/join"><Join /></Route>
          <Route path="/join-next"><Redirect to="/join" /></Route>
          <Route path="/welcome"><Welcome /></Route>
          <Route path="/add"><Member><Add /></Member></Route>
          <Route path="/new"><Member><RecipeEditor /></Member></Route>
          <Route path="/r/:id/edit">{(p) => <Member><RecipeEditor id={p.id} /></Member>}</Route>
          <Route path="/r/:id">{(p) => <Member tabs={false}><RecipeScreen id={p.id} /></Member>}</Route>
          <Route path="/cook/:id">{(p) => <Member tabs={false}><CookScreen id={p.id} /></Member>}</Route>
          <Route path="/list"><Member><ListScreen /></Member></Route>
          <Route path="/settings"><Member><Settings /></Member></Route>
          <Route path="/"><Member><Library /></Member></Route>
          <Route><Redirect to="/" /></Route>
        </Switch>
      </div>
      <Tabs />
      <ReviewHost />
      <ToastHost />
      <ConsentBanner />
    </Router>
  );
}

// Solo in sviluppo con dati finti: il giro guidato per registrare il video dimostrativo.
if (import.meta.env.DEV && import.meta.env.VITE_MOCK === '1') void import('../lib/dev-tour');

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
