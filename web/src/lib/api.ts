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
export const startCheckout = (plan: 'yearly' | 'monthly', meta?: Record<string, unknown>, fid?: string) => api<{ url: string }>('/checkout', { plan, meta, fid });
export const sendRegistrationEvent = (meta: Record<string, unknown>, eventId: string) => api<{ sent: boolean }>('/meta/registration', { meta, eventId, url: location.href }).catch(() => null);
export const confirmCheckout = (session: string) => api<{ entitled: boolean; value?: number; currency?: string; plan?: string }>('/checkout/confirm', { session });
export const openPortal = () => api<{ url: string }>('/portal', {});
export const saveProfile = (profile: Record<string, unknown>) => api('/profile', profile);
export const deleteAccount = () => api('/account/delete', {});

import type { Recipe } from './types';
export const startPreview = (url: string) => api<{ id: string }>('/preview', { url });
export const getPreview = (id: string) => api<{ status: 'running' | 'done' | 'error'; stage: string; recipe: Recipe | null; error: string | null }>(`/preview/${id}`);
export const embedFor = (url: string) => api<{ embed: import('./types').Embed; platform: string }>('/embed', { url });
export const refreshCover = (id: string) => api<{ imageUrl: string }>(`/recipes/${id}/cover`, {});
export const resolveEmbed = (id: string) => api<{ embed: import('./types').Embed | null }>(`/recipes/${id}/embed`, {});

/**
 * Il file del video di un reel Instagram, da riprodurre in un <video> nostro (salto e loop).
 * 1) la funzione del sito, che legge la pagina embed pubblica (gratis);
 * 2) per le ricette salvate, il backend (stesso servizio dell'import).
 */
export async function instagramVideo(shortcode: string, recipeId?: string, fresh = false): Promise<string | null> {
  const site = import.meta.env.DEV ? 'https://hellocherry.app' : '';
  try {
    const r = await fetch(`${site}/api/ig/${encodeURIComponent(shortcode)}${fresh ? '?fresh=1' : ''}`);
    if (r.ok) { const d = await r.json(); if (d.url) return d.url; }
  } catch { /* si prova il backend */ }
  if (!recipeId || recipeId === 'preview' || !auth.currentUser) return null;
  try { return (await api<{ url: string }>(`/recipes/${recipeId}/video${fresh ? '?fresh=1' : ''}`)).url || null; } catch { return null; }
}
