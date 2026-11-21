// Prezzi pubblici: la landing li legge senza caricare Firebase.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export type Plan = { plan: 'yearly' | 'monthly'; amount: number; currency: string; interval: string | null; trialDays: number };

export async function getPlans(): Promise<{ plans: Plan[] }> {
  const res = await fetch(`${BASE}/v1/plans`);
  if (!res.ok) throw new Error('plans_unavailable');
  return res.json();
}

export function money(amount: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
}
