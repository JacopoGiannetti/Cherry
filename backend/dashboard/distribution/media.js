// Tutto quello che si fa senza chiedere niente a un modello.
//
// Vale la pena insistere su un punto: una fetta grossa di "rendi questo
// contenuto diverso" non è un lavoro da AI. Correzione colore, un grado di
// zoom, mezzo punto di velocità, uno specchio, un filo di grana — sono
// operazioni esatte, istantanee e gratis, e cambiano il file in profondità.
// Passarle a un modello diffusion significa pagare mezzo dollaro e
// rischiare che ti rigeneri una faccia per spostare una cintura.
//
// Qui dentro ci sono anche i mattoni che servono agli altri nodi: la sonda,
// l'estrazione del fotogramma per il flusso ad ancora, la concatenazione
// del Merge e la stampa delle didascalie.
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const bins = require('./bins');

// Il formato di riferimento: verticale pieno. Tutto quello che entra nel
// Merge o esce da un nodo video viene ricondotto qui, altrimenti due clip
// con risoluzioni diverse non si concatenano.
const TARGET = { width: 1080, height: 1920, fps: 30 };

// Un'operazione ffmpeg su clip da pochi secondi dura un attimo; se ci mette
// più di questo è appesa.
const RUN_TIMEOUT_MS = parseInt(process.env.FFMPEG_TIMEOUT_MS || '', 10) || 10 * 60 * 1000;

function exec(bin, args, { timeout = RUN_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout.on('data', (d) => {
      out += d;
      // Un ffmpeg che stampa molto è un ffmpeg che sta lavorando male:
      // si tiene solo la coda, che è dove c'è l'errore.
      if (out.length > 200000) out = out.slice(-100000);
    });
    child.stderr.on('data', (d) => {
      err += d;
      if (err.length > 200000) err = err.slice(-100000);
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      if (e.code === 'ENOENT') {
        const missing = new Error(
          `${bin} non trovato. In locale serve installarlo; nel container lo mette il Dockerfile.`
        );
        missing.code = 'ffmpeg_missing';
        return reject(missing);
      }
      reject(e);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        const e = new Error(`${bin} è stato interrotto dopo ${Math.round(timeout / 1000)}s`);
        e.code = 'ffmpeg_timeout';
        return reject(e);
      }
      if (code !== 0) {
        // Le ultime righe di stderr sono l'unica parte leggibile.
        const tail = err.trim().split('\n').slice(-6).join('\n');
        const e = new Error(`${bin} uscito con ${code}:\n${tail}`);
        e.code = 'ffmpeg_failed';
        return reject(e);
      }
      resolve({ stdout: out, stderr: err });
    });
  });
}

async function ff(args, opts) {
  const { ffmpeg } = await bins.resolve();
  return exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], opts);
}

/** Cosa c'è dentro un file: tipo, dimensioni, durata, se ha audio. */
async function probe(file) {
  const { ffprobe } = await bins.resolve();
  const { stdout } = await exec(ffprobe, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ], { timeout: 60000 });

  const data = JSON.parse(stdout);
  const streams = data.streams || [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  if (!video) {
    const e = new Error('Il file non contiene un flusso video o immagine');
    e.code = 'not_media';
    throw e;
  }

  // Un PNG o un JPEG per ffprobe sono un video di un fotogramma: la
  // distinzione utile è "ha una durata" oppure no.
  const still = ['png', 'mjpeg', 'jpeg', 'webp', 'gif', 'bmp'].includes(video.codec_name) && !audio;
  const duration = parseFloat((data.format && data.format.duration) || video.duration || '0') || 0;
  const [num, den] = String(video.r_frame_rate || '30/1').split('/').map(Number);

  return {
    kind: still && duration <= 0.2 ? 'image' : 'video',
    width: video.width || 0,
    height: video.height || 0,
    duration,
    fps: den ? num / den : 30,
    hasAudio: Boolean(audio),
    codec: video.codec_name,
    bytes: parseInt((data.format && data.format.size) || '0', 10) || 0,
  };
}

/** Il fotogramma su cui si lavora nel flusso ad ancora. */
async function extractFrame(input, output, { at = 0 } = {}) {
  await ff(['-ss', String(at), '-i', input, '-frames:v', '1', '-q:v', '2', output]);
  return output;
}

