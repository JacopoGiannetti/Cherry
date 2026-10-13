// Dove stanno ffmpeg e ffprobe.
//
// Il Dockerfile li installa con apt, e in locale di solito ci sono già.
// Cloud Run però è stato messo in piedi coi buildpack Node, che un
// pacchetto Debian non lo vedono: la revisione in produzione non ha
// nessuno dei due, e ogni upload muore su ffprobe. Qui, se i binari
// non ci sono, si scaricano una volta sola (release statiche di
// eugeneware, le stesse di `ffmpeg-static`) e si tengono in /tmp.
// Il primo avvio della revisione paga il download; i successivi no.
//
// Resta un ripiego, non la soluzione: la soluzione è distribuire col
// Dockerfile, dove ffmpeg lo installa apt e sta nell'immagine invece
// che nella memoria dell'istanza.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const axios = require('axios');

// Stessa tag da cui `ffmpeg-static` tira i file: ffmpeg e ffprobe stanno
// nello stesso release, con il prefisso nel nome.
const RELEASE = 'b6.1.1';
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`;

// Quella build però è compilata senza freetype, cioè senza `drawtext`:
// probe e tagli funzionano, stampare una scritta no. Per i testi serve
// una build completa, e la si prende dal registro npm — non perché sia
// una dipendenza, ma perché è l'unica fonte che pubblica un ffmpeg con
// freetype in un formato che Node sa aprire da solo: .tgz, cioè gzip
// più tar. Gli archivi .tar.xz degli altri (BtbN, johnvansickle) qui
// non servono a niente, perché il comando `xz` su un'immagine di
// runtime magra può benissimo non esserci.
const FULL_SCOPE = '@ffmpeg-installer';

const ARCH = ({ x64: 'x64', arm64: 'arm64', arm: 'arm', ia32: 'ia32' })[process.arch] || process.arch;
const PLAT = process.platform; // linux | darwin | win32

function cacheDir() {
  return path.join(os.tmpdir(), 'vego-ffbin', RELEASE, `${PLAT}-${ARCH}`);
}

function cached(name) {
  const ext = PLAT === 'win32' ? '.exe' : '';
  return path.join(cacheDir(), name + ext);
}

function asset(name) {
  return `${BASE}/${name}-${PLAT}-${ARCH}.gz`;
}

/** Il pacchetto con la build completa per questa macchina, se esiste. */
function fullBuild() {
  if (!['x64', 'arm64', 'ia32', 'arm'].includes(ARCH)) return null;
  return `${PLAT}-${ARCH}`; // linux-x64, darwin-arm64, …
}

/** Lancia un comando e torna quello che ha scritto, o null se non parte. */
function output(bin, args, timeout = 15000) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, timeout);
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : null);
    });
  });
}

async function runVersion(bin) {
  return (await output(bin, ['-version'], 8000)) !== null;
}

const filters = new Map();

/**
 * Se questo ffmpeg sa fare `drawtext`.
 *
 * Non è una finezza: senza freetype il filtro non esiste proprio, e il
 * nodo Testo muore con "No such filter" a run avviata, dopo che hai già
 * pagato le varianti. Meglio saperlo prima di partire.
 */
async function canDrawText(bin) {
  if (filters.has(bin)) return filters.get(bin);
  const out = await output(bin, ['-hide_banner', '-filters']);
  const ok = Boolean(out && /^\s*\S*\s+drawtext\s/m.test(out));
  filters.set(bin, ok);
  return ok;
}

async function download(name, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const url = asset(name);
  const res = await axios.get(url, {
    responseType: 'stream',
    timeout: 180000,
    maxContentLength: Infinity,
    maxRedirects: 5,
    headers: { 'User-Agent': 'vego-distribution' },
  });
  await pipeline(res.data, zlib.createGunzip(), fs.createWriteStream(tmp));
  await fsp.chmod(tmp, 0o755);
  await fsp.rename(tmp, dest);
  if (!(await runVersion(dest))) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw new Error(`Il ${name} scaricato da ${url} non parte`);
  }
  return dest;
}

/** L'indirizzo dell'ultima versione pubblicata del pacchetto. */
async function fullUrl(pkg) {
  const { data } = await axios.get(`https://registry.npmjs.org/${FULL_SCOPE}%2F${pkg}`, {
    timeout: 30000,
    headers: { Accept: 'application/vnd.npm.install-v1+json', 'User-Agent': 'vego-distribution' },
  });
  const version = ((data || {})['dist-tags'] || {}).latest;
  const url = version && (((data.versions || {})[version] || {}).dist || {}).tarball;
  if (!url) throw new Error(`per ${pkg} non risulta pubblicata nessuna build`);
  return url;
}

/**
 * Tira fuori un file da un tar, senza chiamare `tar`.
 *
 * Il formato è semplice: blocchi da 512 byte, ognuno preceduto da un
 * blocco di intestazione con dentro nome e lunghezza. Si salta di
 * intestazione in intestazione finché non si trova quella giusta, e da
 * lì si copiano i byte del corpo. Bastano trenta righe e si evita di
 * dipendere da un eseguibile che sull'immagine di runtime può mancare.
 */
