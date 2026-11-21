import { auth } from './firebase';

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const headers: Record<string, string> = {};
  const user = auth.currentUser;
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${BASE}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network', "Can't reach Cherry. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'error', data.message || 'Something went wrong. Try again.');
  return data as T;
}

export { getPlans, money, type Plan } from './plans';
export const importRecipe = (url: string) => api<{ id: string; existing: boolean }>('/import', { url });
export const startCheckout = (plan: 'yearly' | 'monthly') => api<{ url: string }>('/checkout', { plan });
export const confirmCheckout = (session: string) => api<{ entitled: boolean }>('/checkout/confirm', { session });
export const openPortal = () => api<{ url: string }>('/portal', {});
export const saveProfile = (profile: Record<string, unknown>) => api('/profile', profile);
export const deleteAccount = () => api('/account/delete', {});

import type { Recipe } from './types';
export const startPreview = (url: string) => api<{ id: string }>('/preview', { url });
export const getPreview = (id: string) => api<{ status: 'running' | 'done' | 'error'; stage: string; recipe: Recipe | null; error: string | null }>(`/preview/${id}`);
