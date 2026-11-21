import { forwardRef } from 'react';
import { motion } from 'motion/react';
import { Link } from 'wouter';
import type { Recipe } from '../lib/types';
import { minutes } from '../lib/kitchen';
import { Icon } from './Icon';

const STAGE: Record<string, string> = { reading: 'Opening the post', watching: 'Watching the video' };

/** Foto quadrata, nome sotto, una riga di dettagli. La foto è la stessa che diventa la pagina. */
export const RecipeCard = forwardRef<HTMLDivElement, { recipe: Recipe; index?: number }>(function RecipeCard({ recipe, index = 0 }, ref) {
  const importing = recipe.status === 'importing';
  const failed = recipe.status === 'failed';
  const video = (recipe.segments?.length || 0) >= 2;
  const meta = [minutes(recipe.cookMinutes), recipe.cuisine].filter(Boolean).join(' · ');
  return (
    <motion.div ref={ref} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 6) * 0.035, ease: [0.2, 0.8, 0.2, 1] }}>
      <Link href={`/r/${recipe.id}`} className="card">
        <div className="card__img" style={{ viewTransitionName: `img-${recipe.id}` } as React.CSSProperties}>
          {recipe.imageUrl && !importing ? <img src={recipe.imageUrl} alt="" loading="lazy" /> : <span className="shimmer card__ph" />}
          {importing && <span className="card__busy"><span className="spinner" /></span>}
          {!importing && !failed && video && <span className="card__tag"><Icon name="play" size={10} fill="currentColor" stroke={0} />{recipe.segments!.length}</span>}
          {recipe.favorite && <span className="card__fav"><Icon name="heart" size={14} fill="currentColor" stroke={0} /></span>}
        </div>
        <p className="card__title">{importing ? 'New recipe' : failed ? 'Couldn’t read this one' : recipe.title}</p>
        <p className="card__meta">{importing ? STAGE[recipe.importStage || 'reading'] || 'Writing the steps' : failed ? 'Tap to try again' : meta || `${recipe.ingredients.length} ingredients`}</p>
      </Link>
    </motion.div>
  );
});
