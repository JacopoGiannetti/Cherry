import { useEffect, useState } from 'react';
import { goBack } from '../../lib/nav';
import { useLocation } from 'wouter';
import { CookMode } from '../../components/CookMode';
import { CookDone } from '../../components/CookDone';
import { useRecipe, useSession } from '../../lib/store';
import { used } from '../../lib/usage';
import { askReview } from '../../components/ReviewPrompt';

export function CookScreen({ id }: { id: string }) {
  const { user } = useSession();
  const recipe = useRecipe(user?.uid, id);
  const [, navigate] = useLocation();
  useEffect(() => { used('cook.start'); }, [id]);
  const [finished, setFinished] = useState(false);
  const servings = Number(new URLSearchParams(location.search).get('s')) || 0;
  if (recipe === undefined) return <div className="boot"><span className="spinner" /></div>;
  if (!recipe || recipe.status !== 'ready') { navigate(`/r/${id}`, { replace: true }); return null; }
  const factor = servings && recipe.servings ? servings / recipe.servings : 1;
  const close = () => {
    // Si è arrivati dalla ricetta: si torna indietro, così "indietro" dalla ricetta non riapre la cook mode.
    if ((history.state as any)?.from === 'recipe') goBack();
    else navigate(`/r/${id}`, { replace: true });
  };
  return (
    <>
      <CookMode recipe={recipe} factor={factor} onClose={close} onDone={() => { used('cook.done'); setFinished(true); }} />
      {/* Prima di tornare alla ricetta: due secondi per il piatto finito. Poi, se è il caso, la recensione. */}
      {finished && <CookDone recipe={recipe} onEnd={() => { close(); askReview('cook'); }} />}
    </>
  );
}
