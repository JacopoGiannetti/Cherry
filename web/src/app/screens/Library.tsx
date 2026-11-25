import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'wouter';
import { Icon } from '../../components/Icon';
import { RecipeCard } from '../../components/RecipeCard';
import { Sheet, originOf, type Origin } from '../../components/Sheet';
import { AddRecipe } from '../../components/AddRecipe';
import { deleteCategory, saveCategory, setInCategory, useCategories, useRecipes, useSession } from '../../lib/store';
import { CategoryForm, RecipePicker } from '../../components/Categories';
import { toast } from '../../components/Toast';
import { used } from '../../lib/usage';

export function Library() {
  const { user } = useSession();
  const recipes = useRecipes(user?.uid);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const addBtn = useRef<HTMLButtonElement>(null);
  const [from, setFrom] = useState<Origin>(null);
  const [adding, setAdding] = useState(false);
  const categories = useCategories(user?.uid);
  const [catSheet, setCatSheet] = useState<'new' | 'edit' | 'pick' | null>(null);
  const newBtn = useRef<HTMLButtonElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const pickBtn = useRef<HTMLButtonElement>(null);
  const openCat = (which: 'new' | 'edit' | 'pick', el: Element | null) => { setFrom(originOf(el)); setCatSheet(which); };
  const activeCat = filter.startsWith('c:') ? categories?.find((c) => c.id === filter.slice(2)) : undefined;
  const openAdd = (el: Element | null) => { setFrom(originOf(el)); setAdding(true); };

  const filters = useMemo(() => {
    const cuisines = new Map<string, number>();
    for (const r of recipes || []) if (r.cuisine) cuisines.set(r.cuisine, (cuisines.get(r.cuisine) || 0) + 1);
    const top = [...cuisines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => [c, c]);
    const mine = (categories || []).map((c) => [`c:${c.id}`, `${c.emoji ? c.emoji + ' ' : ''}${c.name}`]);
    const base = [['all', 'All'], ...mine];
    if (recipes?.some((r) => r.favorite)) base.push(['fav', 'Favorites']);
    base.push(['quick', 'Quick']);
    return [...base, ...top];
  }, [recipes, categories]);

  const shown = useMemo(() => {
    let list = recipes || [];
    if (filter === 'quick') list = list.filter((r) => r.cookMinutes && r.cookMinutes <= 30);
    else if (filter === 'fav') list = list.filter((r) => r.favorite);
    else if (filter.startsWith('c:')) { const ids = new Set(activeCat?.recipeIds || []); list = list.filter((r) => ids.has(r.id)); }
    else if (filter !== 'all') list = list.filter((r) => r.cuisine === filter);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((r) => r.title.toLowerCase().includes(s) || r.ingredients.some((g) => g.name.toLowerCase().includes(s)));
    return list;
  }, [recipes, filter, q, activeCat]);
  // Categoria cancellata mentre era aperta: si torna a tutte.
  useEffect(() => { if (filter.startsWith('c:') && categories && !activeCat) setFilter('all'); }, [filter, categories, activeCat]);
  // La categoria scelta (o appena creata) entra nella fila dei chip.
  useEffect(() => { document.querySelector('.chip-tab.is-on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [filter]);

  const empty = recipes && recipes.length === 0;

  return (
    <main className="page">
      <header className="bar">
        <h1 className="bar__title">Cookbook</h1>
        <div className="bar__actions">
          {!empty && <button className="bar__btn" onClick={() => setSearching((s) => !s)} aria-label="Search"><Icon name={searching ? 'close' : 'search'} /></button>}
          <Link href="/settings" className="bar__avatar" aria-label="Account">
            {user?.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : <Icon name="user" size={18} />}
          </Link>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {searching && (
          <motion.div className="search" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
            <div className="field field--quiet"><Icon name="search" size={17} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Recipes or ingredients" aria-label="Search recipes" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {recipes === null && (
        <div className="grid">{[0, 1, 2, 3].map((i) => <div key={i}><div className="card__img shimmer" /><p className="card__title shimmer-line" /></div>)}</div>
      )}

      {empty && (
        <section className="empty">
          <div className="empty__art" aria-hidden="true">
            {['tacos', 'ramen', 'burger'].map((p) => <span key={p} className="plate"><img src={`/assets/plates/${p}.jpg`} alt="" /></span>)}
          </div>
          <h2>Your cookbook is empty</h2>
          <p>Save a recipe video from TikTok or Instagram and it shows up here, ready to cook.</p>
          <button ref={addBtn} className="btn btn--cherry" onClick={() => openAdd(addBtn.current)}><Icon name="plus" size={18} stroke={2.6} /> Add your first recipe</button>
        </section>
      )}

      {recipes && recipes.length > 0 && (
        <>
          <div className="chips" role="tablist" aria-label="Filter recipes">
            {filters.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={filter === id} className={`chip-tab ${filter === id ? 'is-on' : ''}`} onClick={() => setFilter(id)}>
                {filter === id && <motion.span layoutId="chip-on" className="chip-tab__bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <span>{label}</span>
              </button>
            ))}
            <button ref={newBtn} className="chip-tab chip-tab--new" onClick={() => openCat('new', newBtn.current)} aria-label="New category">
              <Icon name="plus" size={14} stroke={2.6} /><span>New</span>
            </button>
          </div>
          <AnimatePresence initial={false}>
            {activeCat && (
              <motion.div key="catbar" className="cat-bar" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                <div className="cat-bar__in">
                  <span className="cat-bar__count">{activeCat.recipeIds.filter((id) => recipes.some((r) => r.id === id)).length} recipes</span>
                  <button ref={pickBtn} className="cat-bar__btn" onClick={() => openCat('pick', pickBtn.current)}><Icon name="plus" size={15} stroke={2.6} /> Add recipes</button>
                  <button ref={editBtn} className="cat-bar__btn" onClick={() => openCat('edit', editBtn.current)}><Icon name="pencil" size={15} /> Edit</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <motion.div className="grid" layout>
            <AnimatePresence mode="popLayout">
              {shown.map((r, i) => <RecipeCard key={r.id} recipe={r} index={i} />)}
            </AnimatePresence>
          </motion.div>
          {!shown.length && (activeCat && !q ? (
            <div className="cat-empty">
              <span aria-hidden="true">{activeCat.emoji || '📁'}</span>
              <p>Nothing in {activeCat.name} yet.</p>
              <button className="btn btn--cherry" onClick={() => openCat('pick', pickBtn.current)}><Icon name="plus" size={16} stroke={2.6} /> Add recipes</button>
            </div>
          ) : <p className="quiet-note">No recipes match.</p>)}
        </>
      )}

      <Sheet open={catSheet === 'new'} onClose={() => setCatSheet(null)} from={from} label="New category">
        <CategoryForm onSave={async (name, emoji) => {
          const id = await saveCategory(user!.uid, { name, emoji });
          used('folder.use');
          setFilter(`c:${id}`);
          setCatSheet('pick');
        }} />
      </Sheet>
      <Sheet open={catSheet === 'edit' && !!activeCat} onClose={() => setCatSheet(null)} from={from} label="Edit category">
        {activeCat && (
          <CategoryForm key={activeCat.id} initial={activeCat}
            onSave={async (name, emoji) => { await saveCategory(user!.uid, { id: activeCat.id, name, emoji }); setCatSheet(null); toast('Category saved', 'check'); }}
            onDelete={async () => { setCatSheet(null); setFilter('all'); await deleteCategory(user!.uid, activeCat.id); toast('Category deleted', 'trash'); }} />
        )}
      </Sheet>
      <Sheet open={catSheet === 'pick' && !!activeCat} onClose={() => setCatSheet(null)} from={from} label="Choose recipes">
        {activeCat && recipes && (
          <RecipePicker category={activeCat} recipes={recipes} onDone={() => setCatSheet(null)}
            onToggle={(rid, on) => { used('folder.use'); setInCategory(user!.uid, activeCat.id, rid, on).catch((e) => toast(e.message, 'close')); }} />
        )}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} from={from} label="Add a recipe">
        <AddRecipe onDone={() => setAdding(false)} />
      </Sheet>
    </main>
  );
}