async function untar(archive, member, dest) {
  const fh = await fsp.open(archive, 'r');
  try {
    const head = Buffer.alloc(512);
    let at = 0;
    for (;;) {
      const { bytesRead } = await fh.read(head, 0, 512, at);
      if (bytesRead < 512) return false;

      const name = head.toString('utf8', 0, 100).replace(/\0.*$/, '');
      if (!name) return false; // blocco di chiusura: l'archivio è finito

      const size = parseInt(head.toString('ascii', 124, 136).replace(/[\0\s]/g, ''), 8) || 0;
      const body = at + 512;
      if (name === member || name.endsWith(`/${member}`)) {
        await pipeline(
          fs.createReadStream(archive, { start: body, end: body + size - 1 }),
          fs.createWriteStream(dest)
        );
        return true;
      }
      at = body + Math.ceil(size / 512) * 512;
    }
  } finally {
    await fh.close();
  }
}

/** Scarica ed estrae la build completa: solo l'eseguibile, non tutto il pacchetto. */
async function downloadFull(dest) {
  const pkg = fullBuild();
  if (!pkg) throw new Error('per questa piattaforma non c’è una build completa da scaricare');

  const dir = path.dirname(dest);
  await fsp.mkdir(dir, { recursive: true });
  const archive = path.join(dir, 'pkg.tar');
  const url = await fullUrl(pkg);

  const res = await axios.get(url, {
    responseType: 'stream',
    timeout: 300000,
    maxContentLength: Infinity,
    maxRedirects: 5,
    headers: { 'User-Agent': 'vego-distribution' },
  });
  // Lo scompattato finisce su disco invece che in memoria: su Cloud Run
  // /tmp è RAM comunque, ma almeno il tar sparisce appena estratto.
  await pipeline(res.data, zlib.createGunzip(), fs.createWriteStream(archive));

  const found = await untar(archive, 'ffmpeg', dest);
  await fsp.rm(archive, { force: true }).catch(() => {});
  if (!found) throw new Error(`dentro ${pkg} non c’è l’eseguibile`);

  await fsp.chmod(dest, 0o755);
  if (!(await runVersion(dest))) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw new Error(`la build completa scaricata da ${url} non parte`);
  }
  return dest;
}

/**
 * Sceglie il binario da usare.
 *
 * `needs` è la capacità richiesta: se il primo che risponde non ce l'ha
 * non lo si scarta subito, si tiene da parte e si continua a cercarne
 * uno migliore. Alla fine, meglio un ffmpeg monco che nessun ffmpeg:
 * tagli e concatenazioni funzionano comunque, si perdono solo i testi.
 */
async function pick(name, { explicit, siblings = [], needs } = {}) {
  // La build completa la si scarica solo per ffmpeg: dell'archivio si
  // estrae quel solo eseguibile, quindi quel percorso non è un ffprobe
  // e non deve finire fra i candidati quando si cerca l'altro.
  const full = name === 'ffmpeg' ? cachedFull() : '';
  const candidates = [explicit, ...siblings, name, cached(name), full].filter(Boolean);
  let spare = null;

  for (const bin of candidates) {
    if (!(await runVersion(bin))) continue;
    if (!needs || (await canDrawText(bin))) return bin;
    spare = spare || bin;
  }

  // Niente di buono in giro: si scarica. Prima la build completa, se
  // serve una capacità che quella leggera non ha.
  const errors = [];
  if (needs && fullBuild()) {
    try {
      const bin = await downloadFull(cachedFull());
      if (await canDrawText(bin)) return bin;
      spare = spare || bin;
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (!spare) {
    try {
      const bin = await download(name, cached(name));
      if (!needs || (await canDrawText(bin))) return bin;
      spare = bin;
    } catch (error) {
      errors.push(error.message);
    }
  }

  // Si ripiega su quello monco, ma perché si è ripiegato va detto: senza
  // il motivo, dalla barra gialla sulla tela non si capisce se il
  // download è andato in timeout, se è caduto o se non è mai partito.
  if (spare) {
    if (errors.length) notes.push(`${name}: ${errors.join(' · ')}`);
    return spare;
  }
  const e = new Error(
    `${name} non è su questa macchina e il download è fallito (${errors.join(' · ')}). ` +
      'In locale: brew install ffmpeg. Su Cloud Run il prossimo avvio riproverà da solo.'
  );
  e.code = 'ffmpeg_missing';
  throw e;
}

function cachedFull() {
  const pkg = fullBuild();
  return pkg ? path.join(os.tmpdir(), 'vego-ffbin', `full-${pkg}`, 'ffmpeg') : '';
}

let pending = null;
const notes = [];

/**
 * Trova (o scarica) i due binari. Una volta risolti, le chiamate
 * successive tornano subito gli stessi percorsi.
 */
async function resolve() {
  if (pending) return pending;
  pending = (async () => {
    const ffmpegEnv = process.env.FFMPEG_PATH || '';
    const probeEnv = process.env.FFPROBE_PATH || '';
    const ffmpegSibling = ffmpegEnv ? path.join(path.dirname(ffmpegEnv), 'ffprobe') : '';

    const ffmpeg = await pick('ffmpeg', { explicit: ffmpegEnv, needs: 'drawtext' });
    const nextToFfmpeg = path.isAbsolute(ffmpeg)
      ? path.join(path.dirname(ffmpeg), PLAT === 'win32' ? 'ffprobe.exe' : 'ffprobe')
      : '';
    // ffprobe legge e basta: qualunque build va bene, anche la leggera.
    const ffprobe = await pick('ffprobe', { explicit: probeEnv, siblings: [ffmpegSibling, nextToFfmpeg] });
    return { ffmpeg, ffprobe, drawtext: await canDrawText(ffmpeg), note: notes.join(' · ') };
  })();

  try {
    return await pending;
  } catch (error) {
    pending = null;
    throw error;
  }
}

module.exports = { resolve, RELEASE };
