// Lo storage: i byte su Firebase Storage, l'ordine su Firestore.
//
// Firebase Storage non ha cartelle. Quelle che sembrano cartelle sono solo
// prefissi nel nome del file, e se ci si appoggia davvero allora spostare
// una cartella vuol dire copiare e ricancellare ogni file che contiene.
// Quindi: i file stanno a un percorso immutabile che nessuno vede mai
// (distribution/assets/{id}.mp4) e l'albero vive su Firestore. Spostare un
// contenuto è aggiornare un campo, rinominare una cartella è un documento.
//
// Su Firestore ci finisce anche la genealogia: da quale sorgente è nato un
// output, con quale prompt e con quale modello. Serve a poter dire, fra un
// mese, "questa variante ha funzionato, rifammene dieci così".
const crypto = require('crypto');
const path = require('path');
const fsp = require('fs/promises');
const { firestore, bucket } = require('../firestore');

const FOLDERS = 'distributionFolders';
const ASSETS = 'distributionAssets';
const FLOWS = 'distributionFlows';
const RUNS = 'distributionRuns';

const ROOT = { id: 'root', name: 'Storage', parentId: null };

// Gli URL firmati che diamo a fal: abbastanza per una generazione lunga,
// non abbastanza da restare in giro.
const SIGNED_TTL_MS = 6 * 60 * 60 * 1000;

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

function extFor(contentType, fallbackName) {
  if (EXT[contentType]) return EXT[contentType];
  const fromName = path.extname(fallbackName || '').replace('.', '').toLowerCase();
  return fromName || 'bin';
}

function kindFor(contentType) {
  if (String(contentType).startsWith('video/')) return 'video';
  if (String(contentType).startsWith('image/')) return 'image';
  return 'other';
}

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------
// Cartelle
// ---------------------------------------------------------------------

