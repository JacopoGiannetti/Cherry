// Client della coda di fal.ai.
//
// Le generazioni video durano minuti, quindi non si può tenere aperta una
// richiesta HTTP: si mette il lavoro in coda, si riceve un id e si chiede
// ogni tanto a che punto è. fal offre anche i webhook, ma qui la dashboard
// sta dietro IAP e un webhook da fuori non entrerebbe: il polling è l'unica
// strada che funziona senza aprire una porta.
const axios = require('axios');
const { keys } = require('../../config/keys');

const QUEUE = 'https://queue.fal.run';
const SUBMIT_TIMEOUT_MS = 30000;
const POLL_TIMEOUT_MS = 20000;

// Un video può stare in coda parecchio quando fal è carico. Mezz'ora è la
// soglia oltre la quale è più probabile che sia rotto qualcosa che lento.
const MAX_WAIT_MS = parseInt(process.env.FAL_MAX_WAIT_MS || '', 10) || 30 * 60 * 1000;

// Quanti lavori tenere in volo insieme. fal accetta di più, ma con clip da
// mezzo dollaro l'uno un ciclo impazzito costa in fretta: meglio un tetto
// basso e visibile.
const MAX_CONCURRENCY = parseInt(process.env.FAL_MAX_CONCURRENCY || '', 10) || 4;

let active = 0;
const waiting = [];

function acquire() {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) return next();
  active--;
}

function headers() {
  if (!keys.fal.apiKey) {
    const e = new Error('FAL_KEY mancante: senza chiave non si genera niente');
    e.code = 'fal_key_missing';
    throw e;
  }
  return { Authorization: `Key ${keys.fal.apiKey}` };
}

/** L'errore di fal utile è nel body, non nello status: vale la pena estrarlo. */
function describeError(error) {
  const status = error.response && error.response.status;
  const body = error.response && error.response.data;
  let detail = '';
  if (body) {
    if (typeof body === 'string') detail = body.slice(0, 300);
    else if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail).slice(0, 300);
    else detail = JSON.stringify(body).slice(0, 300);
  }
  const e = new Error(`fal ${status || ''} ${detail || error.message}`.trim());
  e.code = status === 401 || status === 403 ? 'fal_unauthorized' : 'fal_failed';
  e.status = status;
  // 429 e 5xx passano, 422 no: se lo schema è sbagliato riprovare è solo
  // tempo perso che finisce comunque nello stesso errore.
  e.retriable = !status || status === 429 || status >= 500;
  return e;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Mette un lavoro in coda e aspetta il risultato.
 *
 * `onUpdate` viene chiamato a ogni cambio di stato: serve a far muovere la
 * barra del nodo sul canvas invece di lasciarlo fermo per due minuti.
 * `isCancelled` viene interrogato a ogni giro: quando la run viene fermata
 * dall'utente il lavoro su fal viene annullato, così non si paga il resto.
 */
async function run(endpoint, input, { onUpdate, isCancelled, label } = {}) {
  await acquire();
  try {
    const submitted = await submit(endpoint, input);
    if (onUpdate) onUpdate({ phase: 'queued', requestId: submitted.requestId });

    const started = Date.now();
    let delay = 1500;
    let lastPhase = '';

    for (;;) {
      if (isCancelled && isCancelled()) {
        await cancel(submitted).catch(() => {});
        const e = new Error('annullato');
        e.code = 'cancelled';
        throw e;
      }
      if (Date.now() - started > MAX_WAIT_MS) {
        await cancel(submitted).catch(() => {});
        const e = new Error(`${label || endpoint}: nessuna risposta da fal dopo ${Math.round(MAX_WAIT_MS / 60000)} minuti`);
        e.code = 'fal_timeout';
        throw e;
      }

      await sleep(delay);
      // Crescita dolce: i primi secondi si chiede spesso perché le
      // immagini sono pronte quasi subito, poi si rallenta.
      delay = Math.min(delay * 1.4, 10000);

      const state = await status(submitted);
      if (state.status !== lastPhase) {
        lastPhase = state.status;
        if (onUpdate) {
          onUpdate({
            phase: state.status === 'IN_QUEUE' ? 'queued' : 'running',
            queuePosition: state.queue_position,
            requestId: submitted.requestId,
            logs: state.logs,
          });
        }
      }
      if (state.status === 'COMPLETED') break;
      if (state.status === 'FAILED' || state.status === 'ERROR' || state.status === 'CANCELLED') {
        const hint = lastLog(state.logs) || state.error || state.status;
        const e = new Error(`${label || endpoint}: fal ${state.status.toLowerCase()} — ${hint}`);
        e.code = 'fal_failed';
        throw e;
      }
    }

    const result = await fetchResult(submitted);
    if (onUpdate) onUpdate({ phase: 'done', requestId: submitted.requestId });
    return result;
  } finally {
    release();
  }
}

async function submit(endpoint, input) {
  try {
    const res = await axios.post(`${QUEUE}/${endpoint}`, input, {
      headers: { ...headers(), 'Content-Type': 'application/json' },
      timeout: SUBMIT_TIMEOUT_MS,
    });
    const d = res.data || {};
    if (!d.request_id) throw new Error('fal non ha restituito request_id');
    // Gli URL di stato arrivano nella risposta: usarli evita di dover
    // indovinare la radice dell'app, che per endpoint annidati come
    // kling-video/o3/standard/... non coincide con l'endpoint chiamato.
    return {
      requestId: d.request_id,
      statusUrl: d.status_url,
      responseUrl: d.response_url,
      cancelUrl: d.cancel_url,
    };
  } catch (error) {
    throw describeError(error);
  }
}

function lastLog(logs) {
  if (!Array.isArray(logs) || !logs.length) return '';
  const last = logs[logs.length - 1];
  return typeof last === 'string' ? last : last.message || last.msg || '';
}

async function status(job) {
  try {
    const sep = job.statusUrl.includes('?') ? '&' : '?';
    const res = await axios.get(`${job.statusUrl}${sep}logs=1`, { headers: headers(), timeout: POLL_TIMEOUT_MS });
    return res.data || {};
  } catch (error) {
    const e = describeError(error);
    // Una singola interrogazione andata male non è il lavoro andato male:
    // si finge "ancora in corso" e si riprova al giro dopo.
    if (e.retriable) return { status: 'IN_PROGRESS' };
    throw e;
  }
}

async function fetchResult(job) {
  try {
    const res = await axios.get(job.responseUrl, { headers: headers(), timeout: SUBMIT_TIMEOUT_MS });
    return res.data || {};
  } catch (error) {
    throw describeError(error);
  }
}

async function cancel(job) {
  if (!job.cancelUrl) return;
  await axios.put(job.cancelUrl, null, { headers: headers(), timeout: POLL_TIMEOUT_MS });
}

/**
 * Dal risultato all'elenco di file. Ogni modello impacchetta l'uscita a
 * modo suo: immagini in `images`, video in `video`, e qualcuno usa il
 * singolare anche quando ne restituisce più di uno.
 */
function outputs(result) {
  const found = [];
  const push = (entry, kind) => {
    if (!entry) return;
    const url = typeof entry === 'string' ? entry : entry.url;
    if (url) found.push({ url, kind, contentType: entry.content_type || null });
  };

  if (Array.isArray(result.images)) result.images.forEach((i) => push(i, 'image'));
  if (result.image) push(result.image, 'image');
  if (Array.isArray(result.videos)) result.videos.forEach((v) => push(v, 'video'));
  if (result.video) push(result.video, 'video');
  return found;
}

module.exports = { run, outputs, MAX_CONCURRENCY };
