import { useLocation } from 'wouter';
import { CookMode } from '../../components/CookMode';
import { useRecipe, useSession } from '../../lib/store';

export function CookScreen({ id }: { id: string }) {
  const { user } = useSession();
  const recipe = useRecipe(user?.uid, id);
  const [, navigate] = useLocation();
  const servings = Number(new URLSearchParams(location.search).get('s')) || 0;
  if (recipe === undefined) return <div className="boot"><span className="spinner" /></div>;
  if (!recipe || recipe.status !== 'ready') { navigate(`/r/${id}`, { replace: true }); return null; }
  const factor = servings && recipe.servings ? servings / recipe.servings : 1;
  return <CookMode recipe={recipe} factor={factor} onClose={() => {
    // Si è arrivati dalla ricetta: si torna indietro, così "indietro" dalla ricetta non riapre la cook mode.
    if ((history.state as any)?.from === 'recipe') history.back();
    else navigate(`/r/${id}`, { replace: true });
  }} />;
}
