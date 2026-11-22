import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'motion/react';
import { Icon } from '../../components/Icon';
import { InstallGuide } from '../../components/InstallGuide';
import { toast } from '../../components/Toast';
import { Sheet, originOf, type Origin } from '../../components/Sheet';
import { LANGUAGES, recipePrefsOf, setRecipePrefs, useSession } from '../../lib/store';
import { deleteAccount, openPortal } from '../../lib/api';
import { signOut } from '../../lib/firebase';
import { SUPPORT_EMAIL } from '../../lib/pwa';
import { openCookiePrefs } from '../../lib/meta';

export function Settings() {
  const { user, doc } = useSession();
  const [, navigate] = useLocation();
  const [sheet, setSheet] = useState<'install' | 'delete' | 'lang' | null>(null);
  const [from, setFrom] = useState<Origin>(null);
  const [busy, setBusy] = useState(false);
  const installBtn = useRef<HTMLButtonElement>(null);
  const deleteBtn = useRef<HTMLButtonElement>(null);
  const langBtn = useRef<HTMLButtonElement>(null);
  const prefs = recipePrefsOf(doc);
  const lang = LANGUAGES.find(([c]) => c === prefs.language) || LANGUAGES[0];
  const stripe = doc?.stripe;
  const fromApple = !stripe?.status && doc?.subscription?.status === 'active';
  const date = stripe?.currentPeriodEnd ? new Date(stripe.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
  const plan = stripe?.interval === 'month' ? 'Monthly' : stripe?.interval === 'year' ? 'Yearly' : 'Member';
  const status = fromApple ? 'Billed through the App Store'
    : stripe?.cancelAtPeriodEnd ? `Ends ${date}`
    : stripe?.status === 'trialing' ? `Free trial · renews ${date}`
    : date ? `Renews ${date}` : 'Active';

  const manage = async () => {
    setBusy(true);
    try { location.href = (await openPortal()).url; } catch (e: any) { toast(e.message, 'close'); setBusy(false); }
  };

  return (
    <main className="page">
      <header className="bar">
        <button className="bar__btn" onClick={() => (history.length > 1 ? history.back() : navigate('/'))} aria-label="Back"><Icon name="back" /></button>
        <h1 className="bar__title bar__title--center">Account</h1>
        <span className="bar__spacer" />
      </header>

      <section className="profile">
        <span className="profile__avatar">{user?.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : <Icon name="user" />}</span>
        <div><b>{user?.displayName || 'Your account'}</b><small>{user?.email}</small></div>
      </section>

      <p className="group-label">Membership</p>
      <div className="group">
        <div className="group__row"><span>Cherry {plan}</span><em>{status}</em></div>
        {!fromApple && stripe?.customerId && (
          <button className={`group__row group__row--btn ${busy ? 'is-busy' : ''}`} onClick={manage}>
            <span>Manage or cancel</span><Icon name="next" size={18} />
          </button>
        )}
      </div>

      <p className="group-label">Recipes</p>
      <div className="group">
        <button ref={langBtn} className="group__row group__row--btn" onClick={() => { setFrom(originOf(langBtn.current)); setSheet('lang'); }}>
          <span>Language</span><em>{lang[2]} {lang[1]} · {prefs.units === 'metric' ? 'Metric' : 'US'}</em><Icon name="next" size={18} />
        </button>
      </div>

      <p className="group-label">App</p>
      <div className="group">
        <button ref={installBtn} className="group__row group__row--btn" onClick={() => { setFrom(originOf(installBtn.current)); setSheet('install'); }}>
          <span>Add to Home Screen</span><Icon name="next" size={18} />
        </button>
        <a className="group__row group__row--btn" href={`mailto:${SUPPORT_EMAIL}`}><span>Help & feedback</span><Icon name="next" size={18} /></a>
        <button className="group__row group__row--btn" onClick={openCookiePrefs}><span>Cookie preferences</span><Icon name="next" size={18} /></button>
        <a className="group__row group__row--btn" href="/privacy"><span>Privacy Policy</span><Icon name="external" size={16} /></a>
        <a className="group__row group__row--btn" href="/terms"><span>Terms of Service</span><Icon name="external" size={16} /></a>
      </div>

      <div className="group">
        <button className="group__row group__row--btn" onClick={() => signOut().then(() => { location.href = '/'; })}><span>Sign out</span></button>
        <button ref={deleteBtn} className="group__row group__row--btn group__row--danger" onClick={() => { setFrom(originOf(deleteBtn.current)); setSheet('delete'); }}>
          <span>Delete account</span>
        </button>
      </div>

      <Sheet open={sheet === 'install'} onClose={() => setSheet(null)} from={from} label="Add to Home Screen">
        <div className="sheet__pad"><InstallGuide compact onDone={() => setSheet(null)} /></div>
      </Sheet>
      <Sheet open={sheet === 'lang'} onClose={() => setSheet(null)} from={from} label="Recipe language">
        <div className="add">
          <h2 className="add__title">Recipe language</h2>
          <p className="add__lead">Cherry writes your next recipes in this language, translating from the video. Recipes you already saved stay as they are.</p>
          <div className="langs" role="radiogroup" aria-label="Language">
            {LANGUAGES.map(([code, name, flag]) => (
              <button key={code} role="radio" aria-checked={prefs.language === code} className={`langs__row ${prefs.language === code ? 'is-on' : ''}`}
                onClick={() => { navigator.vibrate?.(6); setRecipePrefs(user!.uid, { language: code, units: code === 'en' ? 'us' : 'metric' }); }}>
                <span aria-hidden="true">{flag}</span>{name}
                {prefs.language === code && <motion.span layoutId="lang-on" className="langs__tick"><Icon name="check" size={16} stroke={2.8} /></motion.span>}
              </button>
            ))}
          </div>
          <p className="group-label" style={{ marginTop: 10 }}>Measurements</p>
          <div className="rseg rseg--flat" role="radiogroup" aria-label="Measurements">
            {(['metric', 'us'] as const).map((u) => (
              <button key={u} role="radio" aria-checked={prefs.units === u} className={prefs.units === u ? 'is-on' : ''} onClick={() => setRecipePrefs(user!.uid, { units: u })}>
                {prefs.units === u && <motion.span layoutId="units-on" className="rseg__bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <span>{u === 'metric' ? 'Metric · g, ml' : 'US · cups, oz'}</span>
              </button>
            ))}
          </div>
          <button className="btn btn--cherry btn--block" style={{ marginTop: 8 }} onClick={() => setSheet(null)}>Done</button>
        </div>
      </Sheet>
      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} from={from} label="Delete account">
        <div className="menu">
          <p className="menu__ask">
            Delete your account? Your cookbook and grocery list are erased{stripe?.subscriptionId ? ' and your membership is cancelled right away' : ''}. This can’t be undone.
          </p>
          <button className={`btn btn--danger btn--block ${busy ? 'is-busy' : ''}`} onClick={async () => {
            setBusy(true);
            try { await deleteAccount(); await signOut(); location.href = '/'; } catch (e: any) { toast(e.message, 'close'); setBusy(false); }
          }}>Delete everything</button>
          <button className="btn btn--ghost btn--block" onClick={() => setSheet(null)}>Keep my account</button>
        </div>
      </Sheet>
    </main>
  );
}
