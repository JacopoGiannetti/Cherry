// Lettura di una ricetta da una pagina web qualsiasi (non TikTok/Instagram).
// Prima si cerca il markup schema.org/Recipe, che quasi tutti i siti di
// cucina espongono: è deterministico e gratis. Se non c'è, si ripiega sul
// testo visibile della pagina, che poi Gemini trascrive.
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');

const FETCH_TIMEOUT_MS = 20000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_CHARS = 12000;

class WebRecipeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.userMessage = message;
  }
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

/** Controllo sincrono, per i redirect: lì non c'è tempo per il DNS. */
function isBlockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (net.isIP(host) && isPrivateAddress(host)) return true;
  return false;
}

/** Il backend non deve poter essere usato per bussare alla rete interna. */
async function assertPublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch {
    throw new WebRecipeError('bad_url', "That doesn't look like a valid link.");
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebRecipeError('bad_url', 'Only web links are supported.');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new WebRecipeError('blocked_host', "We can't read that link.");
  }
  let addresses;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw new WebRecipeError('unreachable', "We couldn't reach that site.");
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new WebRecipeError('blocked_host', "We can't read that link.");
  }
  return parsed.toString();
}

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html, property) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`,
    'i'
  );
  const match = html.match(pattern);
  if (match) return decodeEntities(match[1]);
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`,
    'i'
  );
  const alt = html.match(reversed);
  return alt ? decodeEntities(alt[1]) : null;
}

function flattenGraph(parsed) {
  if (Array.isArray(parsed)) return parsed.flatMap(flattenGraph);
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed['@graph'])) return parsed['@graph'].flatMap(flattenGraph);
    return [parsed];
  }
  return [];
}

function isRecipeNode(node) {
  const type = node && node['@type'];
  if (!type) return false;
  return Array.isArray(type) ? type.includes('Recipe') : type === 'Recipe';
}

/** Il blocco schema.org, se c'è: la trascrizione parte già pulita. */
function findStructuredRecipe(html) {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const json = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    let parsed;
    try {
      parsed = JSON.parse(json.trim());
    } catch {
      continue;
    }
    const recipe = flattenGraph(parsed).find(isRecipeNode);
    if (recipe) return recipe;
  }
  return null;
}

function structuredToText(node) {
  const lines = [];
  if (node.name) lines.push(`Title: ${node.name}`);
  if (node.recipeYield) lines.push(`Yield: ${[].concat(node.recipeYield).join(', ')}`);
  if (node.totalTime) lines.push(`Total time: ${node.totalTime}`);
  const ingredients = [].concat(node.recipeIngredient || []);
  if (ingredients.length) lines.push(`Ingredients:\n- ${ingredients.join('\n- ')}`);

  const steps = [].concat(node.recipeInstructions || [])
    .flatMap((step) => {
      if (typeof step === 'string') return [step];
      if (step && step.text) return [step.text];
      if (step && Array.isArray(step.itemListElement)) {
        return step.itemListElement.map((s) => (typeof s === 'string' ? s : s.text)).filter(Boolean);
      }
      return [];
    })
    .map(stripTags)
    .filter(Boolean);
  if (steps.length) lines.push(`Steps:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);

  return lines.join('\n');
}

/**
 * Ritorna { text, title, thumbnail, structured } dove text è materiale
 * pronto per la trascrizione.
 */
async function fetchWebRecipe(url) {
  const safeUrl = await assertPublicUrl(url);

  let html;
  try {
    const response = await axios.get(safeUrl, {
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_HTML_BYTES,
      maxBodyLength: MAX_HTML_BYTES,
      maxRedirects: 3,
      beforeRedirect: (options) => {
        if (isBlockedHostname(options.hostname || options.host)) {
          throw new WebRecipeError('blocked_host', "We can't read that link.");
        }
      },
      responseType: 'text',
      headers: {
        // Senza uno user agent da browser molti siti rispondono 403.
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    html = String(response.data || '');
  } catch (e) {
    if (e instanceof WebRecipeError) throw e;
    throw new WebRecipeError('fetch_failed', "We couldn't open that link. Is the page public?");
  }

  const structured = findStructuredRecipe(html);
  const title = (structured && structured.name) || metaContent(html, 'og:title') || null;
  const thumbnail =
    (structured && (typeof structured.image === 'string' ? structured.image : structured.image?.url)) ||
    metaContent(html, 'og:image') ||
    null;

  const text = structured ? structuredToText(structured) : stripTags(html).slice(0, MAX_TEXT_CHARS);
  if (text.trim().length < 80) {
    throw new WebRecipeError('no_recipe', "We couldn't find a recipe on that page.");
  }

  return { text, title, thumbnail, structured: Boolean(structured) };
}

module.exports = { fetchWebRecipe, WebRecipeError };
