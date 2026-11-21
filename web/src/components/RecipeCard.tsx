import { motion } from 'motion/react';
import { Link } from 'wouter';
import type { Recipe } from '../lib/types';
import { minutes } from '../lib/kitchen';
import { Icon } from './Icon';

const STAGES: Record<string, string> = {
  reading: 'Opening the post',
  watching: 'Watching the video',
};

export function RecipeCard({ recipe, index = 0 }: { recipe: Recipe; index?: number }) {
  const importing = recipe.status === 'importing';
  const failed = recipe.status === 'failed';
  const steps = recipe.segments?.length || 0;
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.04 }} layout>
      <Link href={`/r/${recipe.id}`} className={`rcard ${importing ? 'rcard--importing' : ''}`} onClick={() => { document.documentElement.dataset.vt = recipe.id; }}>
        <div className="rcard__img" style={{ viewTransitionName: `r-${recipe.id}` } as React.CSSProperties}>
          {recipe.imageUrl ? <img src={recipe.imageUrl} alt="" loading="lazy" /> : <div className="shimmer" style={{ position: 'absolute', inset: 0 }} />}
          {importing && (
            <div className="importing">
              <span className="spinner" style={{ width: 30, height: 30 }} />
              <b>{STAGES[recipe.importStage || 'reading'] || 'Writing your recipe'}</b>
              <small>Usually under a minute</small>
            </div>
          )}
          {failed && (
            <div className="importing">
              <b>Couldn't read this one</b>
              <small>Tap for details</small>
            </div>
          )}
        </div>
        {!importing && !failed && (
          <>
            {steps >= 2 && <span className="rcard__badge"><Icon name="play" size={11} fill="currentColor" /> {steps} steps</span>}
            {recipe.favorite && <span className="rcard__fav"><Icon name="heart" fill="currentColor" size={20} /></span>}
            <div className="rcard__body">
              <div className="rcard__title">{recipe.title}</div>
              <div className="rcard__meta">
                {minutes(recipe.cookMinutes) && <span>{minutes(recipe.cookMinutes)}</span>}
                <span>{recipe.ingredients?.length || 0} ingredients</span>
              </div>
            </div>
          </>
        )}
      </Link>
    </motion.div>
  );
}