/** Un fotogramma pieno, per provare una didascalia senza avere una sorgente. */
async function solidFrame(output, { width = TARGET.width, height = TARGET.height, colour = '0x6b6b6b' } = {}) {
  await ff(['-f', 'lavfi', '-i', `color=c=${colour}:s=${width}x${height}`, '-frames:v', '1', output]);
  return output;
}

/** Un'anteprima piccola per le schede e per lo storage. */
async function thumbnail(input, output, { at = 0, width = 360 } = {}) {
  await ff([
    '-ss', String(at),
    '-i', input,
    '-frames:v', '1',
    '-vf', `scale=${width}:-2:flags=lanczos`,
    '-q:v', '5',
    output,
  ]);
  return output;
}

// ---------------------------------------------------------------------
// Slight change deterministico
// ---------------------------------------------------------------------

// Le leve disponibili. Ognuna produce una differenza reale nei pixel
// restando invisibile a chi guarda.
const SLIGHT_KNOBS = {
  grade: 'Correzione colore',
  zoom: 'Zoom impercettibile',
  speed: 'Velocità',
  mirror: 'Specchio orizzontale',
  grain: 'Grana',
};

/**
 * Ricetta della variante n-esima. Le varianti devono essere diverse fra
 * loro, quindi i valori non sono casuali: si distribuiscono sull'indice,
 * così la 1 e la 2 non finiscono per caso sullo stesso mezzo punto di
 * saturazione.
 */
function slightRecipe(index, knobs) {
  const on = (k) => !knobs || knobs.includes(k);
  // Si alterna il segno per non andare tutti nella stessa direzione.
  const sign = index % 2 === 0 ? 1 : -1;
  const step = Math.floor(index / 2) + 1;

  return {
    grade: on('grade')
      ? {
          // Scarti piccoli: oltre questi valori si comincia a vedere.
          brightness: +(sign * 0.008 * step).toFixed(4),
          contrast: +(1 + sign * 0.02 * step).toFixed(4),
          saturation: +(1 + sign * 0.03 * step).toFixed(4),
          gamma: +(1 + sign * 0.015 * step).toFixed(4),
        }
      : null,
    // Un ritaglio sotto il 2% non si nota ma sposta ogni pixel. Cresce
    // sull'indice e non sul passo: il segno qui non ha senso (non si può
    // rimpicciolire senza bordi) e con il passo due varianti di fila
    // finirebbero sullo stesso ritaglio.
    zoom: on('zoom') ? +(1 + 0.005 * (index + 1)).toFixed(4) : 1,
    speed: on('speed') ? +(1 + sign * 0.012 * step).toFixed(4) : 1,
    mirror: on('mirror') ? index % 4 === 3 : false,
    grain: on('grain') ? Math.min(6, 2 + step) : 0,
  };
}

function slightFilters(recipe, { width, height }) {
  const chain = [];
  if (recipe.mirror) chain.push('hflip');
  if (recipe.zoom && recipe.zoom !== 1) {
    // Si ingrandisce e si ritaglia al centro: la cornice si stringe di un
    // pelo e la composizione resta quella.
    const w = Math.round(width / recipe.zoom / 2) * 2;
    const h = Math.round(height / recipe.zoom / 2) * 2;
    chain.push(`crop=${w}:${h}:(iw-${w})/2:(ih-${h})/2`, `scale=${width}:${height}:flags=lanczos`);
  }
  if (recipe.grade) {
    const g = recipe.grade;
    chain.push(`eq=brightness=${g.brightness}:contrast=${g.contrast}:saturation=${g.saturation}:gamma=${g.gamma}`);
  }
  if (recipe.grain) chain.push(`noise=alls=${recipe.grain}:allf=t+u`);
  if (recipe.speed && recipe.speed !== 1) chain.push(`setpts=${(1 / recipe.speed).toFixed(6)}*PTS`);
  return chain;
}

/** Applica una ricetta deterministica a un'immagine o a un video. */
async function applySlight(input, output, { recipe, info }) {
  const meta = info || (await probe(input));
  const chain = slightFilters(recipe, { width: meta.width, height: meta.height });
  if (!chain.length) {
    await fsp.copyFile(input, output);
    return output;
  }

  if (meta.kind === 'image') {
    await ff(['-i', input, '-vf', chain.join(','), '-q:v', '2', output]);
    return output;
  }

  const args = ['-i', input, '-vf', chain.join(',')];
  if (meta.hasAudio) {
    // Se il video cambia velocità l'audio deve seguirlo, o si scolla.
    if (recipe.speed && recipe.speed !== 1) args.push('-filter:a', `atempo=${recipe.speed.toFixed(6)}`);
    args.push('-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-an');
  }
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output);
  await ff(args);
  return output;
}

