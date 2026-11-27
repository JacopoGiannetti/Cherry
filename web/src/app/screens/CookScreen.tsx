import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { CookMode } from '../../components/CookMode';
import { useRecipe, useSession } from '../../lib/store';
import { used } from '../../lib/usage';
import { askReview } from '../../components/ReviewPrompt';

export function CookScreen({ id }: { id: string }) {
  const { user } = useSession();
  const recipe = useRecipe(user?.uid, id);
  const [, navigate] = useLocation();
  useEffect(() => { used('cook.start'); }, [id]);
  const servings = Number(new URLSearchParams(location.search).get('s')) || 0;
  if (recipe === undefined) return <div className="boot"><span className="spinner" /></div>;
  if (!recipe || recipe.status !== 'ready') { navigate(`/r/${id}`, { replace: true }); return null; }
  const factor = servings && recipe.servings ? servings / recipe.servings : 1;
  const close = () => {
    // Si è arrivati dalla ricetta: si torna indietro, così "indietro" dalla ricetta non riapre la cook mode.
    if ((history.state as any)?.from === 'recipe') history.back();
    else navigate(`/r/${id}`, { replace: true });
  };
  return <CookMode recipe={recipe} factor={factor} onClose={close} onDone={() => { used('cook.done'); close(); askReview('cook'); }} />;
}
