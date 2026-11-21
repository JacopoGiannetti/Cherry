import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'wouter';
import { Icon } from '../../components/Icon';
import { InstallGuide } from '../../components/InstallGuide';
import { toast } from '../../components/Toast';
import { useSession } from '../../lib/store';
import { deleteAccount, openPortal } from '../../lib/api';
import { signOut } from '../../lib/firebase';
import { SUPPORT_EMAIL } from '../../lib/pwa';

export function Settings() {
  const { user, doc } = useSession();
  const [, navigate] = useLocation();
  const [sheet, setSheet] = useState<'install' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const stripe = doc?.stripe;
  const fromApple = !stripe?.status && doc?.subscription?.status === 'active';
  const renew = stripe?.currentPeriodEnd ? new Date(stripe.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;

  const manage = async () => {
    setBusy(true);
    try { location.href = (await openPortal()).url; } catch (e: any) { toast(e.message, 'close'); setBusy(false); }
  };

  return (
    <main className="screen">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Back"><Icon name="back" /></button>
        <span />
      </div>
      <h1 className="display" style={{ fontSize: 60, marginBottom: 20 }}>You</h1>

      <div className="member">
        <p className="eyebrow" style={{ color: 'rgba(255,255,255,.6)' }}>Membership</p>
        <b>Cherry {stripe?.interval === 'month' ? 'Monthly' : stripe?.interval === 'year' ? 'Yearly' : 'Member'}</b>
        <p>
          {fromApple ? 'Billed through the App Store.'
            : stripe?.cancelAtPeriodEnd ? `Ends on ${renew}.`
            : stripe?.status === 'trialing' ? `Free trial, then renews on ${renew}.`
            : renew ? `Renews on ${renew}.` : 'Active'}
        </p>
        {!fromApple && stripe?.customerId && (
          <button className="btn btn--white btn--sm" style={{ marginTop: 16, position: 'relative', zIndex: 1 }} onClick={manage} disabled={busy}>
            Manage or cancel
          </button>
        )}
      </div>

      <div className="group">
        <div className="row">
          <span className="row__icon">{user?.photoURL ? <img src={user.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: 11 }} referrerPolicy="no-referrer" /> : <Icon name="user" />}</span>
          <span className="row__label">{user?.displayName || 'Your account'}<br /><small className="muted">{user?.email}</small></span>
        </div>
        <button className="row" onClick={() => setSheet('install')}><span className="row__icon"><Icon name="plus" /></span><span className="row__label">Add Cherry to Home Screen</span><Icon name="next" /></button>
        <a className="row" href={`mailto:${SUPPORT_EMAIL}`}><span className="row__icon"><Icon name="heart" /></span><span className="row__label">Help & feedback</span><Icon name="next" /></a>
      </div>

      <div className="group">
        <a className="row" href="/privacy"><span className="row__label">Privacy Policy</span><Icon name="external" size={17} /></a>
        <a className="row" href="/terms"><span className="row__label">Terms of Service</span><Icon name="external" size={17} /></a>
      </div>

      <div className="group">
        <button className="row" onClick={() => signOut().then(() => navigate('/start'))}><span className="row__label">Sign out</span></button>
        <button className="row danger" onClick={() => setSheet('delete')}><span className="row__label">Delete account</span></button>
      </div>

      <AnimatePresence>
        {sheet && (
          <>
            <motion.div className="sheet-bg" onClick={() => setSheet(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div className="sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}>
              <div className="sheet__grab" />
              {sheet === 'install' && <InstallGuide compact onDone={() => setSheet(null)} />}
              {sheet === 'delete' && (
                <div>
                  <h2 className="display">Delete your account?</h2>
                  <p className="muted" style={{ margin: '8px 0 20px' }}>
                    This permanently deletes your cookbook and grocery list{stripe?.subscriptionId ? ' and cancels your membership right away' : ''}. It can't be undone.
                  </p>
                  <button className="btn btn--ink btn--block" disabled={busy} onClick={async () => {
                    setBusy(true);
                    try { await deleteAccount(); await signOut(); navigate('/start'); } catch (e: any) { toast(e.message, 'close'); setBusy(false); }
                  }}>{busy ? <span className="spinner" /> : 'Delete everything'}</button>
                  <button className="flow__link" onClick={() => setSheet(null)}>Keep my account</button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </main>
  );
}
