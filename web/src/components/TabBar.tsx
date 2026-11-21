import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useLocation } from 'wouter';
import { Icon } from './Icon';
import { Sheet, originOf, type Origin } from './Sheet';
import { AddRecipe } from './AddRecipe';
import { useList, useSession } from '../lib/store';

// Due posti e un'azione. L'indicatore scivola da una voce all'altra;
// il + apre il pannello per aggiungere una ricetta, che sale da lui.

export function TabBar() {
  const [location] = useLocation();
  const { user } = useSession();
  const list = useList(user?.uid);
  const left = list?.items.filter((i) => !i.checked).length || 0;
  const plus = useRef<HTMLButtonElement>(null);
  const [from, setFrom] = useState<Origin>(null);
  const [open, setOpen] = useState(false);

  const tab = (href: string, icon: string, label: string, badge?: number) => {
    const active = href === '/' ? location === '/' : location.startsWith(href);
    return (
      <Link href={href} className={`tab ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
        {active && <motion.span layoutId="tab-pill" className="tab__pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
        <span className="tab__icon"><Icon name={icon} size={21} stroke={active ? 2.4 : 2} />{badge ? <b className="tab__badge">{badge}</b> : null}</span>
        <span className="tab__label">{label}</span>
      </Link>
    );
  };

  return (
    <>
      <nav className="tabbar" aria-label="Main">
        {tab('/', 'book', 'Cookbook')}
        <button ref={plus} className="tabbar__add" aria-label="Add a recipe"
          onClick={() => { setFrom(originOf(plus.current)); setOpen(true); navigator.vibrate?.(8); }}>
          <Icon name="plus" size={24} stroke={2.6} />
        </button>
        {tab('/list', 'cart', 'Groceries', left)}
      </nav>
      <Sheet open={open} onClose={() => setOpen(false)} from={from} label="Add a recipe">
        <AddRecipe onDone={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
