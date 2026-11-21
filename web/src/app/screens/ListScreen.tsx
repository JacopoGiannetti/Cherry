import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { Sheet, originOf, type Origin } from '../../components/Sheet';
import { deleteTrip, saveList, saveTrip, useList, useRecipes, useSession, useTrips } from '../../lib/store';
import { guessItem, itemEmoji, mergeIntoList, recurring, removeRecipeFromList, section } from '../../lib/kitchen';
import type { GroceryItem, GroceryList, Recipe, Trip } from '../../lib/types';

// La spesa si fa camminando tra le corsie: sopra quello che manca, diviso
// per corsia; ciò che spunti scivola giù, nel carrello. Le ricette da cui
// arriva la lista stanno in una fila di foto, e si gestiscono da un pannello.

const ROW = { type: 'spring', stiffness: 520, damping: 44 } as const;

export function ListScreen() {
  const { user } = useSession();
  const uid = user!.uid;
  const list = useList(uid);
  const recipes = useRecipes(uid);
  const [draft, setDraft] = useState('');
  const trips = useTrips(uid);
  const [focus, setFocus] = useState(false);
  const [sheet, setSheet] = useState<'recipes' | 'more' | 'past' | null>(null);
  const [from, setFrom] = useState<Origin>(null);
  const recipesBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const pastBtn = useRef<HTMLButtonElement>(null);
  const open = (which: 'recipes' | 'more' | 'past', el: Element | null) => { setFrom(originOf(el)); setSheet(which); };

  const items = list?.items || [];
  const todo = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const inList = (list?.recipeIds || []).map((id) => recipes?.find((r) => r.id === id)).filter(Boolean) as Recipe[];

  const aisles = useMemo(() => {
    const by = new Map<string, { label: string; order: number; items: GroceryItem[] }>();
    for (const item of todo) {
      const s = section(item.section);
      const g = by.get(s.label) || { label: s.label, order: s.order, items: [] };
      g.items.push(item);
      by.set(s.label, g);
    }
    return [...by.values()].sort((a, b) => a.order - b.order);
  }, [list]);

  const update = (next: GroceryList) => saveList(uid, next);
  const toggle = (id: string) => {
    if (!list) return;
    navigator.vibrate?.(6);
    update({ ...list, items: list.items.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)) });
  };
  const addItems = (add: { name: string; quantity?: string; section?: string; emoji?: string }[]) => {
    const base = list || { items: [], recipeIds: [] };
    const have = new Map(base.items.map((i) => [i.name.toLowerCase().trim(), i]));
    let items = base.items;
    const fresh: GroceryItem[] = [];
    for (const a of add) {
      const hit = have.get(a.name.toLowerCase().trim());
      if (hit) { items = items.map((i) => (i.id === hit.id ? { ...i, checked: false } : i)); continue; }
      const guess = guessItem(a.name);
      fresh.push({ id: crypto.randomUUID(), name: a.name, quantity: a.quantity || '', section: a.section && a.section !== 'other' ? a.section : guess.section,
        emoji: a.emoji || guess.emoji, checked: false, recipeIds: [], manual: true });
    }
    navigator.vibrate?.(6);
    return update({ ...base, items: [...fresh, ...items] });
  };
  const addItem = (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    addItems([{ name }]);
    setDraft('');
  };
  /** Chiudere la spesa: ciò che è nel carrello va nelle spese passate, il resto resta. */
  const finish = async (all = false) => {
    if (!list) return;
    const bought = list.items.filter((i) => i.checked);
    if (bought.length) await saveTrip(uid, { at: Date.now(), items: bought, recipeIds: list.recipeIds || [] });
    const left = all ? [] : list.items.filter((i) => !i.checked);
    const ids = new Set(left.flatMap((i) => i.recipeIds));
    await update({ items: left, recipeIds: (list.recipeIds || []).filter((id) => ids.has(id)) });
    if (bought.length) toast('Saved to past lists', 'check');
  };
  const again = recurring(trips, list).filter((r) => !draft.trim() || r.item.name.toLowerCase().includes(draft.trim().toLowerCase()));
  const share = async () => {
    const text = aisles.map((a) => `${a.label}\n${a.items.map((i) => `• ${i.name}${i.quantity ? ` — ${i.quantity}` : ''}`).join('\n')}`).join('\n\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Groceries', text });
      else { await navigator.clipboard.writeText(text); toast('List copied'); }
    } catch { /* annullato */ }
  };

  const empty = list !== undefined && items.length === 0;
  const pct = items.length ? Math.round((done.length / items.length) * 100) : 0;

  return (
    <main className="page">
      <header className="bar">
        <h1 className="bar__title">Groceries</h1>
        {!empty && (
          <div className="bar__actions">
            <button className="bar__btn" onClick={share} aria-label="Share list"><Icon name="share" /></button>
            <button ref={pastBtn} className="bar__btn" onClick={() => open('past', pastBtn.current)} aria-label="Past lists"><Icon name="clock" /></button>
            <button ref={moreBtn} className="bar__btn" onClick={() => open('more', moreBtn.current)} aria-label="More"><Icon name="dots" /></button>
          </div>
        )}
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
            {!!trips?.length && <button ref={pastBtn} className="btn btn--ghost" onClick={() => open('past', pastBtn.current)}><Icon name="clock" size={18} /> Past lists</button>}
          </div>
        </section>
      )}

      {empty && again.length > 0 && <BuyAgain items={again} onAdd={(i) => addItems([i])} />}

      {!empty && list && (
        <>
          <section className="summary">
            <div className="summary__row">
              <p><b>{todo.length ? `${todo.length} to buy` : 'All done'}</b>{done.length > 0 && <span> · {done.length} in the cart</span>}</p>
              <button ref={recipesBtn} className="faces" onClick={() => open('recipes', recipesBtn.current)} aria-label="Manage recipes">
                {inList.slice(0, 4).map((r) => <span key={r.id} className="face">{r.imageUrl ? <img src={r.imageUrl} alt="" /> : null}</span>)}
                <span className="face face--more">{inList.length > 4 ? `+${inList.length - 4}` : <Icon name="plus" size={14} stroke={2.8} />}</span>
              </button>
            </div>
            <div className="meter" aria-label={`${pct}% done`}><motion.i animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} /></div>
          </section>

          <form className="field field--quiet quick-add" onSubmit={addItem}>
            <Icon name="plus" size={17} />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
              placeholder="Add an item" aria-label="Add an item" enterKeyHint="done" />
            {draft.trim() && <button className="field__go" type="submit" aria-label="Add"><Icon name="check" size={16} stroke={2.8} /></button>}
          </form>
          <AnimatePresence initial={false}>
            {(focus || draft) && again.length > 0 && (
              <motion.div key="again" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                <BuyAgain items={again} onAdd={(i) => addItems([i])} />
              </motion.div>
            )}
          </AnimatePresence>

          <LayoutGroup>
            {aisles.map((a) => (
              <motion.section key={a.label} className="aisle" layout transition={ROW}>
                <h2 className="aisle__label">{a.label}</h2>
                <ul className="rows">
                  <AnimatePresence initial={false}>
                    {a.items.map((item) => <Row key={item.id} item={item} onToggle={toggle} />)}
                  </AnimatePresence>
                </ul>
              </motion.section>
            ))}

            {done.length > 0 && (
              <motion.section className="aisle aisle--done" layout transition={ROW}>
                <div className="aisle__head">
                  <h2 className="aisle__label">In the cart</h2>
                  <button className="link-btn" onClick={() => finish()}>Done shopping</button>
                </div>
                <ul className="rows">
                  <AnimatePresence initial={false}>
                    {done.map((item) => <Row key={item.id} item={item} onToggle={toggle} />)}
                  </AnimatePresence>
                </ul>
              </motion.section>
            )}
          </LayoutGroup>
        </>
      )}

      <Sheet open={sheet === 'recipes'} onClose={() => setSheet(null)} from={from} label="Recipes on your list">
        <RecipesSheet list={list || null} recipes={recipes || []} inList={inList} onChange={update} />
      </Sheet>
      <Sheet open={sheet === 'past'} onClose={() => setSheet(null)} from={from} label="Past lists">
        <PastLists trips={trips || []} recipes={recipes || []} onAgain={async (t) => { await addItems(t.items); setSheet(null); toast(`${t.items.length} items back on your list`, 'cart'); }}
          onDelete={(t) => deleteTrip(uid, t.id)} />
      </Sheet>
      <Sheet open={sheet === 'more'} onClose={() => setSheet(null)} from={from} label="List options">
        <div className="menu">
          <button className="menu__row" onClick={() => { list && update({ ...list, items: list.items.map((i) => ({ ...i, checked: false })) }); setSheet(null); }}>
            <Icon name="refresh" size={19} /> Uncheck everything
          </button>
          <button className="menu__row" onClick={() => { setSheet('past'); }}>
            <Icon name="clock" size={19} /> Past lists
          </button>
          <button className="menu__row menu__row--danger" onClick={async () => { setSheet(null); await finish(true); toast('List cleared', 'trash'); }}>
            <Icon name="trash" size={19} /> Clear the whole list
          </button>
        </div>
      </Sheet>
    </main>
  );
}

