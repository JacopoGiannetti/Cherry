import { useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Icon } from './Icon';
import { guessItem, itemEmoji, section } from '../lib/kitchen';
import '../styles/pages.css';
import { Roll } from './Roll';
import type { GroceryItem, GroceryList } from '../lib/types';

// I pezzi della spesa usati sia dalla tua lista sia dalla pagina di chi apre il link:
// stesse corsie, stessa spunta, stesso carrello.

const ROW = { type: 'spring', stiffness: 520, damping: 44 } as const;

// ---------- Cambiamenti: funzioni pure, applicate sull'ultima versione della lista ----------

export const setChecked = (id: string, checked: boolean) => (l: GroceryList): GroceryList =>
  ({ ...l, items: l.items.map((i) => (i.id === id ? { ...i, checked } : i)) });

export type NewItem = { name: string; quantity?: string; section?: string; emoji?: string };

export const addItems = (add: NewItem[]) => (l: GroceryList): GroceryList => {
  const have = new Map(l.items.map((i) => [i.name.toLowerCase().trim(), i]));
  let items = l.items;
  const fresh: GroceryItem[] = [];
  for (const a of add) {
    const hit = have.get(a.name.toLowerCase().trim());
    if (hit) { items = items.map((i) => (i.id === hit.id ? { ...i, checked: false } : i)); continue; }
    const guess = guessItem(a.name);
    fresh.push({
      id: crypto.randomUUID(), name: a.name, quantity: a.quantity || '',
      section: a.section && a.section !== 'other' ? a.section : guess.section,
      emoji: a.emoji || guess.emoji, checked: false, recipeIds: [], manual: true,
    });
  }
  return { ...l, items: [...fresh, ...items] };
};

export const clearChecked = (l: GroceryList): GroceryList => {
  const items = l.items.filter((i) => !i.checked);
  const ids = new Set(items.flatMap((i) => i.recipeIds));
  return { ...l, items, recipeIds: (l.recipeIds || []).filter((id) => ids.has(id)) };
};

// ---------- Corsie e righe ----------

export function Aisles({ list, onToggle, doneAction }: {
  list: GroceryList; onToggle: (item: GroceryItem) => void; doneAction?: { label: string; run: () => void };
}) {
  const todo = list.items.filter((i) => !i.checked);
  const done = list.items.filter((i) => i.checked);
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

  return (
    <LayoutGroup>
      {aisles.map((a) => (
        <motion.section key={a.label} className="aisle" layout transition={ROW}>
          <h2 className="aisle__label"><em>{a.label}</em><span>{a.items.length}</span></h2>
          <ul className="rows">
            <AnimatePresence initial={false}>
              {a.items.map((item) => <Row key={item.id} item={item} onToggle={onToggle} />)}
            </AnimatePresence>
          </ul>
        </motion.section>
      ))}
      {done.length > 0 && (
        <motion.section className="aisle aisle--done" layout transition={ROW}>
          <div className="aisle__head">
            <h2 className="aisle__label"><em>In the cart</em><span>{done.length}</span></h2>
            {doneAction && <button className="link-btn" onClick={doneAction.run}>{doneAction.label}</button>}
          </div>
          <ul className="rows">
            <AnimatePresence initial={false}>
              {done.map((item) => <Row key={item.id} item={item} onToggle={onToggle} />)}
            </AnimatePresence>
          </ul>
        </motion.section>
      )}
    </LayoutGroup>
  );
}

function Row({ item, onToggle }: { item: GroceryItem; onToggle: (item: GroceryItem) => void }) {
  return (
    <motion.li layout layoutId={item.id} transition={ROW}
      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
      <button className={`row ${item.checked ? 'is-done' : ''}`} onClick={() => { navigator.vibrate?.(6); onToggle(item); }} aria-pressed={item.checked}>
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

// ---------- Aggiungere a mano (con i suggerimenti di ciò che compri spesso) ----------

export function QuickAdd({ onAdd, suggestions = [] }: { onAdd: (items: NewItem[]) => void; suggestions?: GroceryItem[] }) {
  const [draft, setDraft] = useState('');
  const [focus, setFocus] = useState(false);
  const q = draft.trim().toLowerCase();
  const shown = suggestions.filter((s) => !q || s.name.toLowerCase().includes(q));
  return (
    <>
      <form className="field field--quiet quick-add" onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        onAdd([{ name: draft.trim() }]);
        setDraft('');
      }}>
        <Icon name="plus" size={17} />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder="Add an item" aria-label="Add an item" enterKeyHint="done" />
        {draft.trim() && <button className="field__go" type="submit" aria-label="Add"><Icon name="check" size={16} stroke={2.8} /></button>}
      </form>
      <AnimatePresence initial={false}>
        {(focus || draft) && shown.length > 0 && (
          <motion.div key="again" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
            <BuyAgain items={shown} onAdd={(i) => { onAdd([i]); setDraft(''); }} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function BuyAgain({ items, onAdd }: { items: GroceryItem[]; onAdd: (i: GroceryItem) => void }) {
  return (
    <section className="again">
      <h2 className="aisle__label">Buy again</h2>
      <div className="again__chips">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item) => (
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

/** Quanti da comprare, quanti nel carrello, e la barra che si riempie. */
export function Progress({ list, children }: { list: GroceryList; children?: React.ReactNode }) {
  const todo = list.items.filter((i) => !i.checked).length;
  const done = list.items.length - todo;
  const pct = list.items.length ? Math.round((done / list.items.length) * 100) : 0;
  return (
    <section className="summary">
      <div className="summary__row">
        {/* Il numero che conta, grande: quante cose mancano. */}
        <p className="summary__count">
          {todo ? <><b><Roll value={todo} /></b><span>to buy{done > 0 ? ` · ${done} in the cart` : ''}</span></> : <><b>Done</b><span>everything is in the cart</span></>}
        </p>
        {children}
      </div>
      <div className="meter" aria-label={`${pct}% done`}><motion.i animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} /></div>
    </section>
  );
}
