import { motion } from 'motion/react';
import { Icon, Logo } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { Aisles, Progress, QuickAdd, addItems, setChecked } from '../../components/Groceries';
import { editShared, useSharedList } from '../../lib/store';
import type { GroceryList } from '../../lib/types';

// Chi apre il link: niente login, niente paywall. Vede la lista, la spunta,
// aggiunge quello che manca; chi l'ha mandata vede tutto mentre succede.
// In fondo, una riga su cos'è Cherry: è così che arriva il prossimo utente.

export function SharedList({ id }: { id: string }) {
  const list = useSharedList(id);
  const edit = (fn: (l: GroceryList) => GroceryList) => editShared(id, fn).catch((e) => toast(e.message || 'Could not save', 'close'));
  const who = list?.ownerName ? `${list.ownerName}’s groceries` : 'Groceries';

  if (list === undefined) return <div className="boot"><span className="spinner" /></div>;
  if (list === null) {
    return (
      <main className="page">
        <header className="bar"><a href="/" aria-label="Cherry"><Logo size={28} /></a></header>
        <section className="empty">
          <h2>This list isn’t shared anymore</h2>
          <p>Ask for a new link, or make your own list from the recipes you save.</p>
          <div className="empty__actions"><a className="btn btn--cherry" href="/">Discover Cherry</a></div>
        </section>
      </main>
    );
  }

  return (
    <main className="page page--guest">
      <header className="bar">
        <a href="/" aria-label="Cherry"><Logo size={28} /></a>
        <span className="live-pill"><span className="live-dot" aria-hidden="true" /> Live</span>
      </header>
      <h1 className="guest__title">{who}</h1>
      <p className="guest__lead">Tick things off as you shop. Everyone on this list sees it instantly.</p>

      {!!list.recipes?.length && (
        <section className="guest__recipes" aria-label="Recipes on this list">
          {list.recipes.map((r) => (
            <span key={r.id} className="guest__recipe">
              <span className="guest__img">{r.imageUrl ? <img src={r.imageUrl} alt="" /> : null}</span>
              <span>{r.title}</span>
            </span>
          ))}
        </section>
      )}

      <Progress list={list} />
      <QuickAdd onAdd={(n) => edit(addItems(n))} />
      {list.items.length === 0 && <p className="quiet-note">The list is empty — add the first thing.</p>}
      <Aisles list={list} onToggle={(i) => edit(setChecked(i.id, !i.checked))} />

      <motion.a href="/" className="promo" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <span className="promo__img"><img src="/assets/mascot.png" alt="" /></span>
        <span className="promo__text">
          <b>Made with Cherry</b>
          <span>Save any TikTok or Instagram recipe. Cherry writes the steps and the grocery list for you.</span>
        </span>
        <Icon name="next" size={18} />
      </motion.a>
    </main>
  );
}
