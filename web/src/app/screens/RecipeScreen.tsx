import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'wouter';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { Sheet, originOf, type Origin } from '../../components/Sheet';
import { deleteRecipe, editList, saveCategory, setFavorite, setInCategory, setRecipePhoto, useCategories, useList, useRecipe, useSession } from '../../lib/store';
import { CategoryChooser, CategoryForm } from '../../components/Categories';
import { uploadPhoto } from '../../lib/upload';
import { importRecipe, refreshCover, resolveEmbed } from '../../lib/api';
import { mergeIntoList, minutes, removeRecipeFromList, scaleQuantity } from '../../lib/kitchen';
import type { Recipe } from '../../lib/types';
import { used } from '../../lib/usage';

export function RecipeScreen({ id }: { id: string }) {
  const { user, doc } = useSession();
  const recipe = useRecipe(user?.uid, id);
  const [, navigate] = useLocation();

  if (recipe === undefined) return <div className="boot"><span className="spinner" /></div>;
  if (recipe === null) {
    return (
      <main className="page">
        <header className="bar"><button className="bar__btn" onClick={() => navigate('/')} aria-label="Back"><Icon name="back" /></button></header>
        <section className="empty"><h2>Recipe not found</h2><p>It may have been deleted.</p></section>
      </main>
    );
  }
  if (recipe.status === 'importing') return <Importing recipe={recipe} onBack={() => navigate('/')} />;
  if (recipe.status === 'failed') return <Failed recipe={recipe} uid={user!.uid} />;
  return <Ready recipe={recipe} uid={user!.uid} household={Number(doc?.webProfile?.household) || 0} />;
}

// ---------- In lettura ----------

