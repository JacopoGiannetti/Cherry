import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Router, Switch, Redirect, useLocation } from 'wouter';
import { useBrowserLocation } from 'wouter/use-browser-location';
import { flushSync } from 'react-dom';
import '../styles/tokens.css';
import '../styles/app.css';
import '../styles/flow.css';
import { startSession, useSession } from '../lib/store';
import { Onboarding } from './screens/Onboarding';
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

startSession();

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
  if (!s.user) return <Redirect to={`/start${location === '/' ? '' : `?next=${encodeURIComponent(location)}`}`} />;
  if (!s.entitled) return <Redirect to="/join" />;
  return <>{children}</>;
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

function ScrollTop() {
  const [location] = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location]);
  return null;
}

/** Ogni cambio pagina passa dalle View Transitions: la card diventa la pagina, e indietro torna card. */
const useVtLocation: typeof useBrowserLocation = (opts) => {
  const [loc, nav] = useBrowserLocation(opts);
  return [loc, (to, o) => {
    const start = (document as any).startViewTransition?.bind(document);
    if (!start) return nav(to, o);
    start(() => flushSync(() => nav(to, o)));
  }];
};

function App() {
  return (
    <Router base="/app" hook={useVtLocation}>
      <ScrollTop />
      <div className="shell">
        <Switch>
          <Route path="/start"><Onboarding /></Route>
          <Route path="/signin"><SignIn /></Route>
          <Route path="/l/:id">{(p) => <SharedList id={p.id} />}</Route>
          <Route path="/join"><Join /></Route>
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
      <ToastHost />
    </Router>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
