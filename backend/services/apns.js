// Push per le Live Activity (ActivityKit).
//
// Serve solo a una cosa: quando una persona spunta il latte, la Live
// Activity dell'altra deve cambiare anche a telefono bloccato. Le app
// in background non possono aggiornarsi da sole, quindi passa da APNs.
//
// Niente librerie: JWT ES256 firmato con crypto nativo e HTTP/2 nativo.
// La chiave .p8 si scarica una volta dal portale Apple Developer
// (Keys → Apple Push Notification service) e non scade.
const http2 = require('http2');
const crypto = require('crypto');
const { keys } = require('../config/keys');

const HOST_PROD = 'https://api.push.apple.com';
const HOST_DEV = 'https://api.sandbox.push.apple.com';
// I token JWT per APNs valgono un'ora; Apple rifiuta chi li rigenera
// troppo spesso, quindi si tiene quello corrente per 50 minuti.
const TOKEN_TTL_MS = 50 * 60 * 1000;

let cachedToken = null;
let cachedAt = 0;
const sessions = new Map();

// iOS ordina gli aggiornamenti di una Live Activity per `timestamp`, e il
// campo è in SECONDI: due spunte nello stesso secondo arrivano con lo
// stesso valore e il sistema è libero di applicarle come gli pare — è
// così che sulla lock screen resta appesa la mossa più vecchia. Si tiene
// l'ultimo valore usato per token e non si torna mai indietro.
const lastTimestamp = new Map();

function nextTimestamp(token) {
  const now = Math.floor(Date.now() / 1000);
  const previous = lastTimestamp.get(token) || 0;
  const value = now > previous ? now : previous + 1;
  // I token cambiano a ogni Live Activity: senza potatura la mappa
  // crescerebbe per tutta la vita del processo.
  if (lastTimestamp.size > 5000) lastTimestamp.clear();
  lastTimestamp.set(token, value);
  return value;
}

function isConfigured() {
  return Boolean(keys.apns.privateKey && keys.apns.keyId && keys.apns.teamId);
}

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function authToken() {
  const now = Date.now();
  if (cachedToken && now - cachedAt < TOKEN_TTL_MS) return cachedToken;

  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keys.apns.keyId }));
  const payload = base64url(JSON.stringify({
    iss: keys.apns.teamId,
    iat: Math.floor(now / 1000),
  }));
  const signature = crypto
    .createSign('SHA256')
    .update(`${header}.${payload}`)
    .sign({ key: keys.apns.privateKey, dsaEncoding: 'ieee-p1363' });

  cachedToken = `${header}.${payload}.${base64url(signature)}`;
  cachedAt = now;
  return cachedToken;
}

function connection(host) {
  const existing = sessions.get(host);
  if (existing && !existing.closed && !existing.destroyed) return existing;
  const session = http2.connect(host);
  session.on('error', (e) => {
    console.warn('[apns] sessione interrotta:', e.message);
    sessions.delete(host);
  });
  session.on('close', () => { sessions.delete(host); });
  sessions.set(host, session);
  return session;
}

function post(host, deviceToken, headers, body) {
  return new Promise((resolve) => {
    let stream;
    try {
      stream = connection(host).request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${authToken()}`,
        'content-type': 'application/json',
        ...headers,
      });
    } catch (e) {
      return resolve({ ok: false, status: 0, reason: e.message });
    }

    let status = 0;
    let raw = '';
    stream.setEncoding('utf8');
    stream.on('response', (h) => { status = h[':status']; });
    stream.on('data', (chunk) => { raw += chunk; });
    stream.on('error', (e) => resolve({ ok: false, status: 0, reason: e.message }));
    stream.on('end', () => {
      let reason = '';
      try {
        reason = raw ? (JSON.parse(raw).reason || '') : '';
      } catch (_) {
        reason = raw;
      }
      resolve({ ok: status === 200, status, reason });
    });
    stream.end(JSON.stringify(body));
  });
}

/**
 * Un token vale per un ambiente solo: quello dell'entitlement con cui
 * l'app è firmata. Invece di indovinare, si parte da quello preferito e
 * al primo "BadDeviceToken" si ritenta sull'altro — così l'app da Xcode
 * e quella da TestFlight funzionano entrambe contro lo stesso server.
 */
async function send(token, aps, priority) {
  const headers = {
    'apns-topic': `${keys.apns.bundleId}.push-type.liveactivity`,
    'apns-push-type': 'liveactivity',
    'apns-priority': priority,
    'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
  };
  const preferred = keys.apns.production ? HOST_PROD : HOST_DEV;
  const fallback = preferred === HOST_PROD ? HOST_DEV : HOST_PROD;

  const first = await post(preferred, token, headers, { aps });
  if (first.ok || first.reason !== 'BadDeviceToken') return first;
  return post(fallback, token, headers, { aps });
}

/**
 * Aggiorna una Live Activity già in corso sul dispositivo indicato.
 *
 * `contentState` deve avere ESATTAMENTE i campi di
 * ShoppingActivityAttributes.ContentState, altrimenti iOS scarta il
 * push in silenzio.
 */
async function updateLiveActivity({ token, contentState, alert, event = 'update' }) {
  if (!isConfigured()) return { ok: false, status: 0, reason: 'apns_not_configured' };
  if (!token) return { ok: false, status: 0, reason: 'missing_token' };

  const aps = {
    timestamp: nextTimestamp(token),
    event,
    'content-state': contentState,
  };
  // L'alert fa comparire una notifica vera e propria accanto alla Live
  // Activity. Vale per gli eventi che meritano un avviso (la spesa che
  // parte), non per ogni singola spunta: con la lista in mano sarebbero
  // trenta banner in cinque minuti.
  if (alert) aps.alert = alert;
  if (event === 'end') aps['dismissal-date'] = Math.floor(Date.now() / 1000);

  // Priorità 10 anche senza alert: la 5 lascia a iOS la libertà di
  // rimandare la consegna per risparmiare batteria, e una lista della
  // spesa che si aggiorna dieci minuti dopo non sincronizza niente.
  // Il budget di sistema regge perché l'app accorpa le spunte prima di
  // chiamare (vedi RunStore.notifyPartner) e dichiara
  // NSSupportsLiveActivitiesFrequentUpdates.
  return send(token, aps, '10');
}

/**
 * Fa NASCERE una Live Activity su un telefono che non ce l'ha ancora
 * ("push to start", iOS 17.2+). È il modo in cui la spesa avviata da
 * una persona compare sulla lock screen dell'altra senza che debba
 * aprire l'app.
 *
 * `attributes` deve corrispondere a ShoppingActivityAttributes e
 * `attributesType` al nome esatto della struct.
 */
async function startLiveActivity({ token, attributes, contentState, alert }) {
  if (!isConfigured()) return { ok: false, status: 0, reason: 'apns_not_configured' };
  if (!token) return { ok: false, status: 0, reason: 'missing_token' };

  const aps = {
    timestamp: nextTimestamp(token),
    event: 'start',
    'attributes-type': 'ShoppingActivityAttributes',
    attributes,
    'content-state': contentState,
  };
  if (alert) aps.alert = alert;

  return send(token, aps, '10');
}

module.exports = { updateLiveActivity, startLiveActivity, isConfigured };
