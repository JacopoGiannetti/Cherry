import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from './Icon';
import type { Category, Recipe } from '../lib/types';

// Le categorie del ricettario: le crei, le rinomini, scegli cosa c'è dentro.
// Tre pannelli, tutti dentro <Sheet>: il modulo (nome + emoji), la scelta delle
// ricette per una categoria, la scelta delle categorie per una ricetta.

export const CATEGORY_EMOJI = ['🌙', '⚡️', '🥗', '🍝', '🍲', '🥩', '🐟', '🌮', '🍜', '🥘', '🍰', '🥞', '🎉', '🕯️', '❤️', '💪', '🌱', '👶', '🧊', '🔥'];

export function CategoryForm({ initial, onSave, onDelete }: {
  initial?: Category; onSave: (name: string, emoji: string) => Promise<unknown> | void; onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [emoji, setEmoji] = useState(initial?.emoji || CATEGORY_EMOJI[0]);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const ok = name.trim().length > 0;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    try { await onSave(name.trim(), emoji); } finally { setBusy(false); }
  };

  if (asking && onDelete) {
    return (
      <div className="menu">
        <p className="menu__ask">Delete “{initial?.name}”? The recipes stay in your cookbook.</p>
        <button className="btn btn--danger btn--block" onClick={onDelete}>Delete category</button>
        <button className="btn btn--ghost btn--block" onClick={() => setAsking(false)}>Keep it</button>
      </div>
    );
  }

  return (
    <form className="add cat-form" onSubmit={submit}>
      <h2 className="add__title">{initial ? 'Edit category' : 'New category'}</h2>
      <div className="cat-form__preview">
        <motion.span key={emoji} className="cat-form__emoji" initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }}>{emoji}</motion.span>
        <input className="cat-form__name" value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="Weeknight dinners" aria-label="Category name" autoFocus={!initial} enterKeyHint="done" />
      </div>
      <div className="cat-form__emojis" role="radiogroup" aria-label="Icon">
        {CATEGORY_EMOJI.map((e) => (
          <button type="button" key={e} role="radio" aria-checked={emoji === e} className={emoji === e ? 'is-on' : ''} onClick={() => setEmoji(e)}>{e}</button>
        ))}
      </div>
      <button type="submit" className={`btn btn--cherry btn--block btn--lg ${busy ? 'is-busy' : ''}`} disabled={!ok}>{initial ? 'Save' : 'Create category'}</button>
      {initial && onDelete && <button type="button" className="link-btn cat-form__delete" onClick={() => setAsking(true)}>Delete category</button>}
    </form>
  );
}

/** Le ricette dentro una categoria: si toccano per metterle o toglierle. */
export function RecipePicker({ category, recipes, onToggle, onDone }: {
  category: Category; recipes: Recipe[]; onToggle: (recipeId: string, on: boolean) => void; onDone: () => void;
}) {
  const [q, setQ] = useState('');
  const inside = new Set(category.recipeIds);
  const s = q.trim().toLowerCase();
  const shown = recipes.filter((r) => r.status !== 'importing' && (!s || r.title.toLowerCase().includes(s)));
  return (
    <div className="add picker-cat">
      <h2 className="add__title">{category.emoji} {category.name}</h2>
      <p className="add__lead">{inside.size ? `${inside.size} recipe${inside.size === 1 ? '' : 's'} inside. Tap to add or remove.` : 'Tap the recipes that belong here.'}</p>
      {recipes.length > 6 && (
        <div className="field field--quiet"><Icon name="search" size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes" aria-label="Search recipes" /></div>
      )}
      <ul className="picker-cat__grid">
        {shown.map((r) => {
          const on = inside.has(r.id);
          return (
            <li key={r.id}>
              <button className={`picker-cat__item ${on ? 'is-on' : ''}`} onClick={() => { navigator.vibrate?.(6); onToggle(r.id, !on); }} aria-pressed={on}>
                <span className="picker-cat__img">
                  {r.imageUrl ? <img src={r.imageUrl} alt="" /> : null}
                  <span className="picker-cat__check">
                    <AnimatePresence>{on && (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 700, damping: 24 }}>
                        <Icon name="check" size={14} stroke={3.2} />
                      </motion.span>
                    )}</AnimatePresence>
                  </span>
                </span>
                <span className="picker-cat__title">{r.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button className="btn btn--cherry btn--block picker-cat__done" onClick={onDone}>Done</button>
    </div>
  );
}

/** Dalla ricetta: in quali categorie sta. */
export function CategoryChooser({ categories, recipeId, onToggle, onNew }: {
  categories: Category[]; recipeId: string; onToggle: (categoryId: string, on: boolean) => void; onNew: () => void;
}) {
  return (
    <div className="add">
      <h2 className="add__title">Categories</h2>
      {categories.length === 0 && <p className="add__lead">Group recipes your way: weeknights, date night, meal prep…</p>}
      {categories.length > 0 && (
        <div className="langs">
          {categories.map((c) => {
            const on = c.recipeIds.includes(recipeId);
            return (
              <button key={c.id} className={`langs__row ${on ? 'is-on' : ''}`} onClick={() => { navigator.vibrate?.(6); onToggle(c.id, !on); }} aria-pressed={on}>
                <span aria-hidden="true">{c.emoji || '📁'}</span>{c.name}
                <span className={`cat-check ${on ? 'is-on' : ''}`}>{on && <Icon name="check" size={14} stroke={3} />}</span>
              </button>
            );
          })}
        </div>
      )}
      <button className="add__own" onClick={onNew}>
        <span className="add__own-icon"><Icon name="plus" size={18} stroke={2.6} /></span>
        <span><b>New category</b><small>Name it and this recipe goes inside</small></span>
        <Icon name="next" size={18} />
      </button>
    </div>
  );
}
