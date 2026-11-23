import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Redirect, useLocation } from 'wouter';
import { Icon } from '../../components/Icon';
import { getPlans, money, startCheckout, type Plan } from '../../lib/api';
import { eventId, metaForServer, track } from '../../lib/meta';
import { useSession } from '../../lib/store';
import { signOut } from '../../lib/firebase';
import { derive, hasFunnel, loadFunnel } from '../../lib/funnel';

// Paywall rigido. Chi arriva dal percorso trova la SUA ricetta pronta e i
// SUOI numeri: non compra un'app, sblocca una cena che ha già scelto.
// Pagamento su Stripe Checkout (Apple Pay e Google Pay inclusi).

export function Join() {
  const { user, entitled, ready } = useSession();
  const [, navigate] = useLocation();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [choice, setChoice] = useState<'yearly' | 'monthly'>('yearly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canceled = new URLSearchParams(location.search).has('canceled');
  const personal = useMemo(() => hasFunnel(), []);
  const f = useMemo(() => loadFunnel(), []);
  const d = derive(f);
  const first = user?.displayName?.split(' ')[0];

  useEffect(() => { getPlans().then((r) => setPlans(r.plans)).catch(() => setPlans([])); }, []);
  useEffect(() => { if (entitled) navigate('/'); }, [entitled]);

  // Solo in sviluppo: /app/join?preview per vedere il paywall senza account.
  const devPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('preview');
  if (ready && !user && !devPreview) return <Redirect to="/start" />;

  const yearly = plans?.find((p) => p.plan === 'yearly');
  const monthly = plans?.find((p) => p.plan === 'monthly');
  const selected = choice === 'yearly' ? yearly : monthly;
  const save = yearly && monthly ? Math.round((1 - yearly.amount / (monthly.amount * 12)) * 100) : 0;
  const perMonth = yearly ? yearly.amount / 12 : null;

  const checkout = async () => {
    setBusy(true);
    setError(null);
    try {
      // Stesso id nel browser e nell'API Conversions (che parte dal server al checkout).
      const id = eventId('ic');
      if (selected) void track('InitiateCheckout', { value: selected.amount, currency: (selected.currency || 'usd').toUpperCase(), content_name: `Cherry ${choice}`, num_items: 1 }, id);
      const { url } = await startCheckout(choice, await metaForServer(id));
      location.href = url;
    } catch (e: any) {
      setError(e.message || 'Checkout is not available right now.');
      setBusy(false);
    }
  };

  const recipe = personal ? f.recipe : undefined;
  const steps = recipe ? ((recipe.segments?.length || 0) >= 2 ? recipe.segments!.length : recipe.steps.length) : 0;

  return (
    <div className="pay">
      <section className="pay__top">
        <header className="pay__bar">
          <span className="eyebrow">{recipe ? 'Ready and waiting' : 'Membership'}</span>
          <button className="pay__out" onClick={() => signOut()}>Not {first || 'you'}?</button>
        </header>

        {recipe && (
          <motion.div className="pay__recipe" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}>
            <img src={recipe.imageUrl || '/assets/steps/serve.jpg'} alt="" />
            <div>
              <b>{recipe.title}</b>
              <span>{recipe.ingredients.length} ingredients · {steps} video steps</span>
            </div>
            <span className="pay__lock"><Icon name="lock" size={16} /></span>
          </motion.div>
        )}

        <h1 className="display pay__title">
          {recipe ? <>{first ? `${first}, your` : 'Your'} dinner is <em>one tap away.</em></> : <>Cook every recipe <em>you save.</em></>}
        </h1>

        {personal && (
          <ul className="pay__stats">
            <li><span className="num">{f.nights}</span>nights a week</li>
            <li><span className="num">{f.household === 5 ? '5+' : f.household}</span>at the table</li>
            {d.monthly > 0
              ? <li><span className="num">${d.monthly}</span>back a month*</li>
              : <li><span className="num">{d.dinners}</span>dinners a month</li>}
          </ul>
        )}
      </section>

      <section className="pay__body">
        <ul className="pay__gets">
          <li><Icon name="check" size={16} stroke={3} />Cook mode on every recipe, each step looping its moment</li>
          <li><Icon name="check" size={16} stroke={3} />Unlimited TikTok and Instagram recipes, written out with amounts</li>
          <li><Icon name="check" size={16} stroke={3} />Grocery lists by aisle, synced on every device</li>
        </ul>

        {canceled && <p className="pay__note">Nothing was charged. Pick a plan whenever you're ready.</p>}

        <div className="plans" role="radiogroup" aria-label="Choose a plan">
          {plans === null && <div className="plan-card shimmer" style={{ height: 86 }} />}
          {yearly && (
            <button role="radio" aria-checked={choice === 'yearly'} className={`plan-card ${choice === 'yearly' ? 'on' : ''}`} onClick={() => setChoice('yearly')}>
              <span className="plan-card__radio" />
              <span className="plan-card__main"><b>Yearly{save > 0 && <i>Save {save}%</i>}</b><small>{perMonth ? `${money(Math.round(perMonth * 100) / 100, yearly.currency)} a month, billed yearly` : 'Billed yearly'}</small></span>
              <span className="plan-card__price num">{money(yearly.amount, yearly.currency)}</span>
            </button>
          )}
          {monthly && (
            <button role="radio" aria-checked={choice === 'monthly'} className={`plan-card ${choice === 'monthly' ? 'on' : ''}`} onClick={() => setChoice('monthly')}>
              <span className="plan-card__radio" />
              <span className="plan-card__main"><b>Monthly</b><small>Cancel anytime</small></span>
              <span className="plan-card__price num">{money(monthly.amount, monthly.currency)}</span>
            </button>
          )}
          {plans && !plans.length && <p className="err">Plans are not available right now. Please try again in a moment.</p>}
        </div>

        <div className="pay__cta">
          <button className={`btn btn--cherry btn--block btn--xl ${busy ? 'is-busy' : ''}`} onClick={checkout} disabled={!selected}>
            {busy ? 'Opening secure checkout' : selected?.trialDays ? `Start ${selected.trialDays} days free` : recipe ? 'Unlock my recipe' : 'Start cooking'}
            {!busy && <Icon name="next" stroke={2.6} />}
          </button>
          {error && <p className="err" role="alert">{error}</p>}
          <p className="pay__fine"><Icon name="lock" size={13} /> Stripe checkout · Apple Pay and Google Pay · Cancel in two taps</p>
          {personal && d.monthly > 0 && <p className="pay__fine pay__fine--small">*Your estimate from the answers you gave.</p>}
          <p className="pay__fine pay__fine--small">Cherry is a product of Jacopo Giannetti · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
        </div>
      </section>
    </div>
  );
}
