// Le rotte di Distribution. Montate sotto /api/distribution dalla
// dashboard, quindi già dietro IAP: non c'è un secondo livello di auth
// perché non c'è una seconda porta.
const express = require('express');
const fsp = require('fs/promises');
const crypto = require('crypto');

const store = require('./store');
const media = require('./media');
const nodes = require('./nodes');
const models = require('./models');
const promptCatalog = require('./prompts');
const textStyle = require('./text-style');
const engine = require('./engine');

const router = express.Router();

// I video arrivano interi nel corpo della richiesta. Niente multipart e
// niente dipendenze nuove: il nome e il tipo viaggiano nella query, i byte
// sono il corpo. Per clip verticali da pochi secondi è più che sufficiente.
const MAX_UPLOAD = parseInt(process.env.DISTRIBUTION_MAX_UPLOAD_MB || '', 10) || 300;

const ACCEPTED = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
]);

/** Ogni rotta async passa di qui, così un errore diventa una risposta e non un processo morto. */
const guard = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((error) => {
    const status = error.status || 500;
    if (status >= 500) console.error('[distribution]', error);
    res.status(status).json({ error: error.message || 'errore' });
  });
};

// ---------------------------------------------------------------------
// Cataloghi
// ---------------------------------------------------------------------

let ffmpegOk = null;

/** Le capacità di ffmpeg: si controllano una volta e si ricordano. */
async function ffmpeg() {
  if (ffmpegOk === null) ffmpegOk = await media.capabilities();
  return ffmpegOk;
}

router.get('/catalog', guard(async (req, res) => {
  // Se ffmpeg manca, o c'è ma non sa stampare testo, è meglio dirlo
  // sulla tela, spento e visibile, che scoprirlo a run avviata.
  const ff = await ffmpeg();
  res.json({
    nodes: nodes.catalog(),
    models: models.catalog(),
    ...promptCatalog.catalog(),
    textStyles: textStyle.catalog(),
    maxVariants: nodes.MAX_VARIANTS,
    ffmpeg: ff.ffmpeg,
    drawtext: ff.drawtext,
    ffmpegNote: ff.note,
    maxUploadMb: MAX_UPLOAD,
  });
}));

// ---------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------

router.get('/storage', guard(async (req, res) => {
  const [folders, assets] = await Promise.all([store.listFolders(), store.listAssets()]);
  res.json({ root: store.ROOT, folders, assets });
}));

router.post('/folder', express.json(), guard(async (req, res) => {
  res.json(await store.createFolder(req.body || {}));
}));

router.patch('/folder/:id', express.json(), guard(async (req, res) => {
  const { name, parentId } = req.body || {};
  if (name !== undefined) await store.renameFolder(req.params.id, name);
  if (parentId !== undefined) await store.moveFolder(req.params.id, parentId);
  res.json({ ok: true });
}));

router.delete('/folder/:id', guard(async (req, res) => {
  res.json(await store.deleteFolder(req.params.id));
}));

router.post(
  '/upload',
  express.raw({ type: '*/*', limit: `${MAX_UPLOAD}mb` }),
  guard(async (req, res) => {
    const buffer = req.body;
    if (!buffer || !buffer.length) throw Object.assign(new Error('Corpo vuoto'), { status: 400 });

    const contentType = String(req.query.contentType || req.get('content-type') || '').split(';')[0];
    if (!ACCEPTED.has(contentType)) {
      throw Object.assign(new Error(`Tipo non supportato: ${contentType || 'sconosciuto'}`), { status: 400 });
    }

    const name = String(req.query.name || 'senza nome').slice(0, 120);
    const folderId = req.query.folderId || null;

    // Si scrive su disco per poterlo sondare e per ricavarne la
    // miniatura: ffmpeg lavora su file, non su buffer.
    const work = await media.workspace(`up-${crypto.randomUUID().slice(0, 8)}`);
    try {
      const ext = store.extFor(contentType, name);
      const file = work.file(`in.${ext}`);
      await fsp.writeFile(file, buffer);

      const info = await media.probe(file);
      let thumbFile = work.file('thumb.jpg');
      try {
        await media.thumbnail(file, thumbFile, {
          at: info.kind === 'video' ? Math.min(0.5, (info.duration || 1) / 2) : 0,
        });
      } catch {
        thumbFile = null;
      }

      const asset = await store.putAsset({
        buffer,
        name,
        contentType,
        folderId,
        meta: { width: info.width, height: info.height, duration: info.duration, fps: info.fps, hasAudio: info.hasAudio },
        origin: { kind: 'upload' },
        thumbFile,
      });
      res.json(asset);
    } finally {
      await work.cleanup();
    }
  })
);

router.patch('/asset/:id', express.json(), guard(async (req, res) => {
  res.json(await store.updateAsset(req.params.id, req.body || {}));
}));

router.delete('/asset/:id', guard(async (req, res) => {
  res.json(await store.deleteAsset(req.params.id));
}));