// ---------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------

/**
 * Attacca due o più clip una dopo l'altra.
 *
 * Non si può usare il concat demuxer: pretende sorgenti identiche per
 * codec, risoluzione e frame rate, e due clip prese da due posti diversi
 * non lo sono quasi mai. Si normalizza tutto sul formato di riferimento e
 * si concatena nel filtro, che costa una ricodifica ma non fallisce.
 *
 * Le immagini diventano clip di `stillSeconds` secondi, così si può
 * attaccare una foto in coda a un video.
 */
async function concat(inputs, output, { stillSeconds = 2.5, target = TARGET } = {}) {
  if (!inputs.length) throw new Error('concat senza clip');
  if (inputs.length === 1) {
    await fsp.copyFile(inputs[0].file, output);
    return output;
  }

  const args = [];
  const parts = [];

  inputs.forEach((clip, i) => {
    if (clip.info.kind === 'image') args.push('-loop', '1', '-t', String(stillSeconds), '-i', clip.file);
    else args.push('-i', clip.file);
  });

  inputs.forEach((clip, i) => {
    // scale + pad: si entra dentro il riquadro senza deformare, il resto
    // è nero. Deformare per riempire si vede e fa schifo.
    parts.push(
      `[${i}:v]scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,` +
        `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `setsar=1,fps=${target.fps},format=yuv420p[v${i}]`
    );
    // Ogni segmento deve avere una traccia audio o il concat si disallinea:
    // a chi non ce l'ha si mette del silenzio.
    if (clip.info.hasAudio && clip.info.kind !== 'image') {
      parts.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}]`);
    } else {
      const seconds = clip.info.kind === 'image' ? stillSeconds : clip.info.duration || stillSeconds;
      parts.push(`anullsrc=channel_layout=stereo:sample_rate=48000:d=${seconds.toFixed(3)}[a${i}]`);
    }
  });

  const pairs = inputs.map((_, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${pairs}concat=n=${inputs.length}:v=1:a=1[vout][aout]`);

  args.push(
    '-filter_complex', parts.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    output
  );

  await ff(args);
  return output;
}

// ---------------------------------------------------------------------
// Didascalie
// ---------------------------------------------------------------------

/**
 * Le righe vengono disegnate una per una.
 *
 * drawtext sa centrare il testo, ma con più righe centra il blocco e
 * allinea a sinistra dentro: una didascalia su due righe verrebbe storta.
 * Un drawtext per riga, ognuno centrato con (w-text_w)/2, e il centraggio
 * lo calcola ffmpeg con le sue metriche, che è esattamente quello che
 * vogliamo.
 *
 * Il testo passa da un file e non dal parametro: drawtext ha due livelli di
 * escaping sovrapposti e un apostrofo in una didascalia basta a rompere
 * tutta la catena di filtri.
 */
async function captionFilters(layout, workDir) {
  const chain = [];

  if (layout.bar) {
    const b = layout.bar;
    chain.push(`drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=black@${b.opacity}:t=fill`);
  }

  const fontFile = layout.fontFile.replace(/\\/g, '/').replace(/:/g, '\\:');
  const white = 'white';
  const boxed = layout.background === 'box' || layout.background === 'boxWhite';
  const fill = layout.background === 'boxWhite' ? 'black' : white;

  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i];
    if (!line) continue;

    const file = path.join(workDir, `caption-${i}.txt`);
    await fsp.writeFile(file, line, 'utf8');
    const escaped = file.replace(/\\/g, '/').replace(/:/g, '\\:');

    const opts = [
      `fontfile='${fontFile}'`,
      `textfile='${escaped}'`,
      // Senza questo ffmpeg interpreta %{...} e le graffe dentro al testo.
      'expansion=none',
      `fontsize=${layout.fontSize}`,
      `fontcolor=${fill}`,
      'x=(w-text_w)/2',
      `y=${layout.lineTop(i)}`,
    ];

    if (layout.stroke) opts.push(`borderw=${layout.stroke}`, 'bordercolor=black');
    if (layout.background === 'plain') {
      // Nessun contorno: una sola ombra corta tiene il bianco leggibile
      // sui fondi chiari senza sporcare.
      opts.push('shadowcolor=black@0.45', 'shadowx=0', `shadowy=${Math.max(1, Math.round(layout.fontSize * 0.04))}`);
    }
    if (boxed) {
      const bgColour = layout.background === 'boxWhite' ? 'white@0.92' : 'black@0.55';
      opts.push('box=1', `boxcolor=${bgColour}`, `boxborderw=${layout.boxPad}`);
    }

    chain.push(`drawtext=${opts.join(':')}`);
  }

  return chain;
}

/** Stampa la didascalia dentro il file. */
async function burnCaption(input, output, { layout, info, workDir }) {
  const meta = info || (await probe(input));
  const chain = await captionFilters(layout, workDir);
  if (!chain.length) {
    await fsp.copyFile(input, output);
    return output;
  }

  if (meta.kind === 'image') {
    await ff(['-i', input, '-vf', chain.join(','), '-q:v', '2', output]);
    return output;
  }

  const args = ['-i', input, '-vf', chain.join(',')];
  if (meta.hasAudio) args.push('-c:a', 'copy');
  else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output);
  await ff(args);
  return output;
}

// ---------------------------------------------------------------------

/**
 * Porta un video dentro i limiti di un modello (durata, lato, mp4).
 *
 * Kling rifiuta i file fuori da 3–15s / 720–3840px, ma a volte li accetta
 * in coda e poi resta IN_PROGRESS per dieci minuti. Tagliare qui costa
 * secondi di ffmpeg e evita di pagare un hang.
 */
async function fitVideo(input, output, { info, limits = {} } = {}) {
  const meta = info || (await probe(input));
  const maxS = limits.maxSeconds || 15;
  const minS = limits.minSeconds || 3;
  const minSide = limits.minSide || 720;
  const maxSide = limits.maxSide || 3840;
  const duration = meta.duration || 0;
  const take = duration > 0 ? Math.min(duration, maxS) : maxS;

  const vf = [];
  const w = meta.width || 0;
  const h = meta.height || 0;
  const portrait = h >= w;
  if (w && h && Math.min(w, h) < minSide) {
    vf.push(portrait ? `scale=${minSide}:-2:flags=lanczos` : `scale=-2:${minSide}:flags=lanczos`);
  } else if (w && h && Math.max(w, h) > maxSide) {
    vf.push(portrait ? `scale=-2:${maxSide}:flags=lanczos` : `scale=${maxSide}:-2:flags=lanczos`);
  }
  if (take + 0.05 < minS) {
    vf.push(`tpad=stop_mode=clone:stop_duration=${(minS - take).toFixed(2)}`);
  }

  const args = ['-i', input, '-t', String(Math.max(take, minS))];
  if (vf.length) args.push('-vf', vf.join(','));
  if (meta.hasAudio) args.push('-c:a', 'aac', '-b:a', '128k');
  else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output);
  await ff(args);
  return output;
}

/** Una cartella temporanea per una run, con la pulizia già pronta. */
async function workspace(tag) {
  const dir = path.join(os.tmpdir(), `vego-dist-${tag || crypto.randomUUID().slice(0, 8)}`);
  await fsp.mkdir(dir, { recursive: true });
  return {
    dir,
    file: (name) => path.join(dir, name),
    async cleanup() {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * Ci sono ffmpeg e ffprobe? Se mancano li scarica, poi risponde.
 * Lo si chiede al catalogo, non a run partita.
 */
/**
 * Cosa sa fare l'ffmpeg che ci è toccato.
 *
 * Non basta che esista: le build statiche leggere sono compilate senza
 * freetype, quindi tagliano e concatenano ma non sanno stampare una
 * scritta. Chi chiama deve poterlo dire prima, non scoprirlo a metà run.
 */
async function capabilities() {
  try {
    const { ffmpeg, drawtext, note } = await bins.resolve();
    await exec(ffmpeg, ['-version'], { timeout: 15000 });
    return { ffmpeg: true, drawtext: Boolean(drawtext), note: note || '' };
  } catch (error) {
    return { ffmpeg: false, drawtext: false, note: error.message || '' };
  }
}

module.exports = {
  TARGET,
  SLIGHT_KNOBS,
  probe,
  extractFrame,
  solidFrame,
  thumbnail,
  slightRecipe,
  applySlight,
  concat,
  fitVideo,
  burnCaption,
  workspace,
  capabilities,
  exists: (f) => fs.existsSync(f),
};
