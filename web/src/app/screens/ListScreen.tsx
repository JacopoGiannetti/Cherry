import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { Sheet, originOf, type Origin } from '../../components/Sheet';
import { Aisles, BuyAgain, Progress, QuickAdd, addItems, clearChecked, setChecked, type NewItem } from '../../components/Groceries';
import { deleteTrip, editList, saveTrip, shareList, shareUrl, stopSharing, useList, useRecipes, useSession, useShareId, useTrips } from '../../lib/store';
import { itemEmoji, mergeIntoList, recurring, removeRecipeFromList, section } from '../../lib/kitchen';
import type { GroceryList, Recipe, Trip } from '../../lib/types';
import { used } from '../../lib/usage';

// La spesa si fa camminando tra le corsie: sopra quello che manca, diviso
// per corsia; ciò che spunti scivola giù, nel carrello. Si può fare in due:
// un link, e chi lo apre vede e spunta la stessa lista, dal vivo.

type Panel = 'recipes' | 'more' | 'past' | 'share';

export function ListScreen() {
  const { user } = useSession();
  const uid = user!.uid;
  const list = useList(uid);
  const shareId = useShareId(uid);
  const recipes = useRecipes(uid);
  const trips = useTrips(uid);
  const [sheet, setSheet] = useState<Panel | null>(null);
  const [from, setFrom] = useState<Origin>(null);
  const recipesBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const pastBtn = useRef<HTMLButtonElement>(null);
  const shareBtn = useRef<HTMLButtonElement>(null);
  const open = (which: Panel, el: Element | null) => { setFrom(originOf(el)); setSheet(which); };

  const items = list?.items || [];
  const inList = (list?.recipeIds || []).map((id) => recipes?.find((r) => r.id === id)).filter(Boolean) as Recipe[];
  const edit = (fn: (l: GroceryList) => GroceryList) => { used('list.check'); return editList(uid, fn).catch((e) => toast(e.message || 'Could not save', 'close')); };
  const add = (n: NewItem[]) => { navigator.vibrate?.(6); return edit(addItems(n)); };

  /** Chiudere la spesa: ciò che è nel carrello va nelle spese passate, il resto resta. */
  const finish = async (all = false) => {
    if (!list) return;
    const bought = list.items.filter((i) => i.checked);
    if (bought.length) { await saveTrip(uid, { at: Date.now(), items: bought, recipeIds: list.recipeIds || [] }); used('trip.done'); }
    await edit(all ? (l) => ({ ...l, items: [], recipeIds: [] }) : clearChecked);
    if (bought.length) toast('Saved to past lists', 'check');
  };
  const again = recurring(trips, list).map((r) => r.item);
  const empty = list !== undefined && items.length === 0;

  return (
    <main className="page">
      <header className="bar">
        <h1 className="bar__title">Groceries</h1>
        <div className="bar__actions">
          {!empty && (
            <button ref={shareBtn} className={`bar__btn ${shareId ? 'bar__btn--live' : ''}`} onClick={() => open('share', shareBtn.current)} aria-label={shareId ? 'Shared list' : 'Share list'}>
              <Icon name={shareId ? 'people' : 'share'} />
            </button>
          )}
          <button ref={pastBtn} className="bar__btn" onClick={() => open('past', pastBtn.current)} aria-label="Past lists"><Icon name="clock" /></button>
          {!empty && <button ref={moreBtn} className="bar__btn" onClick={() => open('more', moreBtn.current)} aria-label="More"><Icon name="dots" /></button>}
        </div>
      </header>

      {list === undefined && <div className="quiet-note"><span className="spinner" /></div>}

      {empty && (
        <section className="empty">
          <div className="empty__art empty__art--list" aria-hidden="true">
            {['paella', 'poke', 'shakshuka'].map((p) => <span key={p} className="plate"><img src={`/assets/plates/${p}.jpg`} alt="" /></span>)}
          </div>
          <h2>Nothing to buy yet</h2>
          <p>Pick a few recipes and Cherry makes one list, sorted by aisle.</p>
          <div className="empty__actions">
            <button ref={addBtn} className="btn btn--cherry" onClick={() => open('recipes', addBtn.current)}><Icon name="plus" size={18} stroke={2.6} /> Add recipes</button>
          </div>
        </section>
      )}
      {empty && again.length > 0 && <BuyAgain items={again} onAdd={(i) => add([i])} />}

      {!empty && list && (
        <>
          {shareId && (
            <button className="live-banner" onClick={() => open('share', shareBtn.current)}>
              <span className="live-dot" aria-hidden="true" /> <b>Live</b> <span>Anyone with the link can tick items off</span><Icon name="next" size={16} />
            </button>
          )}
          <Progress list={list}>
            <button ref={recipesBtn} className="faces" onClick={() => open('recipes', recipesBtn.current)} aria-label="Manage recipes">
              {inList.slice(0, 4).map((r) => <span key={r.id} className="face">{r.imageUrl ? <img src={r.imageUrl} alt="" /> : null}</span>)}
              <span className="face face--more">{inList.length > 4 ? `+${inList.length - 4}` : <Icon name="plus" size={14} stroke={2.8} />}</span>
            </button>
          </Progress>
          <QuickAdd onAdd={add} suggestions={again} />
          <Aisles list={list} onToggle={(i) => edit(setChecked(i.id, !i.checked))} doneAction={{ label: 'Done shopping', run: () => finish() }} />
        </>
      )}

      <Sheet open={sheet === 'recipes'} onClose={() => setSheet(null)} from={from} label="Recipes on your list">
        <RecipesSheet list={list || null} recipes={recipes || []} inList={inList} onChange={(fn) => edit(fn)} />
      </Sheet>
      <Sheet open={sheet === 'past'} onClose={() => setSheet(null)} from={from} label="Past lists">
        <PastLists trips={trips || []} recipes={recipes || []} onAgain={async (t) => { await add(t.items); setSheet(null); toast(`${t.items.length} items back on your list`, 'cart'); }}
          onDelete={(t) => deleteTrip(uid, t.id)} />
      </Sheet>
      <Sheet open={sheet === 'share'} onClose={() => setSheet(null)} from={from} label="Share list">
        <SharePanel uid={uid} name={user?.displayName?.split(' ')[0] || ''} shareId={shareId || null} list={list || null} onClose={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === 'more'} onClose={() => setSheet(null)} from={from} label="List options">
        <div className="menu">
          <button className="menu__row" onClick={() => { edit((l) => ({ ...l, items: l.items.map((i) => ({ ...i, checked: false })) })); setSheet(null); }}>
            <Icon name="refresh" size={19} /> Uncheck everything
          </button>
          <button className="menu__row" onClick={() => setSheet('past')}><Icon name="clock" size={19} /> Past lists</button>
          <button className="menu__row menu__row--danger" onClick={async () => { setSheet(null); await finish(true); toast('List cleared', 'trash'); }}>
            <Icon name="trash" size={19} /> Clear the whole list
          </button>
        </div>
      </Sheet>
    </main>
  );
}

