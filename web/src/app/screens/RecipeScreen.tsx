import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'wouter';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { deleteRecipe, saveList, setFavorite, useList, useRecipe, useSession } from '../../lib/store';
import { importRecipe, resolveEmbed } from '../../lib/api';
import { mergeIntoList, minutes, removeRecipeFromList, scaleQuantity } from '../../lib/kitchen';
import type { Recipe } from '../../lib/types';

export function RecipeScreen({ id }: { id: string }) {
  const { user, doc } = useSession();
  const recipe = useRecipe(user?.uid, id);
  const [, navigate] = useLocation();

  if (recipe === undefined) return <div className="boot"><span className="spinner" /></div>;
  if (recipe === null) {
    return (
      <main className="screen empty">
        <h2 className="display">Recipe not found</h2>
        <p>It may have been deleted.</p>
        <button className="btn btn--ink" onClick={() => navigate('/')}>Back to cookbook</button>
      </main>
    );
  }
  if (recipe.status === 'importing') return <Importing recipe={recipe} onBack={() => navigate('/')} />;
  if (recipe.status === 'failed') return <Failed recipe={recipe} uid={user!.uid} />;
  const household = Number(doc?.webProfile?.household) || 0;
  return <Ready recipe={recipe} uid={user!.uid} household={household} />;
}

function Importing({ recipe, onBack }: { recipe: Recipe; onBack: () => void }) {
  const stages = [
    { id: 'reading', label: 'Opening the post' },
    { id: 'watching', label: 'Watching the whole video' },
    { id: 'writing', label: 'Writing every step' },
  ];
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const current = recipe.importStage === 'watching' ? (tick > 14 ? 2 : 1) : 0;
  const tips = [
    'Each step will loop its exact moment of the video.',
    'Tip: cook mode keeps your screen awake.',
    'Ingredients come with amounts, even when the video skips them.',
    'Add recipes to your grocery list with one tap.',
  ];
  return (
    <main className="screen import-screen">
      <div className="topbar"><button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button><span /></div>
      <p className="eyebrow">Usually under a minute</p>
      <h1 className="display">Cherry is <em>watching</em> your video.</h1>
      <div className="watch">
        <div className="stamp watch__stamp">
          <svg viewBox="0 0 100 100" aria-hidden="true"><defs><path id="circ2" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" /></defs>
            <text fontSize="9.2" fontWeight="700" letterSpacing="2.2"><textPath href="#circ2">WATCHING · WRITING · MATCHING · </textPath></text></svg>
          <b>{tick}s</b>
        </div>
        <ul className="watch__list">
          {stages.map((s, i) => (
            <li key={s.id} className={i < current ? 'done' : i === current ? 'now' : ''}>
              <span>{i < current ? <Icon name="check" size={13} stroke={3.2} /> : String(i + 1)}</span>
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      <AnimatePresence mode="wait">
        <motion.p key={Math.floor(tick / 5) % tips.length} className="import-tip" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
          {tips[Math.floor(tick / 5) % tips.length]}
        </motion.p>
      </AnimatePresence>
    </main>
  );
}

function Failed({ recipe, uid }: { recipe: Recipe; uid: string }) {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  return (
    <main className="screen empty">
      <h2 className="display">We couldn't <em>read</em> this one.</h2>
      <p>{recipe.error || 'Something went wrong.'}</p>
      <div style={{ display: 'grid', gap: 10, maxWidth: 320, margin: '0 auto' }}>
        {recipe.sourceUrl && (
          <button className="btn btn--cherry" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await importRecipe(recipe.sourceUrl!); } catch (e: any) { toast(e.message, 'close'); }
            setBusy(false);
          }}>Try again</button>
        )}
        <button className="btn btn--ghost" onClick={async () => { await deleteRecipe(uid, recipe.id); navigate('/'); }}>Remove it</button>
      </div>
    </main>
  );
}

