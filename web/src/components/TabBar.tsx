import { Link, useLocation } from 'wouter';
import { Icon } from './Icon';
import { useList, useSession } from '../lib/store';

export function TabBar() {
  const [location] = useLocation();
  const { user } = useSession();
  const list = useList(user?.uid);
  const left = list?.items.filter((i) => !i.checked).length || 0;
  const tab = (href: string, icon: string, label: string, badge?: number) => (
    <Link href={href} className={`tab ${location === href ? 'active' : ''}`} aria-current={location === href ? 'page' : undefined}>
      <Icon name={icon} stroke={location === href ? 2.5 : 2.1} />
      {badge ? <span className="tab__badge">{badge}</span> : null}
      {label}
    </Link>
  );
  return (
    <nav className="tabbar" aria-label="Main">
      {tab('/', 'book', 'Cookbook')}
      <Link href="/add" className="tab__add" aria-label="Add a recipe"><Icon name="plus" stroke={2.8} /></Link>
      {tab('/list', 'cart', 'Groceries', left)}
    </nav>
  );
}
