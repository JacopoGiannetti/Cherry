// Cloudflare Pages Function: /__/auth/* e /__/firebase/* passano a Firebase.
// Così il login Google gira sullo stesso dominio del sito (hellocherry.app):
// Safari e le app sulla Home bloccano i dati di siti terzi, e con il login
// su cherry-662ac.firebaseapp.com fallirebbe.
const FIREBASE_HOST = 'cherry-662ac.firebaseapp.com';

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const target = `https://${FIREBASE_HOST}${url.pathname}${url.search}`;
  const headers = new Headers(request.headers);
  headers.set('host', FIREBASE_HOST);
  const init = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
  const res = await fetch(target, init);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
