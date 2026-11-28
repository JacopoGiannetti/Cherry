// I fotogrammi degli step per i reel di Instagram. Instagram non lascia
// comandare il suo player (niente loop sullo step), quindi al posto del
// video ogni step mostra 1–4 immagini prese dal video: prima, durante, dopo.
//
// 1. Gemini guarda il video (ridotto, inline) e per ogni step indica i momenti.
// 2. Per ogni momento si guardano i fotogrammi di un secondo intorno e si
//    tiene il più nitido (filtro blurdetect di ffmpeg).
// 3. Gemini riguarda le immagini scelte e scarta quelle col creatore che
//    parla, i doppioni e quelle che non c'entrano con lo step.
// 4. Le buone si salvano su Storage: { step, frames: [{ url, caption }] }.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const axios = require('axios');
const { generateJSON } = require('../services/gemini');
const { saveImage } = require('../services/storage');
const { toSeconds, fromMss, repairSegments, clock } = require('./timecode');

let FFMPEG = 'ffmpeg';
try { FFMPEG = require('ffmpeg-static') || 'ffmpeg'; } catch { /* quello di sistema */ }

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_INLINE_BYTES = 17 * 1024 * 1024;
const MAX_PER_STEP = 4;
const WINDOW = 1.0; // secondi guardati intorno a ogni momento