function Ready({ recipe, uid, household }: { recipe: Recipe; uid: string; household: number }) {
  const [, navigate] = useLocation();
  const list = useList(uid);
  const base = recipe.servings || 2;
  const [servings, setServings] = useState(household && household !== base ? household : base);
  const factor = servings / base;
  const inList = !!list?.recipeIds?.includes(recipe.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasVideo = (recipe.segments?.length || 0) >= 2;

  // Ricette dall'app iOS con link TikTok corto: il video lo ricava il backend, una volta sola.
  useEffect(() => {
    if (!recipe.embed && recipe.sourceUrl && /tiktok/i.test(recipe.sourceUrl)) resolveEmbed(recipe.id).catch(() => {});
  }, [recipe.id, recipe.embed]);

  const toggleList = async () => {
    navigator.vibrate?.(10);
    if (inList && list) {
      await saveList(uid, removeRecipeFromList(list, recipe.id));
      toast('Removed from your list', 'cart');
    } else {
      const scaled = { ...recipe, ingredients: recipe.ingredients.map((g) => ({ ...g, quantity: scaleQuantity(g.quantity, factor) })) };
      await saveList(uid, mergeIntoList(list || null, [scaled]));
      toast('Added to your grocery list', 'cart');
    }
  };

  return (
    <main className="recipe">
      <div className="recipe__hero" style={{ viewTransitionName: `r-${recipe.id}` } as React.CSSProperties}>
        {recipe.imageUrl && <img src={recipe.imageUrl} alt="" />}
        <div className="recipe__nav">
          <button className="icon-btn" onClick={() => navigate('/')} aria-label="Back"><Icon name="back" /></button>
          <button className="icon-btn" onClick={() => setFavorite(uid, recipe.id, !recipe.favorite)} aria-label={recipe.favorite ? 'Remove from favorites' : 'Add to favorites'}
            style={{ color: recipe.favorite ? 'var(--cherry)' : undefined }}>
            <Icon name="heart" fill={recipe.favorite ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="recipe__head">
          <h1 className="display">{recipe.title}</h1>
          <div className="recipe__chips">
            {minutes(recipe.cookMinutes) && <span className="chip"><Icon name="clock" size={15} /> {minutes(recipe.cookMinutes)}</span>}
            {recipe.cuisine && <span className="chip">{recipe.cuisine}</span>}
            {hasVideo && <span className="chip"><Icon name="play" size={12} fill="currentColor" /> {recipe.segments!.length} video steps</span>}
          </div>
        </div>
      </div>

      <div className="recipe__cta">
        <motion.button className="btn btn--cherry btn--block" onClick={() => navigate(`/cook/${recipe.id}?s=${servings}`)} whileTap={{ scale: 0.97 }}>
          <Icon name="flame" /> Start cooking
        </motion.button>
      </div>

      <div className="recipe__body">
        <section className="block">
          <div className="block__head">
            <h2 className="display">Ingredients</h2>
            <div className="stepper" aria-label="Servings">
              <button onClick={() => setServings((s) => Math.max(1, s - 1))} aria-label="Fewer servings">−</button>
              <span><Icon name="people" size={15} /> {servings}</span>
              <button onClick={() => setServings((s) => Math.min(20, s + 1))} aria-label="More servings">+</button>
            </div>
          </div>
          <ul className="ings">
            {recipe.ingredients.map((g, i) => (
              <li key={i} className="ing">
                <span className="ing__emoji">{g.emoji || '•'}</span>
                <span className="ing__name">{g.name}</span>
                <span className="ing__qty">{scaleQuantity(g.quantity, factor)}</span>
              </li>
            ))}
          </ul>
          <button className={`btn btn--block ${inList ? 'is-done' : 'btn--ink'}`} style={{ marginTop: 14 }} onClick={toggleList}>
            <Icon name={inList ? 'check' : 'cart'} /> {inList ? 'On your grocery list' : 'Add to grocery list'}
          </button>
        </section>

        <section className="block">
          <div className="block__head"><h2 className="display">Steps</h2><span className="muted">{recipe.steps.length}</span></div>
          <ol className="steps">
            {recipe.steps.map((s, i) => (
              <li key={i} className="step"><span className="step__n">{i + 1}</span><p>{s}</p></li>
            ))}
          </ol>
        </section>

        {recipe.sourceUrl && (
          <a className="source-link" href={recipe.sourceUrl} target="_blank" rel="noopener">
            <Icon name="external" size={17} /> Original on {recipe.platform === 'instagram' ? 'Instagram' : 'TikTok'}
          </a>
        )}
        {!confirmDelete ? (
          <button className="source-link danger" style={{ width: '100%' }} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={17} /> Delete recipe</button>
        ) : (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', paddingBottom: 20 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button className="btn btn--ink btn--sm" onClick={async () => {
              if (inList && list) await saveList(uid, removeRecipeFromList(list, recipe.id));
              await deleteRecipe(uid, recipe.id);
              toast('Recipe deleted', 'trash');
              navigate('/');
            }}>Delete for good</button>
          </div>
        )}
      </div>
    </main>
  );
}
