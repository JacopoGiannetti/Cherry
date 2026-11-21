import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'wouter';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { saveList, useList, useRecipes, useSession } from '../../lib/store';
import { mergeIntoList, removeRecipeFromList, section, SECTIONS } from '../../lib/kitchen';
import type { GroceryItem, GroceryList } from '../../lib/types';

const DOTS = ['#E5566E', '#3F9A62', '#EE9A62', '#7C6CF2', '#2E9BD6', '#C76AC2', '#8A9A2B'];

export function ListScreen() {
  const { user } = useSession();
  const uid = user!.uid;
  const list = useList(uid);
  const recipes = useRecipes(uid);
  const [newItem, setNewItem] = useState('');
  const [picking, setPicking] = useState(false);

  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    (list?.recipeIds || []).forEach((id, i) => m.set(id, DOTS[i % DOTS.length]));
    return m;
  }, [list?.recipeIds]);

  const groups = useMemo(() => {
    const by = new Map<string, GroceryItem[]>();
    for (const item of list?.items || []) {
      const key = section(item.section).label;
      by.set(key, [...(by.get(key) || []), item]);
    }
    return [...by.entries()]
      .map(([label, items]) => ({ label, emoji: Object.values(SECTIONS).find((s) => s.label === label)?.emoji || '🛒', order: Object.values(SECTIONS).find((s) => s.label === label)?.order ?? 99, items }))
      .sort((a, b) => a.order - b.order);
  }, [list]);

  const total = list?.items.length || 0;
  const done = list?.items.filter((i) => i.checked).length || 0;

  const update = (next: GroceryList) => saveList(uid, next);
  const toggle = (id: string) => {
    if (!list) return;
    navigator.vibrate?.(8);
    update({ ...list, items: list.items.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)) });
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newItem.trim();
    if (!name) return;
    const base = list || { items: [], recipeIds: [] };
    update({ ...base, items: [...base.items, { id: crypto.randomUUID(), name, quantity: '', section: 'other', checked: false, recipeIds: [], manual: true }] });
    setNewItem('');
  };
  const clearChecked = () => list && update({ ...list, items: list.items.filter((i) => !i.checked) });
  const share = async () => {
    if (!list) return;
    const text = groups.map((g) => `${g.emoji} ${g.label}\n${g.items.filter((i) => !i.checked).map((i) => `• ${i.name}${i.quantity ? ` (${i.quantity})` : ''}`).join('\n')}`).join('\n\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Grocery list', text });
      else { await navigator.clipboard.writeText(text); toast('List copied'); }
    } catch { /* annullato */ }
  };

  const listRecipes = (list?.recipeIds || []).map((id) => recipes?.find((r) => r.id === id)).filter(Boolean);
  const ready = (recipes || []).filter((r) => r.status === 'ready' && !list?.recipeIds?.includes(r.id));

  return (
    <main className="screen">
      <div className="list-head">
        <div>
          <p className="eyebrow">{total ? `${total - done} left` : 'Groceries'}</p>
          <h1 className="display" style={{ fontSize: 'clamp(44px, 12vw, 60px)', marginTop: 6 }}>Your <em>list</em></h1>
        </div>
        {total > 0 && <button className="icon-btn" onClick={share} aria-label="Share list"><Icon name="share" /></button>}
      </div>

      {total > 0 && <div className="progress" aria-label={`${done} of ${total} checked`}><i style={{ width: `${(done / total) * 100}%` }} /></div>}

      {listRecipes.length > 0 && (
        <div className="list-recipes">
          {listRecipes.map((r) => (
            <span key={r!.id} className="lr">
              {r!.imageUrl && <img src={r!.imageUrl} alt="" />}
              <i style={{ background: colorOf.get(r!.id) }} />
              <span>{r!.title}</span>
              <button aria-label={`Remove ${r!.title}`} onClick={() => list && update(removeRecipeFromList(list, r!.id))}><Icon name="close" size={14} stroke={2.6} /></button>
            </span>
          ))}
        </div>
      )}

      <button className="btn btn--ink btn--block" style={{ marginBottom: 16 }} onClick={() => setPicking(true)}>
        <Icon name="plus" stroke={2.6} /> Add recipes to the list
      </button>

      <form className="add-item" onSubmit={add}>
        <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item (paper towels, coffee…)" aria-label="Add an item" />
        <button className="btn btn--ghost btn--sm" type="submit" style={{ height: 50 }} disabled={!newItem.trim()}>Add</button>
      </form>

      {total === 0 && (
        <div className="empty" style={{ paddingTop: 10 }}>
          <h2 className="display">Nothing to buy <em>yet.</em></h2>
          <p>Add a few recipes and Cherry builds one list, sorted by aisle.</p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.label} className="aisle">
          <h3 className="aisle__head"><span>{g.label}</span><small>{g.items.filter((i) => !i.checked).length}</small></h3>
          <div className="items">
            {[...g.items].sort((a, b) => Number(a.checked) - Number(b.checked)).map((item) => (
              <motion.button layout key={item.id} className={`item ${item.checked ? 'done' : ''}`} onClick={() => toggle(item.id)} transition={{ type: 'spring', stiffness: 500, damping: 40 }}>
                <span className="box">{item.checked && <Icon name="check" size={16} stroke={3.2} />}</span>
                <span style={{ flex: 1 }}>
                  <span className="item__name">{item.emoji ? `${item.emoji} ` : ''}{item.name}</span>
                  {item.recipeIds.length > 0 && <span className="item__dots">{item.recipeIds.map((id) => <i key={id} style={{ background: colorOf.get(id) }} />)}</span>}
                </span>
                <span className="item__qty">{item.quantity}</span>
              </motion.button>
            ))}
          </div>
        </section>
      ))}

      {done > 0 && <button className="source-link" style={{ width: '100%' }} onClick={clearChecked}><Icon name="trash" size={16} /> Clear {done} checked</button>}

      <AnimatePresence>
        {picking && (
          <>
            <motion.div className="sheet-bg" onClick={() => setPicking(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div className="sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}>
              <div className="sheet__grab" />
              <h2 className="display">What are you <em>cooking?</em></h2>
              <p className="muted" style={{ marginBottom: 16 }}>Tap recipes to add their ingredients.</p>
              {!ready.length && <p className="muted">All your recipes are already on the list. <Link href="/add">Add a new one</Link>.</p>}
              <div className="pick-grid">
                {ready.map((r) => (
                  <button key={r.id} className="pick" onClick={async () => {
                    await update(mergeIntoList(list || null, [r]));
                    toast(`${r.title} added`, 'cart');
                  }}>
                    {r.imageUrl ? <img src={r.imageUrl} alt="" /> : <span className="shimmer" />}
                    <b>{r.title}</b>
                    <span className="pick__plus"><Icon name="plus" size={16} stroke={2.8} /></span>
                  </button>
                ))}
              </div>
              <button className="btn btn--ink btn--block" style={{ marginTop: 18 }} onClick={() => setPicking(false)}>Done</button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </main>
  );
}
