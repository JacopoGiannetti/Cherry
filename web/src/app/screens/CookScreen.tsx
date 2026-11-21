import { useLocation } from 'wouter';
import { CookMode } from '../../components/CookMode';
import { useRecipe, useSession } from '../../lib/store';

export function CookScreen({ id }: { id: string }) {
  const { user } = useSession();
  const recipe = useRecipe(user?.uid, id);
  const [, navigate] = useLocation();
  const servings = Number(new URLSearchParams(location.search).get('s')) || 0;
  if (recipe === undefined) return <div className="boot"><span className="spinner" /></div>;
  if (!recipe || recipe.status !== 'ready') { navigate(`/r/${id}`); return null; }
  const factor = servings && recipe.servings ? servings / recipe.servings : 1;
  return <CookMode recipe={recipe} factor={factor} onClose={() => navigate(`/r/${id}`)} />;
}