/** I byte, per l'anteprima nel browser. Lo streaming evita di tenere un video in RAM. */
router.get('/asset/:id/file', guard(async (req, res) => {
  const asset = await store.getAsset(req.params.id);
  if (!asset) throw Object.assign(new Error('non trovato'), { status: 404 });
  const thumb = req.query.thumb === '1' && asset.thumbPath;
  res.setHeader('Content-Type', thumb ? 'image/jpeg' : asset.contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  store
    .stream(asset, { thumb })
    .on('error', (e) => {
      console.error('[distribution] stream:', e.message);
      if (!res.headersSent) res.status(404).end();
      else res.end();
    })
    .pipe(res);
}));

// ---------------------------------------------------------------------
// Anteprima delle didascalie
// ---------------------------------------------------------------------

/**
 * Rende un fotogramma con la didascalia sopra, senza toccare la run.
 *
 * Serve a tarare gli stili: si guarda il risultato accanto a uno
 * screenshot vero e si aggiustano i numeri finché non coincidono. È anche
 * l'anteprima che il nodo Testo mostra mentre scrivi.
 */
router.post('/caption/preview', express.json(), guard(async (req, res) => {
  const { assetId, style, background, text, y, scale } = req.body || {};
  const work = await media.workspace(`cap-${crypto.randomUUID().slice(0, 8)}`);
  try {
    let frame = work.file('frame.jpg');
    let width = media.TARGET.width;
    let height = media.TARGET.height;

    if (assetId) {
      const asset = await store.getAsset(assetId);
      if (!asset) throw Object.assign(new Error('contenuto non trovato'), { status: 404 });
      const source = work.file(`src.${store.extFor(asset.contentType, asset.name)}`);
      await store.download(asset, source);
      const info = await media.probe(source);
      width = info.width || width;
      height = info.height || height;
      await media.extractFrame(source, frame, { at: info.kind === 'video' ? Math.min(0.3, info.duration / 2) : 0 });
    } else {
      // Senza sorgente si disegna su un grigio medio: fa vedere il font,
      // la misura e la posizione, che è quello che si sta tarando.
      frame = work.file('frame.png');
      await media.solidFrame(frame, { width, height });
    }

    const layout = textStyle.layout({
      styleId: style,
      background,
      text: text || ' ',
      width,
      height,
      y: y === null || y === undefined ? undefined : Number(y),
      scale: Number(scale) || 1,
    });

    const out = work.file('out.jpg');
    await media.burnCaption(frame, out, {
      layout,
      info: { kind: 'image', width, height, hasAudio: false },
      workDir: work.dir,
    });

    const buffer = await fsp.readFile(out);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Caption-Lines', String(layout.lines.length));
    res.setHeader('X-Caption-Font-Size', String(layout.fontSize));
    res.setHeader('X-Caption-Safe', `${layout.safe.top}-${layout.safe.bottom}`);
    res.send(buffer);
  } finally {
    await work.cleanup();
  }
}));

// ---------------------------------------------------------------------
// Flussi
// ---------------------------------------------------------------------

router.get('/flows', guard(async (req, res) => {
  res.json({ flows: await store.listFlows(), runs: await store.listRuns() });
}));

router.get('/flow/:id', guard(async (req, res) => {
  const flow = await store.getFlow(req.params.id);
  if (!flow) throw Object.assign(new Error('non trovato'), { status: 404 });
  res.json(flow);
}));

router.post('/flow', express.json({ limit: '2mb' }), guard(async (req, res) => {
  res.json(await store.saveFlow(req.body || {}));
}));

router.delete('/flow/:id', guard(async (req, res) => {
  res.json(await store.deleteFlow(req.params.id));
}));

// ---------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------

router.post('/estimate', express.json({ limit: '2mb' }), guard(async (req, res) => {
  const graph = (req.body || {}).graph || { nodes: [], edges: [] };
  const problems = engine.validate(graph);

  // Un flusso con un nodo Testo su un ffmpeg senza freetype è una run
  // che muore a metà, dopo aver già pagato le varianti. Si dice prima.
  if ((graph.nodes || []).some((n) => n.type === 'text') && !(await ffmpeg()).drawtext) {
    problems.push('Testo: questo ffmpeg non sa stampare scritte (manca drawtext)');
  }

  let budget = null;
  try {
    budget = await engine.estimate(graph);
  } catch (e) {
    problems.push(e.message);
  }
  res.json({ problems, ...(budget || { usd: 0, nodes: [], outputs: {} }) });
}));

router.post('/run', express.json({ limit: '2mb' }), guard(async (req, res) => {
  const { graph, flowId, name } = req.body || {};
  res.json(await engine.start({ graph: graph || { nodes: [], edges: [] }, flowId, name }));
}));

router.get('/run/:id', guard(async (req, res) => {
  const run = await store.getRun(req.params.id);
  if (!run) throw Object.assign(new Error('non trovata'), { status: 404 });
  res.json(run);
}));

router.post('/run/:id/approve', express.json(), guard(async (req, res) => {
  const { nodeId, accepted } = req.body || {};
  res.json(await engine.approve(req.params.id, nodeId, accepted || []));
}));

router.post('/run/:id/cancel', guard(async (req, res) => {
  res.json(engine.cancel(req.params.id));
}));

module.exports = router;
