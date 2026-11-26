import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Redirect, useLocation } from 'wouter';
import '../../styles/paywall.css';
import { Icon } from '../../components/Icon';
import { getPlans, money, startCheckout, type Plan } from '../../lib/api';
import { perMonth as monthOf, savePct } from '../../lib/plans';
import { eventId, metaForServer, track } from '../../lib/meta';
import { useSession } from '../../lib/store';
import { journey, journeyId } from '../../lib/journey';
import { signOut } from '../../lib/firebase';
import { isPreview } from '../../lib/preview';

// Paywall rigido. In cima l'immagine fatta e finita (titolo e telefoni con l'app vera,
// public/assets/paywall/phones.jpg), poi i due piani affiancati e un bottone.
// Pagamento su Stripe Checkout (Apple Pay e Google Pay inclusi).

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function Join() {
  const { user, entitled, ready } = useSession();
  const [, navigate] = useLocation();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [choice, setChoice] = useState<'yearly' | 'monthly'>('yearly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canceled = new URLSearchParams(location.search).has('canceled');
  const first = user?.displayName?.split(' ')[0];

  // In sviluppo, o con l'anteprima accesa (lib/preview.ts): /app/join?preview mostra il paywall
  // anche senza account e anche a chi è già abbonato (che però non può pagare due volte).
  const devPreview = (import.meta.env.DEV || isPreview()) && new URLSearchParams(location.search).has('preview');
  useEffect(() => { getPlans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);
  useEffect(() => { if (entitled && !devPreview) navigate('/'); }, [entitled]);
  useEffect(() => { if (user) void journey('paywall', { canceled: canceled || undefined }); }, [!!user]);
  // Il paywall è bianco (come la foto dei telefoni): la barra del browser e lo sfondo lo seguono.
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#FEFEFE');
    const before = document.body.style.background;
    document.body.style.background = '#FEFEFE';
    return () => { document.body.style.background = before; };
  }, []);

  if (ready && !user && !devPreview) return <Redirect to="/start" />;

  const yearly = plans?.find((p) => p.plan === 'yearly');
  const monthly = plans?.find((p) => p.plan === 'monthly');
  const selected = choice === 'yearly' ? yearly : monthly;
  const save = yearly && monthly ? savePct(yearly.amount, monthly.amount) : 0;
  const perMonth = yearly ? monthOf(yearly.amount) : null;

  const checkout = async () => {
    if (entitled) { setError('Preview: you already have a membership, so checkout is off.'); return; }
    setBusy(true);
    setError(null);
    try {
      // Stesso id nel browser e nell'API Conversions (che parte dal server al checkout).
      const id = eventId('ic');
      void journey('checkout', { plan: choice });
      if (selected) void track('InitiateCheckout', { value: selected.amount, currency: (selected.currency || 'usd').toUpperCase(), content_name: `Cherry ${choice}`, num_items: 1 }, id);
      const { url } = await startCheckout(choice, await metaForServer(id), journeyId());
      location.href = url;
    } catch (e: any) {
      setError(e.message || 'Checkout is not available right now.');
      setBusy(false);
    }
  };

  const fine = !selected ? '' : selected.plan === 'yearly'
    ? `Billed as ${money(selected.amount, selected.currency)} per year${perMonth !== null ? ` (${money(perMonth, selected.currency)}/mo)` : ''}`
    : `Billed ${money(selected.amount, selected.currency)} every month`;

  return (
    <div className="pw">
      <header className="pw__bar">
        <span className="pw__logo"><img src="/assets/mascot.png" alt="" /><b className="display">Cherry</b></span>
        {user && <button className="pw__out" onClick={() => signOut()}>Not {first || 'you'}?</button>}
      </header>

      <motion.div className="pw__phones" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 80, damping: 16, delay: 0.15 }}>
        <img src="/assets/paywall/phones.jpg" alt="Always know what to eat. Meal planning just got unfairly easy." />
      </motion.div>

      <section className="pw__body">
        {canceled && <p className="pw__note">Nothing was charged. Pick a plan whenever you're ready.</p>}

        <div className="pw__plans" role="radiogroup" aria-label="Choose a plan">
          {plans === null && <><div className="pw__plan shimmer" /><div className="pw__plan shimmer" /></>}
          {monthly && (
            <button role="radio" aria-checked={choice === 'monthly'} className={`pw__plan ${choice === 'monthly' ? 'on' : ''}`} onClick={() => setChoice('monthly')}>
              <span className="pw__planName">Monthly</span>
              <span className="pw__price"><b className="num">{money(monthly.amount, monthly.currency)}</b>/month</span>
              <span className="pw__billed">Billed monthly</span>
              <i className="pw__radio">{choice === 'monthly' && <Icon name="check" size={13} stroke={3.4} />}</i>
            </button>
          )}
          {yearly && (
            <button role="radio" aria-checked={choice === 'yearly'} className={`pw__plan ${choice === 'yearly' ? 'on' : ''}`} onClick={() => setChoice('yearly')}>
              {save > 0 && <span className="pw__save">Save {save}%</span>}
              <span className="pw__planName">Yearly</span>
              {/* L'annuale si mostra al mese, come sulla pagina prezzi; il totale sta sotto. */}
              <span className="pw__price"><b className="num">{money(perMonth ?? yearly.amount, yearly.currency)}</b>{perMonth !== null ? '/month' : '/year'}</span>
              {perMonth !== null && <span className="pw__billed">{money(yearly.amount, yearly.currency)} billed yearly</span>}
              <i className="pw__radio">{choice === 'yearly' && <Icon name="check" size={13} stroke={3.4} />}</i>
            </button>
          )}
        </div>
        {plans && !plans.length && <p className="err">Plans are not available right now. Please try again in a moment.</p>}

        <p className="pw__cancel"><Icon name="check" size={15} stroke={3} /> Cancel anytime. No hidden fees.</p>

        <button className={`btn btn--ink btn--block btn--xl pw__cta ${busy ? 'is-busy' : ''}`} onClick={checkout} disabled={!selected}>
          {busy ? 'Opening secure checkout' : selected?.trialDays ? `Start ${selected.trialDays} days free` : 'Start today'}
        </button>
        {error && <p className="err" role="alert">{error}</p>}

        <p className="pw__fine">{fine}</p>
        <p className="pw__links"><Icon name="lock" size={12} /> Secure checkout by Stripe · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
      </section>
    </div>
  );
}
