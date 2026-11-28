// Chi ha fatto il video: nome, foto e link al profilo, da mostrare su ogni ricetta
// (piccolo, sotto il titolo) insieme al link al video originale.
// Solo dati pubblici e gratis: la pagina embed di Instagram, il link e l'oEmbed di TikTok.
// La foto si copia su Storage perché i link dei CDN scadono.
const axios = require('axios');
const { persistImage } = require('../services/storage');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const unescape = (s) => String(s || '').replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
const get = (url, ua = UA) => axios.get(url, { timeout: 12000, headers: { 'User-Agent': ua }, validateStatus: (s) => s < 500 }).then((r) => (r.status === 200 ? r.data : null)).catch(() => null);

async function keepAvatar(remote, platform, handle) {
  if (!remote) return null;
  return persistImage(remote, `creators/${platform}-${handle.toLowerCase().replace(/[^a-z0-9._-]/g, '')}.jpg`).catch(() => null);
}

async function instagram(url) {
  const code = (url.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
  if (!code) return null;
  const html = await get(`https://www.instagram.com/reel/${code}/embed/captioned/`);
  if (typeof html !== 'string') return null;
  const handle = (html.match(/class="UsernameText"[^>]*>([^<]+)/) || [])[1]?.trim();
  if (!handle) return null;
  const pic = (html.match(/class="Avatar[^"]*"[^>]*>\s*<img[^>]*src="([^"]+)"/) || html.match(/"profile_pic_url":"([^"]+)"/) || [])[1];
  return {
    platform: 'instagram', handle, name: null,
    profileUrl: `https://www.instagram.com/${handle}/`,
    avatar: await keepAvatar(pic && unescape(pic), 'instagram', handle),
  };
}

async function tiktok(url) {
  const handleIn = (u) => (String(u || '').match(/tiktok\.com\/@([A-Za-z0-9._]+)/) || [])[1] || null;
  let handle = handleIn(url);
  let name = null;
  if (!handle) {
    // Link corti (vm.tiktok.com/…): il nome è nel link completo, dopo il rimando.
    const r = await axios.get(url, { maxRedirects: 5, timeout: 10000, headers: { 'User-Agent': UA }, validateStatus: () => true }).catch(() => null);
    const final = r?.request?.res?.responseUrl || '';
    handle = handleIn(final) || handleIn(decodeURIComponent(final));
    if (handle) url = final.split('?')[0];
  }
  const o = await get(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, DESKTOP);
  if (o && typeof o === 'object') {
    handle = handle || o.author_unique_id || (String(o.author_url || '').match(/@([A-Za-z0-9._]+)/) || [])[1] || null;
    name = o.author_name || null;
  }
  if (!handle) return null;
  // La foto: dalla pagina del profilo, se TikTok la dà a un server. Altrimenti resta l'iniziale.
  const page = await get(`https://www.tiktok.com/@${handle}`, DESKTOP);
  const pic = typeof page === 'string' ? (page.match(/"avatarMedium":"([^"]+)"/) || page.match(/"avatarThumb":"([^"]+)"/) || [])[1] : null;
  return {
    platform: 'tiktok', handle, name: name && name !== handle ? name : null,
    profileUrl: `https://www.tiktok.com/@${handle}`,
    avatar: await keepAvatar(pic && unescape(pic), 'tiktok', handle),
  };
}

/** { platform, handle, name, profileUrl, avatar } oppure null. Non lancia mai. */
async function findCreator(url, platform) {
  try {
    if (platform === 'instagram') return await instagram(url);
    if (platform === 'tiktok') return await tiktok(url);
  } catch (e) {
    console.warn(`[creator] ${url}: ${e.message}`);
  }
  return null;
}

module.exports = { findCreator };