function Row({ item, onToggle }: { item: GroceryItem; onToggle: (id: string) => void }) {
  return (
    <motion.li layout layoutId={item.id} transition={ROW}
      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
      <button className={`row ${item.checked ? 'is-done' : ''}`} onClick={() => onToggle(item.id)} aria-pressed={item.checked}>
        <span className="tick">
          <AnimatePresence>{item.checked && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 700, damping: 26 }}>
              <Icon name="check" size={13} stroke={3.4} />
            </motion.span>
          )}</AnimatePresence>
        </span>
        <span className="row__emoji" aria-hidden="true">{itemEmoji(item)}</span>
        <span className="row__name">{item.name}</span>
        {item.quantity && <span className="row__qty">{item.quantity}</span>}
      </button>
    </motion.li>
  );
}

function RecipesSheet({ list, recipes, inList, onChange }: {
  list: GroceryList | null; recipes: Recipe[]; inList: Recipe[]; onChange: (l: GroceryList) => Promise<void>;
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
                <button className="picker__btn" onClick={() => list && onChange(removeRecipeFromList(list, r.id))} aria-label={`Remove ${r.title}`}>
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
            <button className="picker__btn picker__btn--add" onClick={async () => { await onChange(mergeIntoList(list, [r])); navigator.vibrate?.(8); }} aria-label={`Add ${r.title}`}>
              <Icon name="plus" size={16} stroke={2.6} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BuyAgain({ items, onAdd }: { items: { item: GroceryItem; count: number }[]; onAdd: (i: GroceryItem) => void }) {
  return (
    <section className="again">
      <h2 className="aisle__label">Buy again</h2>
      <div className="again__chips">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map(({ item }) => (
            <motion.button layout key={item.name.toLowerCase()} className="again__chip" onClick={() => onAdd(item)}
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ type: 'spring', stiffness: 600, damping: 32 }}>
              <span aria-hidden="true">{itemEmoji(item)}</span>{item.name}<Icon name="plus" size={14} stroke={2.6} />
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </section>
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