// ---------- Condividere: un link, la stessa lista dal vivo ----------

function SharePanel({ uid, name, shareId, list, onClose }: { uid: string; name: string; shareId: string | null; list: GroceryList | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = shareId ? shareUrl(shareId) : '';

  const start = async () => {
    setBusy(true);
    try { await shareList(uid, name); used('list.share'); } catch (e: any) { toast(e.message || 'Could not share', 'close'); }
    setBusy(false);
  };
  const send = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Our grocery list', text: 'Here’s our grocery list — tick things off as you shop:', url });
      else { await navigator.clipboard.writeText(url); setCopied(true); }
    } catch { /* annullato */ }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); navigator.vibrate?.(8); setTimeout(() => setCopied(false), 1800); } catch { /* niente appunti */ }
  };
  const asText = async () => {
    const text = (list?.items || []).filter((i) => !i.checked).map((i) => `${itemEmoji(i)} ${i.name}${i.quantity ? ` — ${i.quantity}` : ''}`).join('\n');
    try { if (navigator.share) await navigator.share({ title: 'Groceries', text }); else { await navigator.clipboard.writeText(text); toast('List copied'); } } catch { /* annullato */ }
  };

  if (!shareId) {
    return (
      <div className="add share">
        <div className="share__art" aria-hidden="true"><span>🛒</span><i /><span>📱</span></div>
        <h2 className="add__title">Shop together</h2>
        <p className="add__lead">Send a link. Whoever opens it sees this list and can tick items off — live, no app or account needed.</p>
        <button className={`btn btn--cherry btn--block btn--lg ${busy ? 'is-busy' : ''}`} onClick={start}><Icon name="link" size={18} /> Create a live link</button>
        <button className="btn btn--ghost btn--block" onClick={asText}>Send as text instead</button>
      </div>
    );
  }
  return (
    <div className="add share">
      <h2 className="add__title"><span className="live-dot" aria-hidden="true" /> Your list is live</h2>
      <p className="add__lead">Anyone with this link can see the list and tick items off. You’ll see their changes as they happen.</p>
      <div className="field share__link">
        <Icon name="link" size={17} />
        <input readOnly value={url.replace(/^https?:\/\//, '')} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
        <button className="field__go" onClick={copy} aria-label="Copy link">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={String(copied)} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} style={{ display: 'grid' }}>
              <Icon name={copied ? 'check' : 'paste'} size={16} stroke={copied ? 2.8 : 2.2} />
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
      <button className="btn btn--cherry btn--block btn--lg" onClick={send}><Icon name="share" size={18} /> Send the link</button>
      <button className={`btn btn--ghost btn--block share__stop ${busy ? 'is-busy' : ''}`} onClick={async () => {
        setBusy(true);
        try { await stopSharing(uid); onClose(); toast('Link turned off', 'lock'); } catch (e: any) { toast(e.message || 'Could not stop sharing', 'close'); }
        setBusy(false);
      }}>Stop sharing</button>
    </div>
  );
}