async function listFolders() {
  const snap = await firestore().collection(FOLDERS).get();
  const folders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Il percorso leggibile si ricava risalendo i genitori. Si calcola qui e
  // non si salva: salvarlo vorrebbe dire riscrivere tutti i discendenti a
  // ogni rinomina, ed è il genere di cosa che prima o poi va fuori sincrono.
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (folder, seen = new Set()) => {
    if (!folder || seen.has(folder.id)) return [];
    seen.add(folder.id);
    const parent = folder.parentId ? byId.get(folder.parentId) : null;
    return [...pathOf(parent, seen), folder.name];
  };

  return folders
    .map((f) => ({ ...f, path: pathOf(f).join(' / ') }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function createFolder({ name, parentId }) {
  const clean = String(name || '').trim().slice(0, 80) || 'Nuova cartella';
  const parent = parentId && parentId !== ROOT.id ? String(parentId) : null;
  if (parent) {
    const exists = await firestore().collection(FOLDERS).doc(parent).get();
    if (!exists.exists) throw badRequest('La cartella di destinazione non esiste');
  }
  const ref = firestore().collection(FOLDERS).doc();
  await ref.set({ name: clean, parentId: parent, createdAt: now() });
  return { id: ref.id, name: clean, parentId: parent };
}

/**
 * La cartella con questo nome sotto questo genitore, creandola se non
 * c'è. Serve alle run, che si ricavano da sole "Output / Run … / Video":
 * senza questo ogni run creerebbe un altro "Output" accanto al primo.
 */
async function ensureFolder({ name, parentId }) {
  const clean = String(name || '').trim().slice(0, 80);
  const parent = parentId && parentId !== ROOT.id ? String(parentId) : null;
  const snap = await firestore().collection(FOLDERS).where('parentId', '==', parent).get();
  const found = snap.docs.find((d) => (d.data().name || '') === clean);
  if (found) return { id: found.id, ...found.data() };
  return createFolder({ name: clean, parentId: parent });
}

async function renameFolder(id, name) {
  const clean = String(name || '').trim().slice(0, 80);
  if (!clean) throw badRequest('Serve un nome');
  await firestore().collection(FOLDERS).doc(String(id)).set({ name: clean }, { merge: true });
  return { id, name: clean };
}

/** Spostare una cartella è cambiarle il genitore, purché non dentro se stessa. */
async function moveFolder(id, parentId) {
  const target = parentId && parentId !== ROOT.id ? String(parentId) : null;
  if (target === String(id)) throw badRequest('Una cartella non può stare dentro se stessa');

  if (target) {
    const folders = await listFolders();
    const byId = new Map(folders.map((f) => [f.id, f]));
    let cursor = byId.get(target);
    const guard = new Set();
    while (cursor) {
      if (cursor.id === String(id)) throw badRequest('Non puoi spostare una cartella dentro una sua sottocartella');
      if (guard.has(cursor.id)) break;
      guard.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
    }
  }

  await firestore().collection(FOLDERS).doc(String(id)).set({ parentId: target }, { merge: true });
  return { id, parentId: target };
}

/**
 * Cancella una cartella. I contenuti non si perdono: risalgono al genitore.
 * Cancellare in cascata dei file generati che sono costati soldi, con un
 * click e senza cestino, è un modo di perdere il lavoro di una giornata.
 */
async function deleteFolder(id) {
  const store = firestore();
  const ref = store.collection(FOLDERS).doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) return { id, moved: 0 };
  const parentId = (snap.data() || {}).parentId || null;

  const [children, assets] = await Promise.all([
    store.collection(FOLDERS).where('parentId', '==', String(id)).get(),
    store.collection(ASSETS).where('folderId', '==', String(id)).get(),
  ]);

  const batch = store.batch();
  children.docs.forEach((d) => batch.set(d.ref, { parentId }, { merge: true }));
  assets.docs.forEach((d) => batch.set(d.ref, { folderId: parentId }, { merge: true }));
  batch.delete(ref);
  await batch.commit();

  return { id, moved: children.size + assets.size };
}

// ---------------------------------------------------------------------
// Contenuti
// ---------------------------------------------------------------------

async function listAssets({ limit = 500 } = {}) {
  const snap = await firestore().collection(ASSETS).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit);
}

async function getAsset(id) {
  const snap = await firestore().collection(ASSETS).doc(String(id)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Salva dei byte e registra il contenuto.
 *
 * `thumbFile` è facoltativo: senza, la scheda mostra un riquadro vuoto, ma
 * il contenuto è comunque salvato. Vale la pena che una miniatura fallita
 * non faccia fallire l'upload.
 */
async function putAsset({ buffer, file, name, contentType, folderId, meta, origin, thumbFile }) {
  const id = crypto.randomUUID();
  const ext = extFor(contentType, name);
  const storagePath = `distribution/assets/${id}.${ext}`;
  const b = bucket();

  const bytes = buffer || (await fsp.readFile(file));
  await b.file(storagePath).save(bytes, {
    contentType,
    resumable: false,
    metadata: { cacheControl: 'private, max-age=0' },
  });

  let thumbPath = null;
  if (thumbFile) {
    try {
      thumbPath = `distribution/thumbs/${id}.jpg`;
      await b.file(thumbPath).save(await fsp.readFile(thumbFile), {
        contentType: 'image/jpeg',
        resumable: false,
      });
    } catch (e) {
      console.warn('[distribution] miniatura non salvata:', e.message);
      thumbPath = null;
    }
  }

  const doc = {
    name: String(name || `senza nome.${ext}`).slice(0, 120),
    folderId: folderId && folderId !== ROOT.id ? String(folderId) : null,
    kind: kindFor(contentType),
    contentType,
    storagePath,
    thumbPath,
    bytes: bytes.length,
    meta: meta || null,
    // Da dove viene: nodo, run, sorgente, prompt, modello. È quello che
    // permette di rifare una variante riuscita invece di ricominciare.
    origin: origin || { kind: 'upload' },
    createdAt: now(),
  };

  await firestore().collection(ASSETS).doc(id).set(doc);
  return { id, ...doc };
}

async function updateAsset(id, fields) {
  const allowed = {};
  if (fields.name !== undefined) allowed.name = String(fields.name).trim().slice(0, 120);
  if (fields.folderId !== undefined) {
    allowed.folderId = fields.folderId && fields.folderId !== ROOT.id ? String(fields.folderId) : null;
  }
  if (!Object.keys(allowed).length) return getAsset(id);
  await firestore().collection(ASSETS).doc(String(id)).set(allowed, { merge: true });
  return getAsset(id);
}

async function deleteAsset(id) {
  const asset = await getAsset(id);
  if (!asset) return { id, deleted: false };
  const b = bucket();
  // Il documento va via comunque: un file orfano nel bucket costa qualche
  // centesimo, una riga che punta al nulla rompe ogni schermata che la legge.
  await Promise.all([
    b.file(asset.storagePath).delete().catch(() => {}),
    asset.thumbPath ? b.file(asset.thumbPath).delete().catch(() => {}) : Promise.resolve(),
  ]);
  await firestore().collection(ASSETS).doc(String(id)).delete();
  return { id, deleted: true };
}

/** Scarica i byte di un contenuto, per darli a ffmpeg o a Gemini. */
async function download(asset, toFile) {
  const [buffer] = await bucket().file(asset.storagePath).download();
  if (toFile) {
    await fsp.writeFile(toFile, buffer);
    return toFile;
  }
  return buffer;
}

/** Lo stream dei byte, per servire anteprime al browser senza tenerle in memoria. */
function stream(asset, { thumb = false } = {}) {
  const target = thumb && asset.thumbPath ? asset.thumbPath : asset.storagePath;
  return bucket().file(target).createReadStream();
}

// ---------------------------------------------------------------------
// URL pubblici temporanei per fal
// ---------------------------------------------------------------------

// fal deve poter scaricare il file, e la dashboard sta dietro IAP: un URL
// che punta a noi non lo raggiungerebbe mai. Serve quindi un link diretto
// al bucket.
//
// La prima scelta è un URL firmato, che scade da solo. Firmare però
// richiede una chiave privata oppure, con le credenziali del servizio, il
// permesso di farsi firmare i token da soli — ed è il tipo di dettaglio
// IAM che si scopre a run avviata. Se firmare non si può, si ripiega
// sull'oggetto leggibile da chi ne conosce l'URL: sono clip destinate a
// TikTok, non dati di persone.
let canSign = null;

async function publicUrl(asset) {
  const file = bucket().file(asset.storagePath);

  if (canSign !== false) {
    try {
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + SIGNED_TTL_MS,
        version: 'v4',
      });
      canSign = true;
      return url;
    } catch (e) {
      if (canSign === null) {
        console.warn(
          '[distribution] URL firmati non disponibili (%s). Ripiego su oggetti pubblici: ' +
            'per riattivare la firma serve roles/iam.serviceAccountTokenCreator sul service account.',
          e.message
        );
      }
      canSign = false;
    }
  }

  await file.makePublic();
  return `https://storage.googleapis.com/${bucket().name}/${encodeURI(asset.storagePath)}`;
}

// ---------------------------------------------------------------------
// Flussi e run
// ---------------------------------------------------------------------

async function listFlows() {
  const snap = await firestore().collection(FLOWS).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function getFlow(id) {
  const snap = await firestore().collection(FLOWS).doc(String(id)).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function saveFlow({ id, name, graph }) {
  const ref = id ? firestore().collection(FLOWS).doc(String(id)) : firestore().collection(FLOWS).doc();
  const doc = {
    name: String(name || 'Flusso senza nome').slice(0, 80),
    graph: graph || { nodes: [], edges: [] },
    updatedAt: now(),
  };
  await ref.set(doc, { merge: true });
  return { id: ref.id, ...doc };
}

async function deleteFlow(id) {
  await firestore().collection(FLOWS).doc(String(id)).delete();
  return { id, deleted: true };
}

function runRef(id) {
  return firestore().collection(RUNS).doc(String(id));
}

async function createRun(doc) {
  const ref = firestore().collection(RUNS).doc();
  await ref.set({ ...doc, createdAt: now() });
  return ref.id;
}

async function patchRun(id, fields) {
  await runRef(id).set({ ...fields, updatedAt: now() }, { merge: true });
}

async function getRun(id) {
  const snap = await runRef(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function listRuns({ limit = 25 } = {}) {
  const snap = await firestore().collection(RUNS).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit);
}

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

module.exports = {
  ROOT,
  listFolders,
  createFolder,
  ensureFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  listAssets,
  getAsset,
  putAsset,
  updateAsset,
  deleteAsset,
  download,
  stream,
  publicUrl,
  listFlows,
  getFlow,
  saveFlow,
  deleteFlow,
  createRun,
  patchRun,
  getRun,
  listRuns,
  kindFor,
  extFor,
};
