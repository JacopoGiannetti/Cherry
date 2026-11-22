// Meta Conversions API: il pagamento confermato da Stripe arriva a Meta dal
// server, anche se il browser ha un blocco pubblicità o chiude la pagina.
// Solo per chi ha accettato i cookie (lo dice il metadata della Checkout
// Session) e solo per pagamenti veri (livemode), a meno di un codice di test.
// L'event_id è l'id della Checkout Session: lo stesso dell'evento del browser,
// così Meta lo conta una volta sola.
const crypto = require('crypto');
const axios = require('axios');

const PIXEL_ID = process.env.META_PIXEL_ID || '';
const TOKEN = process.env.META_CAPI_TOKEN || '';
const TEST_CODE = process.env.META_TEST_EVENT_CODE || '';
const VERSION = process.env.META_GRAPH_VERSION || 'v23.0';

const sha = (v) => (v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined);

function enabled() { return !!(PIXEL_ID && TOKEN); }

/** Da tenere nella Checkout Session: cosa serve dopo per abbinare l'acquisto all'annuncio. */
function checkoutMetadata(meta, req) {
  if (!meta || meta.consent !== true) return {};
  const ip = String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
  const out = { meta_consent: '1', meta_ip: ip.slice(0, 60), meta_ua: String(req.get('user-agent') || '').slice(0, 480) };
  if (typeof meta.fbp === 'string') out.meta_fbp = meta.fbp.slice(0, 200);
  if (typeof meta.fbc === 'string') out.meta_fbc = meta.fbc.slice(0, 400);
  return out;
}

/** checkout.session.completed → Purchase + Subscribe. Non blocca mai il webhook. */
async function sendPurchase(session, { uid, plan, appUrl }) {
  try {
    if (!enabled()) return;
    const md = session.metadata || {};
    if (md.meta_consent !== '1') return;
    if (!session.livemode && !TEST_CODE) return;
    const value = (session.amount_total || 0) / 100;
    const currency = String(session.currency || 'usd').toUpperCase();
    const userData = {
      em: session.customer_details?.email ? [sha(session.customer_details.email)] : undefined,
      external_id: uid ? [sha(uid)] : undefined,
      country: session.customer_details?.address?.country ? [sha(session.customer_details.address.country)] : undefined,
      zp: session.customer_details?.address?.postal_code ? [sha(session.customer_details.address.postal_code)] : undefined,
      fbp: md.meta_fbp || undefined,
      fbc: md.meta_fbc || undefined,
      client_ip_address: md.meta_ip || undefined,
      client_user_agent: md.meta_ua || undefined,
    };
    const base = {
      event_time: session.created || Math.floor(Date.now() / 1000),
      event_id: session.id,
      action_source: 'website',
      event_source_url: `${appUrl}/app/welcome`,
      user_data: userData,
    };
    const custom = { value, currency, content_name: `Cherry ${plan || ''}`.trim() };
    const body = {
      data: [
        { ...base, event_name: 'Purchase', custom_data: custom },
        { ...base, event_name: 'Subscribe', custom_data: { ...custom, predicted_ltv: value } },
      ],
      ...(TEST_CODE ? { test_event_code: TEST_CODE } : {}),
    };
    const r = await axios.post(`https://graph.facebook.com/${VERSION}/${PIXEL_ID}/events`, body, { params: { access_token: TOKEN }, timeout: 10000 });
    console.log(`[meta] acquisto inviato (${session.id}): ${r.data?.events_received || 0} eventi`);
  } catch (e) {
    console.warn('[meta] conversions api:', e.response?.data?.error?.message || e.message);
  }
}

module.exports = { checkoutMetadata, sendPurchase, enabled };