function run(args, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', ...args]);
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; if (err.length > 2e6) err = err.slice(-1e6); });
    p.on('error', reject);
    p.on('close', (code) => {
      const stdout = Buffer.concat(out);
      if (code !== 0 && !binary) return resolve({ code, stdout: stdout.toString(), stderr: err });
      if (code !== 0) return reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`));
      resolve({ code, stdout: binary ? stdout : stdout.toString(), stderr: err });
    });
  });
}

async function duration(file) {
  const { stderr } = await run(['-i', file]);
  const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function download(url, file) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer', timeout: 180000, maxContentLength: MAX_VIDEO_BYTES,
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
  });
  const type = String(r.headers['content-type'] || '');
  if (!type.startsWith('video/') && !type.includes('octet-stream')) throw new Error(`non è un video: ${type}`);
  await fs.writeFile(file, Buffer.from(r.data));
}

/** Una copia piccola per Gemini: basta per capire i momenti, sta nella richiesta. */
async function small(file, out) {
  for (const [w, kbps] of [[360, 450], [270, 250]]) {
    await run(['-y', '-loglevel', 'error', '-i', file, '-vf', `scale=${w}:-2`, '-r', '15', '-b:v', `${kbps}k`, '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '32k', out]);
    const { size } = await fs.stat(out);
    if (size <= MAX_INLINE_BYTES) return fs.readFile(out);
  }
  return null;
}

const momentsSchema = {
  type: 'OBJECT',
  properties: {
    steps: { type: 'ARRAY', items: {
      type: 'OBJECT',
      properties: {
        step: { type: 'INTEGER' },
        moments: { type: 'ARRAY', items: {
          type: 'OBJECT',
          // Stringa MM:SS.s: come numero, oltre il minuto, Gemini scriveva 226 per 2:26.
          properties: { t: { type: 'STRING', description: 'Timestamp as MM:SS.s, e.g. "01:27.5"' }, caption: { type: 'STRING' } },
          required: ['t', 'caption'],
        } },
      },
      required: ['step', 'moments'],
    } },
  },
  required: ['steps'],
};

function momentsPrompt(recipe, seconds) {
  const windows = new Map();
  for (const s of recipe.segments || []) for (const i of s.steps || []) windows.set(i, s);
  const steps = (recipe.steps || []).map((text, i) => {
    const w = windows.get(i);
    return `${i}. ${text}${w ? `  (shown around ${clock(w.start)}–${clock(w.end)})` : ''}`;
  }).join('\n');
  return `You are picking still frames from a recipe video to illustrate each written step in a cooking app.
The video is ${clock(seconds)} long (${seconds.toFixed(0)} seconds). Write every timestamp as MM:SS.s (e.g. "01:27.5"), between 00:00 and ${clock(Math.max(0, seconds - 1))}.
The recipe "${recipe.title}" has these steps (0-based index; the time hints are approximate):
${steps}

For each step pick 1 to ${MAX_PER_STEP} moments (timestamp as MM:SS.s) whose frame best shows what to do or what it should look like.
- If the step has several visible stages, give them in order: e.g. before → during → after (what it looks like when done).
- One moment is fine for a simple step. Never pad with near-duplicate frames: consecutive moments must look clearly different.
- Each frame must be a steady, clear shot of the food, the pan or the hands working: no motion blur, no cut or transition, not mid camera move.
- Never pick a shot where the creator's face or upper body talking to camera fills the frame, nor frames dominated by on-screen text or logos.
- If a step is not shown in the video at all, return an empty moments list for it.
- caption: 2 to 5 words describing exactly what is visible (e.g. "Onions golden, not burnt").
Return every step index.`;
}

/** Il fotogramma più nitido nel secondo intorno a t. */
async function sharpest(file, t, seconds) {
  const from = Math.max(0, Math.min(t - WINDOW / 2, seconds - WINDOW));
  const { stdout } = await run(['-ss', from.toFixed(2), '-t', String(WINDOW), '-i', file,
    '-vf', 'scale=360:-2,blurdetect,metadata=print:file=-', '-an', '-f', 'null', '-']);
  let best = null; let at = null;
  for (const line of stdout.split('\n')) {
    const pts = line.match(/pts_time:([\d.]+)/);
    if (pts) { at = Number(pts[1]); continue; }
    const blur = line.match(/lavfi\.blur=([\d.]+)/);
    if (blur && at !== null && (!best || Number(blur[1]) < best.blur)) best = { blur: Number(blur[1]), t: from + at };
  }
  const when = best ? best.t : t;
  const { stdout: jpg } = await run(['-ss', when.toFixed(3), '-i', file, '-frames:v', '1',
    '-vf', 'scale=540:-2', '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], { binary: true });
  return jpg.length > 1000 ? { t: when, jpg } : null;
}

const reviewSchema = {
  type: 'OBJECT',
  properties: {
    frames: { type: 'ARRAY', items: {
      type: 'OBJECT',
      properties: {
        id: { type: 'INTEGER' },
        keep: { type: 'BOOLEAN' },
        caption: { type: 'STRING' },
      },
      required: ['id', 'keep', 'caption'],
    } },
  },
  required: ['frames'],
};

/** Secondo sguardo: via i fotogrammi brutti, doppi o fuori tema. */
async function review(recipe, picks) {
  const parts = [];
  const lines = [];
  picks.forEach((p, id) => {
    lines.push(`Frame ${id}: step ${p.step} ("${recipe.steps[p.step]}"), proposed caption "${p.caption}"`);
    parts.push({ text: `Frame ${id}:` }, { inlineData: { mimeType: 'image/jpeg', data: p.jpg.toString('base64') } });
  });
  const prompt = `These frames were cut from a recipe video to illustrate the steps of "${recipe.title}" in a cooking app.
${lines.join('\n')}

For every frame decide keep true/false. Drop a frame when:
- the creator's face or body talking to camera is the main subject;
- it is blurry, dark, mid-transition, or mostly covered by on-screen text;
- it does not show what its step describes;
- it looks almost the same as the previous kept frame of the same step.
Keep frames that clearly show an action or the state of the food for that step.
caption: 2 to 5 words describing exactly what this frame shows (fix the proposed one if wrong).
Return every frame id.`;
  const out = await generateJSON({ prompt, schema: reviewSchema, parts, temperature: 0.1, label: 'step-frames-review', thinkingLevel: 'LOW' });
  const verdict = new Map((out.frames || []).map((f) => [f.id, f]));
  return picks.map((p, id) => ({ ...p, keep: verdict.get(id)?.keep !== false, caption: (verdict.get(id)?.caption || p.caption).slice(0, 60) }));
}

/**
 * videoUrl: il file del reel. key: cartella su Storage (una per ricetta).
 * Ritorna { frames: [{ step, frames: [{ url, caption }] }] | null, segments: gli spezzoni
 * coi tempi corretti se erano sbagliati, altrimenti null }.
 */
async function buildStepFrames({ videoUrl, recipe, key }) {
  const t0 = Date.now();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frames-'));
  const file = path.join(dir, 'v.mp4');
  try {
    await download(videoUrl, file);
    const seconds = await duration(file);
    if (!seconds) throw new Error('durata del video non letta');
    const lite = await small(file, path.join(dir, 's.mp4'));
    if (!lite) throw new Error('video troppo lungo per Gemini inline');

    const nSteps = (recipe.steps || []).length;
    // Spezzoni salvati coi tempi incollati (ricette di prima): si rimettono in secondi veri.
    const segments = repairSegments(recipe.segments, seconds);
    if (segments) recipe = { ...recipe, segments };
    const asked = await generateJSON({
      prompt: momentsPrompt(recipe, seconds), schema: momentsSchema, temperature: 0.2,
      parts: [{ inlineData: { mimeType: 'video/mp4', data: lite.toString('base64') } }],
      label: 'step-frames', thinkingLevel: 'LOW',
    });

    const wanted = [];
    for (const s of asked.steps || []) {
      if (!Number.isInteger(s.step) || s.step < 0 || s.step >= nSteps) continue;
      let last = -10;
      for (const m of (s.moments || []).slice(0, MAX_PER_STEP)) {
        let t = toSeconds(m.t);
        if (Number.isFinite(t) && t > seconds && fromMss(t) <= seconds && t % 100 < 60) t = fromMss(t);
        if (!Number.isFinite(t) || t < 0 || t > seconds - 0.2 || t - last < 0.8) continue;
        last = t;
        wanted.push({ step: s.step, caption: String(m.caption || '').trim(), t });
      }
    }
    // Tre ffmpeg alla volta: su Render uno per volta faceva aspettare più di un minuto.
    const shots = new Array(wanted.length);
    let next = 0;
    await Promise.all([0, 1, 2].map(async () => {
      while (next < wanted.length) {
        const n = next++;
        shots[n] = await sharpest(file, wanted[n].t, seconds).catch(() => null);
      }
    }));
    const picks = wanted.map((w, n) => shots[n] && { step: w.step, caption: w.caption, ...shots[n] }).filter(Boolean);
    if (!picks.length) return { frames: null, segments };

    const checked = await review(recipe, picks).catch((e) => {
      console.warn(`[frames] revisione saltata: ${e.message}`);
      return picks.map((p) => ({ ...p, keep: true }));
    });

    const byStep = new Map();
    for (const p of checked.filter((x) => x.keep)) {
      const list = byStep.get(p.step) || [];
      if (list.length >= MAX_PER_STEP) continue;
      list.push(p);
      byStep.set(p.step, list);
    }
    await Promise.all([...byStep.values()].flat().map(async (p, n) => {
      p.url = await saveImage(p.jpg, `stepFrames/${key}/${p.step}-${n}-${crypto.randomUUID().slice(0, 8)}.jpg`);
    }));
    for (const [step, list] of byStep) byStep.set(step, list.map((p) => ({ url: p.url, caption: p.caption })));
    const result = [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([step, frames]) => ({ step, frames }));
    console.log(`[frames] ${key}: ${picks.length} scelti, ${checked.filter((x) => x.keep).length} tenuti, ${result.length}/${nSteps} step, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return { frames: result.length ? result : null, segments };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { buildStepFrames };