function RecipesSheet({ list, recipes, inList, onChange }: {
  list: GroceryList | null; recipes: Recipe[]; inList: Recipe[]; onChange: (fn: (l: GroceryList) => GroceryList) => Promise<unknown>;
}) {
  const others = recipes.filter((r) => r.status === 'ready' && !list?.recipeIds?.includes(r.id));
  return (
    <div className="picker">
      {inList.length > 0 && (
        <>
          <h2 className="picker__title">On your list</h2>
          <ul className="picker__list">
            {inList.map((r) => (
              <li key={r.id}>
                <span className="picker__img">{r.imageUrl && <img src={r.imageUrl} alt="" />}</span>
                <span className="picker__name">{r.title}</span>
                <button className="picker__btn" onClick={() => onChange((l) => ({ ...l, ...removeRecipeFromList(l, r.id) }))} aria-label={`Remove ${r.title}`}>
                  <Icon name="minus" size={16} stroke={2.6} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2 className="picker__title">{inList.length ? 'Add more' : 'What are you cooking?'}</h2>
      {others.length === 0 && <p className="quiet-note">Every recipe is already on your list.</p>}
      <ul className="picker__list">
        {others.map((r) => (
          <li key={r.id}>
            <span className="picker__img">{r.imageUrl && <img src={r.imageUrl} alt="" />}</span>
            <span className="picker__name">{r.title}<small>{r.ingredients.length} ingredients</small></span>
            <button className="picker__btn picker__btn--add" onClick={async () => { navigator.vibrate?.(8); await onChange((l) => ({ ...l, ...mergeIntoList(l, [r]) })); }} aria-label={`Add ${r.title}`}>
              <Icon name="plus" size={16} stroke={2.6} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const day = (ms: number) => {
  const d = Math.round((Date.now() - ms) / 864e5);
  if (d < 1) return 'Today';
  if (d < 2) return 'Yesterday';
  if (d < 7) return new Date(ms).toLocaleDateString('en-US', { weekday: 'long' });
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
};

function PastLists({ trips, recipes, onAgain, onDelete }: {
  trips: Trip[]; recipes: Recipe[]; onAgain: (t: Trip) => void; onDelete: (t: Trip) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(trips[0]?.id || null);
  if (!trips.length) {
    return (
      <div className="add">
        <h2 className="add__title">Past lists</h2>
        <p className="add__lead">When you tap “Done shopping”, what you bought lands here, ready to buy again.</p>
      </div>
    );
  }
  return (
    <div className="past">
      <h2 className="add__title">Past lists</h2>
      <ul className="past__list">
        {trips.map((t) => {
          const on = openId === t.id;
          const names = t.recipeIds.map((id) => recipes.find((r) => r.id === id)?.title).filter(Boolean);
          return (
            <li key={t.id} className={`past__trip ${on ? 'is-open' : ''}`}>
              <button className="past__head" onClick={() => setOpenId(on ? null : t.id)} aria-expanded={on}>
                <span className="past__emojis" aria-hidden="true">{t.items.slice(0, 4).map((i) => itemEmoji(i)).join('')}</span>
                <span className="past__when"><b>{day(t.at)}</b><small>{t.items.length} {t.items.length === 1 ? "item" : "items"}{names.length ? ` · ${names.join(', ')}` : ''}</small></span>
                <motion.span animate={{ rotate: on ? 180 : 0 }} style={{ display: 'grid' }}><Icon name="down" size={18} /></motion.span>
              </button>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }} style={{ overflow: 'hidden' }}>
                    <ul className="past__items">
                      {t.items.map((i) => <li key={i.id}><span aria-hidden="true">{itemEmoji(i)}</span>{i.name}{i.quantity && <em>{i.quantity}</em>}</li>)}
                    </ul>
                    <div className="past__actions">
                      <button className="btn btn--cherry" onClick={() => onAgain(t)}><Icon name="refresh" size={17} /> Add all to my list</button>
                      <button className="bar__btn" onClick={() => onDelete(t)} aria-label="Delete this list"><Icon name="trash" size={18} /></button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
