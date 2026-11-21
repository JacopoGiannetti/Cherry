import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useLocation } from 'wouter';
import { Icon } from '../../components/Icon';
import { RecipeCard } from '../../components/RecipeCard';
import { useRecipes, useSession } from '../../lib/store';

export function Library() {
  const { user } = useSession();
  const recipes = useRecipes(user?.uid);
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const first = user?.displayName?.split(' ')[0];

  const cuisines = useMemo(() => {
    const set = new Map<string, number>();
    for (const r of recipes || []) if (r.cuisine) set.set(r.cuisine, (set.get(r.cuisine) || 0) + 1);
    return [...set.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
  }, [recipes]);

  const shown = useMemo(() => {
    let list = recipes || [];
    if (filter === 'quick') list = list.filter((r) => r.cookMinutes && r.cookMinutes <= 30);
    else if (filter === 'fav') list = list.filter((r) => r.favorite);
    else if (filter !== 'all') list = list.filter((r) => r.cuisine === filter);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((r) => r.title.toLowerCase().includes(s) || r.ingredients?.some((g) => g.name.toLowerCase().includes(s)));
    }
    return list;
  }, [recipes, filter, q]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <main className="screen">
      <div className="topbar">
        <span className="eyebrow">{greet}{first ? `, ${first}` : ''}</span>
        <Link href="/settings" className="avatar" aria-label="Account">
          {user?.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : <Icon name="user" />}
        </Link>
      </div>

      <div className="hello">
        <h1 className="display">What are we <em>cooking?</em></h1>
        {recipes && recipes.length > 0 && <p>{recipes.length} recipe{recipes.length === 1 ? '' : 's'} in your cookbook</p>}
      </div>

      <motion.button className="paste-card" onClick={() => navigate('/add')} whileTap={{ scale: 0.98 }}>
        <span className="paste-card__icon"><Icon name="link" stroke={2.4} /></span>
        <span style={{ position: 'relative', zIndex: 1 }}><b>Add a recipe video</b><span>Paste a TikTok or Instagram link</span></span>
        <Icon name="next" className="paste-card__go" />
      </motion.button>

      {recipes === null && (
        <div className="grid">{[0, 1, 2, 3].map((i) => <div key={i} className="rcard shimmer" style={{ aspectRatio: '4/5' }} />)}</div>
      )}

      {recipes && recipes.length === 0 && (
        <div className="empty">
          <div className="empty__plates" aria-hidden="true">
            {['tacos', 'ramen', 'burger'].map((p) => <span key={p} className="plate"><img src={`/assets/plates/${p}.jpg`} alt="" /></span>)}
          </div>
          <h2 className="display">Your cookbook is <em>hungry.</em></h2>
          <p>Find a recipe on TikTok or Instagram, tap Share → Copy link, and paste it here.</p>
          <Link href="/add" className="btn btn--cherry">Add your first recipe</Link>
        </div>
      )}

      {recipes && recipes.length > 0 && (
        <>
          {recipes.length > 5 && (
            <label className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes or ingredients" /></label>
          )}
          <div className="filters" role="tablist">
            {[['all', 'All'], ['quick', 'Under 30 min'], ['fav', 'Favorites'], ...cuisines.map((c) => [c, c])].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={filter === id} className={`filter ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
          <div className="grid">
            {shown.map((r, i) => <RecipeCard key={r.id} recipe={r} index={i} />)}
          </div>
          {!shown.length && <p className="muted" style={{ textAlign: 'center', padding: 30 }}>Nothing here yet.</p>}
        </>
      )}
    </main>
  );
}
