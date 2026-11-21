import { useLocation } from 'wouter';
import { Icon } from '../../components/Icon';
import { AddRecipe } from '../../components/AddRecipe';

/** Pagina per la condivisione da Android (share_target) e i link ?u=…: lo stesso contenuto del pannello. */
export function Add() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(location.search);
  const incoming = params.get('u') || params.get('url') || params.get('text') || '';
  return (
    <main className="page">
      <header className="bar">
        <button className="bar__btn" onClick={() => navigate('/')} aria-label="Back"><Icon name="back" /></button>
      </header>
      <AddRecipe autoLink={incoming || undefined} />
    </main>
  );
}
