// Cloudflare Pages Function: /api/geo → { country } del visitatore, da Cloudflare.
// Serve al consenso dei cookie: opt-in per UE/SEE, UK e Svizzera, opt-out altrove (es. USA).
// Nessun dato salvato: è solo il paese che Cloudflare ricava dall'IP della richiesta.
export function onRequestGet({ request }) {
  const country = request.cf?.country || request.headers.get('cf-ipcountry') || null;
  return new Response(JSON.stringify({ country: country && country !== 'XX' ? country : null }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });
}