function Importing({ recipe, onBack }: { recipe: Recipe; onBack: () => void }) {
  const [t, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT((n) => n + 1), 1000); return () => clearInterval(i); }, []);
  const stages = ['Opening the post', 'Watching the whole video', 'Writing every step'];
  const at = recipe.importStage === 'watching' ? (t > 14 ? 2 : 1) : 0;
  return (
    <main className="page">
      <header className="bar"><button className="bar__btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button></header>
      <section className="reading">
        <div className="reading__ring" aria-hidden="true">
          <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" /><circle cx="60" cy="60" r="54" className="fg" pathLength={100}
            style={{ strokeDasharray: 100, strokeDashoffset: 100 - Math.min(92, (t / 45) * 100) }} /></svg>
          <span>{t}s</span>
        </div>
        <h1>Reading your recipe</h1>
        <p>You can leave this screen. It will be in your cookbook when it’s ready.</p>
        <ol className="steps-list">
          {stages.map((s, i) => (
            <li key={s} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
              <span className="steps-list__dot">{i < at ? <Icon name="check" size={12} stroke={3.2} /> : null}</span>{s}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function Failed({ recipe, uid }: { recipe: Recipe; uid: string }) {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  return (
    <main className="page">
      <header className="bar"><button className="bar__btn" onClick={() => navigate('/')} aria-label="Back"><Icon name="back" /></button></header>
      <section className="empty">
        <h2>We couldn’t read this one</h2>
        <p>{recipe.error || 'Something went wrong.'}</p>
        <div className="empty__actions">
          {recipe.sourceUrl && (
            <button className={`btn btn--cherry ${busy ? 'is-busy' : ''}`} onClick={async () => {
              setBusy(true);
              try { await importRecipe(recipe.sourceUrl!); } catch (e: any) { toast(e.message, 'close'); setBusy(false); }
            }}>Try again</button>
          )}
          <button className="btn btn--ghost" onClick={async () => { await deleteRecipe(uid, recipe.id); navigate('/'); }}>Remove</button>
        </div>
      </section>
    </main>
  );
}

// ---------- Pronta ----------

function Ready({ recipe, uid, household }: { recipe: Recipe; uid: string; household: number }) {
  const [, navigate] = useLocation();
  const list = useList(uid);
  const base = recipe.servings || 2;
  const [servings, setServings] = useState(household && household !== base ? household : base);
  const [tab, setTab] = useState<'ingredients' | 'steps'>('ingredients');
  const factor = servings / base;
  const inList = !!list?.recipeIds?.includes(recipe.id);
  const video = (recipe.segments?.length || 0) >= 2;
  const more = useRef<HTMLButtonElement>(null);
  const [from, setFrom] = useState<Origin>(null);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const categories = useCategories(uid);
  const [catView, setCatView] = useState<'list' | 'new' | null>(null);
  const inCats = (categories || []).filter((c) => c.recipeIds.includes(recipe.id));
  const photoInput = useRef<HTMLInputElement>(null);
  const ownPhoto = async (file?: File) => {
    if (!file) return;
    setMenu(false);
    setCoverBusy(true);
    try { await setRecipePhoto(uid, recipe.id, await uploadPhoto(uid, file)); toast('Photo updated', 'check'); }
    catch (e: any) { toast(e.message || 'Could not upload the photo', 'close'); }
    setCoverBusy(false);
  };
  const getCover = async () => {
    setCoverBusy(true);
    try { await refreshCover(recipe.id); toast('New cover from the video', 'check'); setMenu(false); }
    catch (e: any) { toast(e.message || 'Could not get the cover', 'close'); }
    setCoverBusy(false);
  };

  useEffect(() => { used('recipe.open'); }, [recipe.id]);

  // Ricette dall'app iOS con link TikTok corto: il video lo ricava il backend, una volta sola.
  useEffect(() => {
    if (!recipe.embed && recipe.sourceUrl && /tiktok/i.test(recipe.sourceUrl)) resolveEmbed(recipe.id).catch(() => {});
  }, [recipe.id, recipe.embed]);

  const toggleList = async () => {
    navigator.vibrate?.(8);
    if (inList && list) {
      await editList(uid, (l) => ({ ...l, ...removeRecipeFromList(l, recipe.id) }));
      toast('Removed from groceries', 'cart');
    } else {
      const scaled = { ...recipe, ingredients: recipe.ingredients.map((g) => ({ ...g, quantity: scaleQuantity(g.quantity, factor) })) };
      await editList(uid, (l) => ({ ...l, ...mergeIntoList(l, [scaled]) }));
      used('list.add');
      toast(`${recipe.ingredients.length} items added to groceries`, 'cart');
    }
  };

  const meta = [
    minutes(recipe.cookMinutes),
    `${recipe.ingredients.length} ingredients`,
    video ? `${recipe.segments!.length} video steps` : `${recipe.steps.length} steps`,
  ].filter(Boolean);

  return (
    <main className="recipe">
      <div className="recipe__media" style={{ viewTransitionName: `img-${recipe.id}` } as React.CSSProperties}>
        {recipe.imageUrl ? <img src={recipe.imageUrl} alt="" /> : <span className="shimmer card__ph" />}
        {!recipe.imageUrl && (
          <button className={`btn btn--soft recipe__cover-btn ${coverBusy ? 'is-busy' : ''}`} onClick={() => (recipe.sourceUrl ? getCover() : photoInput.current?.click())}>
            <Icon name={recipe.sourceUrl ? 'refresh' : 'camera'} size={17} /> {recipe.sourceUrl ? 'Get the cover from the video' : 'Add a photo'}
          </button>
        )}
        {coverBusy && recipe.imageUrl && <span className="recipe__busy"><span className="spinner" /></span>}
        <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => { ownPhoto(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <header className="recipe__bar">
        <button className="bar__btn bar__btn--float" onClick={() => ((history.state as any)?.from === 'library' ? history.back() : navigate('/', { replace: true }))} aria-label="Back"><Icon name="back" /></button>
        <div className="bar__actions">
          <button className="bar__btn bar__btn--float" onClick={() => setFavorite(uid, recipe.id, !recipe.favorite)}
            aria-label={recipe.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={!!recipe.favorite}>
            <motion.span key={String(!!recipe.favorite)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }}
              style={{ display: 'grid', color: recipe.favorite ? 'var(--cherry)' : undefined }}>
              <Icon name="heart" fill={recipe.favorite ? 'currentColor' : 'none'} />
            </motion.span>
          </button>
          <button ref={more} className="bar__btn bar__btn--float" onClick={() => { setFrom(originOf(more.current)); setMenu(true); }} aria-label="More"><Icon name="dots" /></button>
        </div>
      </header>

      <section className="recipe__body">
        {recipe.cuisine && <p className="recipe__kicker">{recipe.cuisine}</p>}
        <h1 className="recipe__title">{recipe.title}</h1>
        <p className="recipe__meta">{meta.join('  ·  ')}</p>

        <div className="rseg" role="tablist">
          {(['ingredients', 'steps'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
              {tab === t && <motion.span layoutId="seg-on" className="rseg__bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span>{t === 'ingredients' ? 'Ingredients' : 'Steps'}</span>
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {tab === 'ingredients' ? (
            <motion.div key="i" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
              <div className="servings">
                <span>Servings</span>
                <div className="stepper">
                  <button onClick={() => setServings((s) => Math.max(1, s - 1))} aria-label="Fewer servings" disabled={servings <= 1}><Icon name="minus" size={16} stroke={2.6} /></button>
                  <motion.b key={servings} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>{servings}</motion.b>
                  <button onClick={() => setServings((s) => Math.min(20, s + 1))} aria-label="More servings"><Icon name="plus" size={16} stroke={2.6} /></button>
                </div>
              </div>
              <ul className="ingredients">
                {recipe.ingredients.map((g, i) => (
                  <li key={i}><span>{g.name}</span><em>{scaleQuantity(g.quantity, factor)}</em></li>
                ))}
              </ul>
            </motion.div>
          ) : (
            <motion.ol key="s" className="method" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.18 }}>
              {recipe.steps.map((s, i) => <li key={i}><span>{i + 1}</span><p>{s}</p></li>)}
            </motion.ol>
          )}
        </AnimatePresence>
      </section>

      <div className="recipe__cta">
        <button className={`cart-btn ${inList ? 'is-on' : ''}`} onClick={toggleList} aria-pressed={inList}
          aria-label={inList ? 'Remove from groceries' : 'Add ingredients to groceries'}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={String(inList)} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 26 }} style={{ display: 'grid' }}>
              <Icon name={inList ? 'check' : 'cart'} size={21} stroke={inList ? 2.8 : 2.2} />
            </motion.span>
          </AnimatePresence>
          <span className="cart-btn__label">{inList ? 'On list' : 'Groceries'}</span>
        </button>
        <button className="btn btn--cherry btn--lg recipe__go" onClick={() => navigate(`/cook/${recipe.id}?s=${servings}`, { state: { from: 'recipe' } })}>
          <Icon name="play" size={16} fill="currentColor" stroke={0} /> Start cooking
        </button>
      </div>

      <Sheet open={catView !== null} onClose={() => setCatView(null)} from={from} label="Categories">
        {catView === 'new' ? (
          <CategoryForm onSave={async (name, emoji) => {
            const id = await saveCategory(uid, { name, emoji, recipeIds: [recipe.id] });
            used('folder.use');
            if (categories?.some((c) => c.id === id)) await setInCategory(uid, id, recipe.id, true);
            setCatView('list');
            toast(`Added to ${name}`, 'check');
          }} />
        ) : (
          <CategoryChooser categories={categories || []} recipeId={recipe.id} onNew={() => setCatView('new')}
            onToggle={(cid, on) => { used('folder.use'); setInCategory(uid, cid, recipe.id, on).catch((e) => toast(e.message, 'close')); }} />
        )}
      </Sheet>
      <Sheet open={menu} onClose={() => { setMenu(false); setConfirm(false); }} from={from} label="Recipe options">
        {!confirm ? (
          <div className="menu">
            {recipe.sourceUrl && (
              <a className="menu__row" href={recipe.sourceUrl} target="_blank" rel="noopener" onClick={() => setMenu(false)}>
                <Icon name="external" size={19} /> Open the original on {recipe.platform === 'instagram' || /instagr/i.test(recipe.sourceUrl) ? 'Instagram' : 'TikTok'}
              </a>
            )}
            <button className="menu__row" onClick={() => { setMenu(false); setCatView('list'); }}>
              <Icon name="flag" size={19} /> {inCats.length ? `In ${inCats.map((c) => c.name).join(', ')}` : 'Add to a category'}
            </button>
            <button className="menu__row" onClick={() => { setMenu(false); navigate(`/r/${recipe.id}/edit`); }}>
              <Icon name="pencil" size={19} /> Edit recipe
            </button>
            <button className="menu__row" onClick={() => photoInput.current?.click()}>
              <Icon name="camera" size={19} /> Use my own photo
            </button>
            {recipe.sourceUrl && (
              <button className={`menu__row ${coverBusy ? 'is-busy' : ''}`} onClick={getCover} disabled={coverBusy}>
                <Icon name="refresh" size={19} /> {coverBusy ? 'Getting the cover…' : 'Get the cover again'}
              </button>
            )}
            <button className="menu__row" onClick={() => { setMenu(false); toggleList(); }}>
              <Icon name="cart" size={19} /> {inList ? 'Remove from groceries' : 'Add to groceries'}
            </button>
            <button className="menu__row menu__row--danger" onClick={() => setConfirm(true)}><Icon name="trash" size={19} /> Delete recipe</button>
          </div>
        ) : (
          <div className="menu">
            <p className="menu__ask">Delete “{recipe.title}”? This can’t be undone.</p>
            <button className="btn btn--danger btn--block" onClick={async () => {
              if (inList && list) await editList(uid, (l) => ({ ...l, ...removeRecipeFromList(l, recipe.id) }));
              await deleteRecipe(uid, recipe.id);
              setMenu(false);
              toast('Recipe deleted', 'trash');
              navigate('/');
            }}>Delete</button>
            <button className="btn btn--ghost btn--block" onClick={() => setConfirm(false)}>Keep it</button>
          </div>
        )}
      </Sheet>
    </main>
  );
}
