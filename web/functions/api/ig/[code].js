// Cloudflare Pages Function: /api/ig/<shortcode> → { url, expires }.
// Su iOS la Dynamic view apre la pagina embed di Instagram in una WKWebView e ne
// comanda il <video>. Sul web un iframe di un altro sito non si può comandare:
// qui si legge la stessa pagina embed pubblica e se ne prende il link del file
// video sul CDN di Instagram, che il browser riproduce in un <video> nostro,
// con salto allo spezzone e loop. Il video resta quello di Instagram: nessuna copia.
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAX_CACHE = 6 * 3600;

const json = (body, status, maxAge = 0) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json',
    'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    'access-control-allow-origin': '*',
  },
});

/** Il JSON del post sta dentro una stringa JS, con le barre di escape raddoppiate: si scioglie finché serve. */
export function videoUrlFrom(html) {
  const m = html.match(/video_url\\*":\\*"((?:[^"\\]|\\.)*?)\\*"/);
  let u = m && m[1];
  for (let i = 0; u && u.includes('\\') && i < 3; i++) {
    try { u = JSON.parse(`"${u}"`); } catch { return null; }
  }
  return u && /^https:\/\/[^/]*(cdninstagram\.com|fbcdn\.net)\//.test(u) ? u : null;
}

export async function onRequest({ request, params }) {
  const code = String(params.code || '');
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(code)) return json({ error: 'bad_code' }, 400);
  const fresh = new URL(request.url).searchParams.has('fresh');
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://hellocherry.app/api/ig/${code}`);
  if (cache && !fresh) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  let url = null;
  for (const path of [`reel/${code}/embed/captioned/`, `p/${code}/embed/captioned/`]) {
    const res = await fetch(`https://www.instagram.com/${path}`, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' } }).catch(() => null);
    if (!res || !res.ok) continue;
    url = videoUrlFrom(await res.text());
    if (url) break;
  }
  if (!url) return json({ error: 'no_video' }, 404);

  const oe = (url.match(/[?&]oe=([0-9A-Fa-f]+)/) || [])[1];
  const expires = oe ? parseInt(oe, 16) * 1000 : Date.now() + 12 * 3600 * 1000;
  const ttl = Math.max(60, Math.min(MAX_CACHE, Math.floor((expires - Date.now()) / 1000) - 3600));
  const out = json({ url, expires }, 200, ttl);
  if (cache) await cache.put(key, out.clone());
  return out;
}
