// Il motore: prende un grafo e lo esegue.
//
// Due cose lo definiscono.
//
// La prima è che ogni porta trasporta una lista. Un nodo non riceve un
// file, riceve un elenco, e quasi sempre ne restituisce uno più lungo di
// quello che ha ricevuto. L'AI Wizard mappa (n dentro, n×varianti fuori),
// il Merge fa il prodotto (a×b), il resto passa uno a uno. È la
// moltiplicazione il motivo per cui lo strumento esiste.
//
// La seconda è che tutto quello che un modello genera viene salvato subito.
// Un video costa mezzo dollaro e cinque minuti: trattarlo come un file
// temporaneo da buttare se il nodo dopo fallisce non è accettabile. I
// risultati intermedi finiscono nella cartella della run, il nodo Save li
// sposta dove hai deciso.
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');

const store = require('./store');
const media = require('./media');
const models = require('./models');
const prompts = require('./prompts');
const textStyle = require('./text-style');
const nodes = require('./nodes');
const fal = require('./fal');

// Le run vive, per id. Il motore gira dentro il processo della dashboard:
// se il container riparte, le run in corso si perdono. Per uno strumento
// interno usato da una persona è un compromesso accettabile, purché su
// Cloud Run la CPU non venga tolta fra una risposta e l'altra
// (--no-cpu-throttling) o il lavoro in background si fermerebbe a metà.
const live = new Map();

// Quante voci di diario tenere nel documento della run. Firestore si
// ferma a un mega per documento e una run grossa ne produce a centinaia.
const LOG_KEEP = 150;

// Dove finisce quello che le run producono. Sono cartelle di Firestore,
// cioè solo un modo di ordinare la vista: il file su Storage sta dove
// stava, non si sposta niente.
const OUTPUT_FOLDER = 'Output';
const KIND_FOLDER = { video: 'Video', image: 'Foto' };

// ---------------------------------------------------------------------
// Grafo
// ---------------------------------------------------------------------

/**
 * Ordina i nodi in modo che nessuno venga prima di chi lo alimenta, e si
 * accorge dei cicli. Un ciclo su una tela a nodi si disegna in un secondo
 * e manderebbe il motore in ricorsione infinita.
 */
function topoSort(graph) {
  const list = graph.nodes || [];
  const edges = graph.edges || [];
  const byId = new Map(list.map((n) => [n.id, n]));

  const indegree = new Map(list.map((n) => [n.id, 0]));
  const next = new Map(list.map((n) => [n.id, []]));

  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) || 0) + 1);
    next.get(e.from).push(e.to);
  }

  const queue = list.filter((n) => (indegree.get(n.id) || 0) === 0).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const to of next.get(id) || []) {
      const left = indegree.get(to) - 1;
      indegree.set(to, left);
      if (left === 0) queue.push(to);
    }
  }

  if (order.length !== list.length) {
    const stuck = list.filter((n) => !order.includes(n.id)).map((n) => n.type);
    const e = new Error(`Il flusso gira su se stesso (${stuck.join(', ')}): togli un collegamento`);
    e.status = 400;
    throw e;
  }
  return order.map((id) => byId.get(id));
}

/** Controlli che è meglio fare prima di spendere, non a metà run. */
function validate(graph) {
  const problems = [];
  const list = graph.nodes || [];
  if (!list.length) problems.push('Il flusso è vuoto');

  const byId = new Map(list.map((n) => [n.id, n]));
  const incoming = new Map(list.map((n) => [n.id, []]));
  for (const e of graph.edges || []) {
    if (byId.has(e.from) && byId.has(e.to)) incoming.get(e.to).push(e);
  }

  for (const node of list) {
    const type = nodes.type(node.type);
    if (!type) {
      problems.push(`Nodo sconosciuto: ${node.type}`);
      continue;
    }
    const config = nodes.configOf(node);
    const got = incoming.get(node.id) || [];

    for (const port of type.inputs) {
      if (port.optional) continue;
      if (!got.some((e) => (e.toPort || 'in') === port.id)) {
        problems.push(`${type.label}: manca il collegamento in "${port.label}"`);
      }
    }
    if (node.type === 'source' && !(config.assetIds || []).length) {
      problems.push('Source: non hai scelto nessun contenuto');
    }
    if (node.type === 'text' && !textStyle.hooks(config).length) {
      problems.push('Testo: non hai scritto nessun hook');
    }
    if (node.type === 'merge') {
      const lanes = new Set(got.map((e) => e.toPort || 'a'));
      if (lanes.size < 2) problems.push('Merge: servono almeno due ingressi collegati');
    }
  }

  if (!list.some((n) => n.type === 'save')) {
    problems.push('Manca un nodo Save: i risultati non andrebbero da nessuna parte');
  }
  return problems;
}

// ---------------------------------------------------------------------
// Preventivo
// ---------------------------------------------------------------------

/**
 * Quanto costa premere Run. Si simula il passaggio delle liste da un nodo
 * all'altro contando solo quante cose passano, senza toccare niente.
 */
async function estimate(graph) {
  const order = topoSort(graph);
  const counts = new Map();
  const kinds = new Map();
  const durations = new Map();
  const perNode = [];
  let total = 0;

  // Le sorgenti si leggono davvero: senza sapere se sono video e quanto
  // durano, il preventivo di un nodo video è un numero a caso.
  for (const node of order) {
    const config = nodes.configOf(node);
    const inputs = (graph.edges || []).filter((e) => e.to === node.id);
    const incoming = inputs.reduce((sum, e) => sum + (counts.get(e.from) || 0), 0) || (node.type === 'source' ? 0 : 1);
    const kind = inputs.map((e) => kinds.get(e.from)).find((k) => k === 'video') || 'image';
    const seconds = Math.max(0, ...inputs.map((e) => durations.get(e.from) || 0));

    if (node.type === 'source') {
      const ids = config.assetIds || [];
      const assets = (await Promise.all(ids.map((id) => store.getAsset(id)))).filter(Boolean);
      counts.set(node.id, assets.length);
      kinds.set(node.id, assets.some((a) => a.kind === 'video') ? 'video' : 'image');
      durations.set(node.id, Math.max(0, ...assets.map((a) => (a.meta && a.meta.duration) || 0)));
      perNode.push({ nodeId: node.id, type: node.type, usd: 0, jobs: assets.length, free: true });
      continue;
    }

    const cost = nodes.estimateNode(node, { incoming, seconds, kind });
    total += cost.usd;
    perNode.push({ nodeId: node.id, type: node.type, ...cost });

    if (node.type === 'wizard') {
      counts.set(node.id, incoming * Math.max(1, config.count || 1));
      kinds.set(node.id, kind);
      durations.set(node.id, seconds);
    } else if (node.type === 'text') {
      // Ogni hook per ogni stile: è qui che il flusso si allarga davvero.
      counts.set(node.id, incoming * textStyle.fanout(config));
      kinds.set(node.id, kind);
      durations.set(node.id, seconds);
    } else if (node.type === 'merge') {
      const lanes = nodes.MERGE_PORTS
        .map((id) => inputs.filter((e) => (e.toPort || 'a') === id).reduce((s, e) => s + (counts.get(e.from) || 0), 0))
        .filter((n) => n > 0);
      const product = lanes.length >= 2 ? lanes.reduce((a, b) => a * b, 1) : 0;
      counts.set(node.id, Math.min(config.limit || 100, product));
      kinds.set(node.id, 'video');
      durations.set(node.id, seconds * Math.max(2, lanes.length));
    } else {
      counts.set(node.id, incoming);
      kinds.set(node.id, kind);
      durations.set(node.id, seconds);
    }
  }

  return { usd: +total.toFixed(4), nodes: perNode, outputs: Object.fromEntries(counts) };
}

// ---------------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------------

/** Scarica quello che fal ha prodotto: i risultati sono URL, non byte. */
async function fetchOutput(url, toFile) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 180000, maxContentLength: Infinity });
  const buffer = Buffer.from(res.data);
  await require('fs/promises').writeFile(toFile, buffer);
  return { file: toFile, contentType: res.headers['content-type'] || null, bytes: buffer.length };
}

/**
 * Salva un risultato e lo trasforma in un elemento che i nodi a valle
 * possono usare. La miniatura è best-effort: senza, la scheda è vuota ma
 * il file c'è.
 */
async function persist(ctx, { file, name, contentType, origin, folderId }) {
  const info = await media.probe(file);
  let thumbFile = null;
  try {
    thumbFile = ctx.work.file(`thumb-${crypto.randomUUID().slice(0, 8)}.jpg`);
    await media.thumbnail(file, thumbFile, { at: info.kind === 'video' ? Math.min(0.5, info.duration / 2) : 0 });
  } catch {
    thumbFile = null;
  }

  const asset = await store.putAsset({
    file,
    name,
    contentType: contentType || (info.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
    folderId: folderId !== undefined ? folderId : ctx.runFolderId,
    meta: { width: info.width, height: info.height, duration: info.duration, fps: info.fps, hasAudio: info.hasAudio },
    origin,
    thumbFile,
  });

  return { assetId: asset.id, asset, file, info, name: asset.name };
}

/**
 * Un elemento pronto all'uso: file locale + metadati + URL che fal può
 * leggere.
 *
 * Si risonda sempre il file invece di fidarsi di quello che c'è scritto
 * su Firestore. Costa qualche decina di millisecondi e toglie di mezzo
 * una categoria intera di guasti: un documento salvato prima che questo
 * campo esistesse, o che dichiara una traccia audio che nel file non c'è,
 * fa costruire al Merge un filtro su un flusso inesistente e la run muore
 * a metà con un errore di ffmpeg illeggibile.
 */
async function materialise(ctx, asset) {
  const file = ctx.work.file(`${asset.id}.${store.extFor(asset.contentType, asset.name)}`);
  if (!media.exists(file)) await store.download(asset, file);
  return { assetId: asset.id, asset, file, info: await media.probe(file), name: asset.name };
}

async function urlFor(ctx, item) {
  if (!ctx.urls.has(item.assetId)) ctx.urls.set(item.assetId, await store.publicUrl(item.asset));
  return ctx.urls.get(item.assetId);
}

/**
 * La sorgente in una forma che il modello che scrive il piano può leggere.
 *
 * Vertex non ha una Files API: i byte viaggiano dentro la richiesta e oltre
 * i diciotto megabyte viene rifiutata. Un verticale di pochi secondi ci sta
 * quasi sempre, ma "quasi" non basta: se sfora si manda il primo fotogramma
 * invece del video. Il piano perde il movimento e tiene soggetto, posto e
 * inquadratura, che è quasi tutto quello che gli serve per proporre delle
 * varianti — molto meglio che far fallire la run.
 */
async function readable(ctx, item) {
  const { MAX_INLINE_BYTES } = require('../../services/gemini');
  const stat = await require('fs/promises').stat(item.file);
  if (item.info.kind !== 'video' || stat.size <= MAX_INLINE_BYTES) {
    return {
      buffer: await require('fs/promises').readFile(item.file),
      mimeType: item.asset.contentType,
      kind: item.info.kind,
    };
  }
  const frame = ctx.work.file(`read-${item.assetId}.jpg`);
  await media.extractFrame(item.file, frame, { at: Math.min(0.5, item.info.duration / 2) });
  return { buffer: await require('fs/promises').readFile(frame), mimeType: 'image/jpeg', kind: 'image' };
}

// --- i singoli nodi -------------------------------------------------

async function runSource(ctx, node, config) {
  const ids = config.assetIds || [];
  const out = [];
  for (const id of ids) {
    const asset = await store.getAsset(id);
    if (!asset) continue;
    out.push(await materialise(ctx, asset));
  }
  if (!out.length) throw new Error('Source: nessuno dei contenuti scelti esiste più');
  return out;
}

/** Slight change esatto: ffmpeg, niente modelli, niente costo. */
async function runExactVariants(ctx, node, config, inputs) {
  const count = Math.max(1, Math.min(nodes.MAX_VARIANTS, config.count || 1));
  const out = [];
  let index = 0;

  for (const item of inputs) {
    for (let v = 0; v < count; v++) {
      ctx.tick(node.id, index, inputs.length * count);
      const recipe = media.slightRecipe(v, config.knobs);
      const ext = item.info.kind === 'video' ? 'mp4' : 'jpg';
      const file = ctx.work.file(`exact-${node.id}-${index}.${ext}`);
      await media.applySlight(item.file, file, { recipe, info: item.info });
      out.push(
        await persist(ctx, {
          file,
          name: `${baseName(item.name)} · ritocco ${v + 1}.${ext}`,
          contentType: item.info.kind === 'video' ? 'video/mp4' : 'image/jpeg',
          origin: { kind: 'exact', nodeId: node.id, runId: ctx.runId, parentAssetId: item.assetId, recipe },
        })
      );
      index++;
    }
  }
  return out;
}

/** Una generazione su fal, con il nodo che si aggiorna mentre aspetta. */
async function generate(ctx, node, model, input, label) {
  const task = ctx.open(node.id, label, { step: model.price.per === 'second' ? 'video' : 'immagine' });
  // Le richieste partono tutte insieme ma fal.js ne tiene in volo un
  // numero fisso: dire che si aspetta un posto evita di pensare che sia
  // bloccata quando invece è solo in fila qui dentro.
  task.note(`in fila (max ${fal.MAX_CONCURRENCY} insieme)`);
  try {
    const result = await fal.run(model.endpoint, input, {
      label,
      isCancelled: () => ctx.cancelled,
      onUpdate: (u) => {
        task.note(
          u.phase === 'queued'
            ? `in coda${u.queuePosition ? ` (${u.queuePosition})` : ''}`
            : `${model.label} genera`,
          u.requestId
        );
      },
    });
    const outputs = fal.outputs(result);
    if (!outputs.length) throw new Error(`${model.label} non ha restituito niente`);
    task.close();
    return outputs[0];
  } catch (error) {
    task.fail(error);
    throw error;
  }
}

/**
 * Esegue N lavori insieme invece che in fila.
 *
 * Un video su fal ci mette minuti: otto varianti in sequenza sono mezz'ora,
 * lanciate insieme sono qualche minuto. Il tetto vero lo mette fal.js con
 * il suo semaforo (FAL_MAX_CONCURRENCY), qui si lanciano tutte e si aspetta.
 *
 * Non si usa `Promise.all`: alla prima che fallisce abbandonerebbe le
 * altre, che però continuano a girare su fal e si pagano comunque. Si
 * raccolgono tutti gli esiti e si tengono i riusciti, perché buttare via
 * sette video buoni perché l'ottavo è andato male non ha senso quando
 * sono già pagati.
 */
async function inParallel(items, worker) {
  const settled = await Promise.allSettled(items.map((item, i) => worker(item, i)));
  const done = [];
  const failed = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') done.push(result.value);
    else failed.push({ item: items[i], error: result.reason });
  });
  return { done, failed };
}

/**
 * Raccoglie gli esiti di un gruppo parallelo.
 *
 * Se è fallito tutto la run si ferma, perché continuare significherebbe
 * passare una lista vuota al nodo dopo. Se è fallito qualcosa si va
 * avanti con quello che c'è, e i guasti finiscono nel log.
 */
function collect(ctx, node, { done, failed }, what) {
  for (const f of failed) {
    ctx.log(node.id, `${what} non riuscita: ${f.error.message}`, { step: 'errore', bad: true });
  }
  if (!done.length && failed.length) throw failed[0].error;
  if (failed.length) ctx.note(node.id, `${done.length} riuscite, ${failed.length} no`);
  return done;
}

async function runWizard(ctx, node, config, inputs) {
  if (nodes.wizardIsExact(config)) return runExactVariants(ctx, node, config, inputs);

  const cleanup = config.cleanup || [];
  const count = Math.max(1, Math.min(nodes.MAX_VARIANTS, config.count || 1));
  const isVideo = inputs.some((i) => i.info.kind === 'video');
  const imageModel = models.resolve('image', config.imageModel);
  const videoModel = models.resolve('video', config.videoModel);

  const out = [];
  let done = 0;
  const total = inputs.length * count;
  const bump = () => ctx.tick(node.id, ++done, total);

  for (const item of inputs) {
    // Un piano per sorgente: due clip diverse meritano due serie di idee.
    const reading = ctx.open(node.id, `legge ${baseName(item.name)}`, { step: 'lettura' });
    const planned = await prompts.plan({
      media: await readable(ctx, item),
      levelId: config.level,
      targetId: config.target,
      count,
      userNote: config.note,
      cleanup,
    });
    reading.close();
    ctx.detail(node.id, { read: planned.read, variants: planned.variants.map((v) => v.label) });
    ctx.log(node.id, `${planned.variants.length} varianti in parallelo`, { step: 'piano' });

    // --- immagini -------------------------------------------------
    if (!isVideo) {
      const sourceUrl = await urlFor(ctx, item);
      const batch = await inParallel(planned.variants, async (variant, n) => {
        const prompt = prompts.buildEditPrompt({
          levelId: config.level,
          instruction: variant.instruction,
          cleanup,
          look: variant.look,
          brief: imageModel.brief,
        });
        const built = imageModel.build({ prompt, imageUrls: [sourceUrl], seed: null });
        const output = await generate(ctx, node, imageModel, built, variant.label);
        const file = ctx.work.file(`img-${node.id}-${item.assetId}-${n}.png`);
        const fetched = await fetchOutput(output.url, file);
        ctx.spend(imageModel.price.usd);
        bump();
        return persist(ctx, {
          file,
          name: `${baseName(item.name)} · ${variant.label}.png`,
          contentType: fetched.contentType || 'image/png',
          origin: {
            kind: 'ai', nodeId: node.id, runId: ctx.runId, parentAssetId: item.assetId,
            level: config.level, target: config.target, cleanup, model: imageModel.id, prompt,
          },
        });
      });
      out.push(...collect(ctx, node, batch, 'immagine'));
      continue;
    }

    // --- video ----------------------------------------------------
    // Kling (e gli altri) vogliono 3–15s. Se si manda il .mov intero
    // fal accetta il job e poi resta IN_PROGRESS per dieci minuti.
    // Si taglia qui, si carica il clip, e a fal va quello.
    const prep = ctx.open(node.id, 'prepara il clip', { step: 'taglio' });
    const clip = await prepareVideo(ctx, item, videoModel.limits || {});
    prep.close();
    const seconds = clip.info.duration || item.info.duration || 0;
    const sourceUrl = await urlFor(ctx, clip);

    // Passo 1: il fotogramma. Si modifica come immagine, costa otto
    // centesimi invece di mezzo dollaro, e si guarda prima di impegnare
    // i secondi di video.
    if (config.anchor) {
      const frame = ctx.work.file(`frame-${node.id}-${item.assetId}.jpg`);
      await media.extractFrame(clip.file, frame, { at: 0 });
      const frameAsset = await persist(ctx, {
        file: frame,
        name: `${baseName(item.name)} · fotogramma.jpg`,
        contentType: 'image/jpeg',
        origin: { kind: 'anchor-source', nodeId: node.id, runId: ctx.runId, parentAssetId: item.assetId },
      });
      const frameUrl = await urlFor(ctx, frameAsset);

      const drawn = await inParallel(planned.variants, async (variant, n) => {
        const prompt = prompts.buildEditPrompt({
          levelId: config.level,
          instruction: variant.instruction,
          cleanup,
          look: variant.look,
          brief: imageModel.brief,
        });
        const built = imageModel.build({ prompt, imageUrls: [frameUrl], seed: null });
        const output = await generate(ctx, node, imageModel, built, `ancora: ${variant.label}`);
        const file = ctx.work.file(`anchor-${node.id}-${item.assetId}-${n}.png`);
        await fetchOutput(output.url, file);
        const saved = await persist(ctx, {
          file,
          name: `${baseName(item.name)} · ancora ${variant.label}.png`,
          contentType: 'image/png',
          origin: { kind: 'anchor', nodeId: node.id, runId: ctx.runId, parentAssetId: item.assetId, prompt, model: imageModel.id },
        });
        ctx.spend(imageModel.price.usd);
        return { variant, item: saved };
      });
      const anchors = collect(ctx, node, drawn, 'ancora');

      // Passo 2: l'approvazione. Qui la run si ferma davvero: è il punto
      // in cui si evita di pagare otto video sbagliati.
      const waiting = ctx.open(node.id, `aspetta l’ok su ${anchors.length} ancore`, { step: 'attesa' });
      const approved = await ctx.approve(node.id, anchors);
      waiting.close();
      if (!approved.length) throw new Error('Nessuna ancora approvata: la run si ferma qui');

      const filmed = await inParallel(approved, async (entry, n) => {
        const refUrl = await urlFor(ctx, entry.item);
        const prompt = prompts.buildAnchorPrompt({ refKind: 'image', cleanup });
        const built = videoModel.build({
          prompt, videoUrl: sourceUrl, imageUrls: [refUrl], duration: seconds, keepAudio: true,
        });
        const output = await generate(ctx, node, videoModel, built, entry.variant.label);
        const file = ctx.work.file(`vid-${node.id}-${item.assetId}-${n}.mp4`);
        await fetchOutput(output.url, file);
        ctx.spend(models.estimate(videoModel, { seconds }));
        bump();
        return persist(ctx, {
          file,
          name: `${baseName(item.name)} · ${entry.variant.label}.mp4`,
          contentType: 'video/mp4',
          origin: {
            kind: 'ai', nodeId: node.id, runId: ctx.runId, parentAssetId: item.assetId,
            anchorAssetId: entry.item.assetId, level: config.level, target: config.target, cleanup,
            model: videoModel.id, prompt,
          },
        });
      });
      out.push(...collect(ctx, node, filmed, 'variante'));
      continue;
    }

    // Senza ancora: dritti al modello video.
    const filmed = await inParallel(planned.variants, async (variant, n) => {
      const prompt = prompts.buildEditPrompt({ levelId: config.level, instruction: variant.instruction, cleanup });
      const built = videoModel.build({ prompt, videoUrl: sourceUrl, duration: seconds, keepAudio: true });
      const output = await generate(ctx, node, videoModel, built, variant.label);
      const file = ctx.work.file(`vid-${node.id}-${item.assetId}-${n}.mp4`);
      await fetchOutput(output.url, file);
      ctx.spend(models.estimate(videoModel, { seconds }));
      bump();
      return persist(ctx, {
        file,
        name: `${baseName(item.name)} · ${variant.label}.mp4`,
        contentType: 'video/mp4',
        origin: {
          kind: 'ai', nodeId: node.id, runId: ctx.runId, parentAssetId: item.assetId,
          level: config.level, target: config.target, cleanup, model: videoModel.id, prompt,
        },
      });
    });
    out.push(...collect(ctx, node, filmed, 'variante'));
  }

  return out;
}

/** Un hook accorciato, per starci nel nome di un file. */
function shortHook(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > 26 ? `${clean.slice(0, 26)}…` : clean || 'hook';
}

async function runText(ctx, node, config, inputs) {
  const hooks = textStyle.hooks(config);
  const styles = textStyle.styles(config);
  if (!hooks.length) throw new Error('Testo: non hai scritto nessun hook');

  const out = [];
  const total = inputs.length * hooks.length * styles.length;
  let i = 0;

  // Tre giri annidati: ogni contenuto, per ogni hook, per ogni stile.
  // È il punto in cui cinque hook su cinque clip in due stili diventano
  // cinquanta file senza che nessuno scriva niente a mano.
  for (const item of inputs) {
    for (const hook of hooks) {
      for (const styleId of styles) {
        if (ctx.cancelled) return out;
        ctx.tick(node.id, i, total);
        ctx.log(node.id, `«${shortHook(hook)}» ${styleId}`, { step: 'testo' });

        const layout = textStyle.layout({
          styleId,
          background: config.background,
          text: hook,
          width: item.info.width || media.TARGET.width,
          height: item.info.height || media.TARGET.height,
          y: config.y,
          scale: config.scale,
        });
        const ext = item.info.kind === 'video' ? 'mp4' : 'jpg';
        const file = ctx.work.file(`text-${node.id}-${i}.${ext}`);
        await media.burnCaption(item.file, file, { layout, info: item.info, workDir: ctx.work.dir });
        out.push(
          await persist(ctx, {
            file,
            name: `${baseName(item.name)} · ${shortHook(hook)} · ${styleId}.${ext}`,
            contentType: item.info.kind === 'video' ? 'video/mp4' : 'image/jpeg',
            origin: {
              kind: 'text', nodeId: node.id, runId: ctx.runId, parentAssetId: item.assetId,
              style: styleId, background: layout.background, text: hook,
            },
          })
        );
        i++;
      }
    }
  }
  return out;
}

/**
 * La combinazione numero `index`, senza costruire tutto il prodotto.
 *
 * Con quattro ingressi il prodotto può essere enorme, e materializzarlo
 * per poi buttarne via il 90% è solo memoria sprecata: l'indice si
 * decodifica come un numero a base mista, una cifra per ingresso.
 */
function comboAt(lanes, index) {
  const out = new Array(lanes.length);
  let rest = index;
  for (let i = lanes.length - 1; i >= 0; i--) {
    out[i] = lanes[i][rest % lanes[i].length];
    rest = Math.floor(rest / lanes[i].length);
  }
  return out;
}

/**
 * Quali combinazioni tenere quando il tetto taglia.
 *
 * "In fila" prende le prime del prodotto: siccome l'ultimo ingresso è
 * quello che gira più veloce, del primo si vedono solo i primi elementi.
 * Con cinquanta hook e un tetto di venti ne uscirebbero dieci soltanto.
 * "Distribuite" prende a passo costante, così ogni sorgente compare.
 */
function chooseIndices(total, limit, mode) {
  const take = Math.max(1, Math.min(total, limit));
  if (take === total) return Array.from({ length: total }, (_, i) => i);
  if (mode === 'order' || take === 1) return Array.from({ length: take }, (_, i) => i);
  const step = (total - 1) / (take - 1);
  return [...new Set(Array.from({ length: take }, (_, i) => Math.round(i * step)))];
}

async function runMerge(ctx, node, config, ports) {
  const lanes = nodes.MERGE_PORTS.map((id) => ports[id] || []).filter((lane) => lane.length);
  if (lanes.length < 2) throw new Error('Merge: servono almeno due ingressi collegati e non vuoti');

  const limit = Math.max(1, Math.min(500, config.limit || 100));
  const total = lanes.reduce((n, lane) => n * lane.length, 1);
  const picked = chooseIndices(total, limit, config.pick);

  ctx.log(node.id, `${lanes.map((l) => l.length).join(' × ')} = ${total} combinazioni, ne faccio ${picked.length}`, {
    step: 'merge',
  });

  const out = [];
  let i = 0;
  for (const index of picked) {
    if (ctx.cancelled) return out;
    const combo = comboAt(lanes, index);
    ctx.tick(node.id, i, picked.length);
    ctx.log(node.id, combo.map((c) => baseName(c.name)).join(' + '), { step: 'merge' });

    const file = ctx.work.file(`merge-${node.id}-${i}.mp4`);
    await media.concat(combo, file, { stillSeconds: config.stillSeconds });
    out.push(
      await persist(ctx, {
        file,
        name: `${combo.map((c) => baseName(c.name)).join(' + ').slice(0, 90)}.mp4`,
        contentType: 'video/mp4',
        origin: { kind: 'merge', nodeId: node.id, runId: ctx.runId, parts: combo.map((c) => c.assetId) },
      })
    );
    i++;
  }
  if (total > picked.length) ctx.note(node.id, `${picked.length} di ${total} combinazioni`);
  return out;
}

async function runSave(ctx, node, config, inputs) {
  // Senza una destinazione scelta si resta nella cartella della run, che
  // sta già sotto Output. Dentro, video e foto si dividono da soli: una
  // run che ne sputa ottanta mescolati non la guarda nessuno.
  const home = config.folderId || ctx.runFolderId;
  const byKind = new Map();
  const bucketFor = async (kind) => {
    const label = KIND_FOLDER[kind] || 'Altro';
    if (!byKind.has(label)) byKind.set(label, await store.ensureFolder({ name: label, parentId: home }));
    return byKind.get(label).id;
  };

  const counters = new Map();
  const prefix = String(config.prefix || '').trim();

  for (const item of inputs) {
    const folderId = await bucketFor(item.info.kind);
    // La numerazione riparte per ogni cartella, altrimenti in Video si
    // salta dal 3 al 7 perché i numeri di mezzo sono finiti in Foto.
    const n = (counters.get(folderId) || 0) + 1;
    counters.set(folderId, n);
    const name = prefix
      ? `${prefix} ${String(n).padStart(2, '0')}${path.extname(item.name) || ''}`
      : item.name;
    await store.updateAsset(item.assetId, { folderId, name });
  }

  const where = [...byKind.keys()].join(' e ');
  ctx.note(node.id, `${inputs.length} salvati${where ? ` in ${where}` : ''}`);
  ctx.log(node.id, `${inputs.length} file in Output${where ? ` / ${where}` : ''}`, { step: 'save' });
  return inputs;
}

const HANDLERS = { source: runSource, wizard: runWizard, text: runText, merge: runMerge, save: runSave };

function baseName(name) {
  return String(name || 'clip').replace(/\.[^.]+$/, '').slice(0, 40);
}

/**
 * Un video che i modelli accettano: durata, lato e container.
 * Si pubblica sul bucket perché fal scarica da un URL, non dal disco.
 */
async function prepareVideo(ctx, item, limits) {
  const maxS = limits.maxSeconds || 15;
  const minS = limits.minSeconds || 3;
  const duration = item.info.duration || 0;
  const short = Math.min(item.info.width || 0, item.info.height || 0);
  const long = Math.max(item.info.width || 0, item.info.height || 0);
  const alreadyOk =
    item.asset.contentType === 'video/mp4' &&
    duration >= minS &&
    duration <= maxS + 0.05 &&
    (!limits.minSide || !short || short >= limits.minSide) &&
    (!limits.maxSide || !long || long <= limits.maxSide);

  if (alreadyOk) return item;

  const file = ctx.work.file(`fit-${item.assetId}.mp4`);
  await media.fitVideo(item.file, file, { info: item.info, limits });
  return persist(ctx, {
    file,
    name: `${baseName(item.name)} · clip.mp4`,
    contentType: 'video/mp4',
    origin: { kind: 'fit', parentAssetId: item.assetId, limits },
  });
}

// ---------------------------------------------------------------------

/**
 * Avvia una run e torna subito con il suo id: il lavoro prosegue in
 * background e lo stato si legge da Firestore.
 */
async function start({ graph, flowId, name }) {
  const problems = validate(graph);
  if (problems.length) {
    const e = new Error(problems.join(' · '));
    e.status = 400;
    e.problems = problems;
    throw e;
  }

  const order = topoSort(graph);
  const budget = await estimate(graph);

  const state = {};
  for (const node of order) state[node.id] = { status: 'pending', type: node.type, outputs: 0 };

  const runId = await store.createRun({
    flowId: flowId || null,
    name: name || 'Run',
    status: 'running',
    graph,
    estimateUsd: budget.usd,
    spentUsd: 0,
    nodes: state,
  });

  // La cartella dove atterra tutto quello che la run produce, così i
  // risultati non si mescolano allo storage ordinato prima ancora che tu
  // li abbia guardati. Sta sotto "Output": è l'unico posto da aprire per
  // trovare quello che è uscito, senza cercarlo fra i caricamenti.
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const output = await store.ensureFolder({ name: OUTPUT_FOLDER, parentId: null });
  const folder = await store.createFolder({
    name: `${name || 'Run'} · ${stamp}`,
    parentId: output.id,
  });

  const work = await media.workspace(runId.slice(0, 8));
  const control = { cancelled: false, approvals: new Map() };
  live.set(runId, control);

  const ctx = buildContext({ runId, work, runFolderId: folder.id, control });
  // L'approvazione arriva da una richiesta HTTP diversa e deve poter
  // riscrivere lo stato del nodo senza ricostruirselo.
  control.ctx = ctx;

  // Fire-and-forget: la chiamata HTTP è già tornata, il resto vive qui.
  (async () => {
    try {
      const produced = new Map();
      for (const node of order) {
        if (control.cancelled) throw Object.assign(new Error('annullata'), { code: 'cancelled' });

        const config = { ...nodes.configOf(node) };
        const type = nodes.type(node.type);
        await ctx.patch(node.id, { status: 'running', note: null, progress: null });
        ctx.log(node.id, `${type.label}: comincia`, { step: node.type });

        // Gli ingressi, raccolti per porta.
        const ports = {};
        for (const port of type.inputs) ports[port.id] = [];
        for (const edge of graph.edges || []) {
          if (edge.to !== node.id) continue;
          const port = edge.toPort || (type.inputs[0] && type.inputs[0].id);
          if (!ports[port]) ports[port] = [];
          ports[port].push(...(produced.get(edge.from) || []));
        }
        const flat = Object.values(ports).flat();

        const outputs = await HANDLERS[node.type](ctx, node, config, node.type === 'merge' ? ports : flat);
        produced.set(node.id, outputs);
        await ctx.patch(node.id, {
          status: 'done',
          outputs: outputs.length,
          progress: null,
          preview: outputs.slice(0, 8).map((o) => ({ assetId: o.assetId, name: o.name, kind: o.info.kind })),
        });
        ctx.log(node.id, `${type.label}: ${outputs.length} in uscita`, { step: node.type });
      }

      await ctx.seal();
      await store.patchRun(runId, { status: 'done', finishedAt: new Date().toISOString() });
    } catch (error) {
      const cancelled = error.code === 'cancelled' || control.cancelled;
      console.error('[distribution] run fallita:', error.message);
      await store.patchRun(runId, {
        status: cancelled ? 'cancelled' : 'error',
        error: cancelled ? null : error.message,
        finishedAt: new Date().toISOString(),
      }).catch(() => {});
      // Il nodo su cui si è rotto resta rosso, gli altri non partiti.
      await ctx.failCurrent(error).catch(() => {});
    } finally {
      live.delete(runId);
      await work.cleanup();
    }
  })();

  return { runId, estimateUsd: budget.usd, folderId: folder.id };
}

/** Il contesto che i nodi usano per raccontare cosa stanno facendo. */
function buildContext({ runId, work, runFolderId, control }) {
  const nodeState = new Map();
  let spent = 0;
  let current = null;

  // Il diario della run: cosa sta facendo, da quanto, e quanto è costato
  // in tempo ogni tipo di lavoro. Le voci aperte hanno solo `at`, il
  // cronometro lo fa il browser: così un'attesa di sei minuti su fal si
  // vede scorrere invece di comparire tutta insieme alla fine.
  const tasks = [];
  const totals = {};
  let seq = 0;

  const trim = () => {
    // Un flusso grosso produce centinaia di voci e il documento Firestore
    // ha un tetto di un mega. Le finite più vecchie si buttano, le aperte
    // restano sempre: sono quelle che stai guardando.
    if (tasks.length <= LOG_KEEP) return;
    const extra = tasks.length - LOG_KEEP;
    let removed = 0;
    for (let i = 0; i < tasks.length && removed < extra; i++) {
      if (tasks[i].state === 'running') continue;
      tasks.splice(i, 1);
      i--;
      removed++;
    }
  };

  const bucket = (step) => (totals[step] = totals[step] || { count: 0, ms: 0, running: 0 });

  const push = (nodeId, label, { step = 'altro', state = 'note' } = {}) => {
    const task = {
      id: `t${++seq}`,
      nodeId,
      step,
      label,
      note: null,
      at: new Date().toISOString(),
      ms: state === 'running' ? null : 0,
      state,
    };
    tasks.push(task);
    const b = bucket(step);
    b.count++;
    if (state === 'running') b.running++;
    trim();
    queue();
    return task;
  };

  const finish = (task, state, note) => {
    if (task.state !== 'running') return;
    task.state = state;
    task.ms = Date.now() - Date.parse(task.at);
    if (note) task.note = note;
    const b = bucket(task.step);
    b.running = Math.max(0, b.running - 1);
    b.ms += task.ms;
    queue();
  };

  // Le scritture su Firestore vengono accorpate: un nodo che genera
  // trenta varianti produrrebbe trenta aggiornamenti al secondo.
  //
  // Lo stato dei nodi si riscrive sempre intero e annidato. La scorciatoia
  // sarebbe `{'nodes.abc': ...}`, ma `set` con merge tratta i punti come
  // parte del nome del campo, non come un percorso: si otterrebbe un
  // campo che si chiama letteralmente "nodes.abc" accanto a "nodes", e il
  // browser leggerebbe per sempre lo stato di partenza.
  let dirty = false;
  let timer = null;
  const flush = async () => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    await store
      .patchRun(runId, {
        nodes: Object.fromEntries(nodeState),
        spentUsd: +spent.toFixed(4),
        tasks: tasks.slice(),
        totals: JSON.parse(JSON.stringify(totals)),
      })
      .catch(() => {});
  };
  const queue = () => {
    dirty = true;
    if (!timer) timer = setTimeout(flush, 600);
  };

  const patch = async (nodeId, fields) => {
    current = nodeId;
    const merged = { ...(nodeState.get(nodeId) || {}), ...fields };
    nodeState.set(nodeId, merged);
    queue();
    // Fine di un nodo: si scrive subito, perché è il momento in cui il
    // browser deve vedere le anteprime comparire.
    if (fields.status === 'done' || fields.status === 'error') {
      clearTimeout(timer);
      timer = null;
      await flush();
    }
  };

  return {
    runId,
    work,
    runFolderId,
    urls: new Map(),
    get cancelled() {
      return control.cancelled;
    },
    patch,
    note: (nodeId, note) => patch(nodeId, { note }),
    detail: (nodeId, detail) => patch(nodeId, { detail }),
    tick: (nodeId, done, total) => patch(nodeId, { progress: { done, total } }),

    /** Una riga nel diario, senza durata. */
    log: (nodeId, text, opts = {}) => {
      push(nodeId, text, { step: opts.step, state: opts.bad ? 'error' : 'note' });
    },

    /**
     * Un lavoro che dura: torna la maniglia per aggiornarlo e chiuderlo.
     * Finché resta aperto il browser gli tiene il cronometro addosso.
     */
    open: (nodeId, label, opts = {}) => {
      const task = push(nodeId, label, { step: opts.step, state: 'running' });
      // Sulla scheda ci sta una riga sola: con più lavori in volo conta
      // quanti sono, il dettaglio di ciascuno sta nel diario.
      const openNow = () => tasks.filter((t) => t.nodeId === nodeId && t.state === 'running').length;
      const open = openNow();
      // Il cronometro sulla scheda parte dal primo lavoro aperto e si
      // spegne quando si chiude l'ultimo: con più lavori in volo quello
      // che conta è da quanto il nodo è fermo lì, non la somma di tutti.
      patch(nodeId, open > 1
        ? { note: `${open} in parallelo` }
        : { note: label, job: { since: task.at } });
      const shut = (state, error) => {
        finish(task, state, error && error.message);
        const left = openNow();
        patch(nodeId, left ? { note: `${left} in parallelo` } : { note: null, job: null });
      };
      return {
        note: (text, requestId) => {
          task.note = text;
          if (requestId) task.requestId = requestId;
          queue();
        },
        close: () => shut('done'),
        fail: (error) => shut('error', error),
      };
    },
    spend: (usd) => {
      spent += usd || 0;
      queue();
    },
    failCurrent: async (error) => {
      // Qualunque cosa fosse aperta è morta con la run: se resta
      // "running" il browser le tiene il cronometro acceso per sempre.
      for (const task of tasks) finish(task, 'error', error.message);
      if (!current) return flush();
      const merged = { ...(nodeState.get(current) || {}), status: 'error', error: error.message };
      nodeState.set(current, merged);
      await store.patchRun(runId, { nodes: Object.fromEntries(nodeState), tasks: tasks.slice(), totals });
    },
    /** Chiude il diario a fine corsa e scrive tutto subito. */
    seal: async () => {
      for (const task of tasks) finish(task, 'done');
      clearTimeout(timer);
      timer = null;
      await flush();
    },
    // Lo stato completo, per chi deve riscriverlo da fuori (l'approvazione).
    snapshot: () => Object.fromEntries(nodeState),
    setNode: (nodeId, fields) => {
      nodeState.set(nodeId, { ...(nodeState.get(nodeId) || {}), ...fields });
      return Object.fromEntries(nodeState);
    },

    /**
     * La pausa di approvazione. La run si ferma davvero: il motore aspetta
     * che arrivi una risposta dal browser prima di impegnare i secondi di
     * video, che è tutto il punto del flusso ad ancora.
     */
    approve: (nodeId, anchors) =>
      new Promise((resolve, reject) => {
        const choices = anchors.map((a) => ({
          assetId: a.item.assetId,
          label: a.variant.label,
          instruction: a.variant.instruction,
        }));
        control.approvals.set(nodeId, { anchors, resolve, reject });
        patch(nodeId, { status: 'waiting', awaiting: choices, note: 'aspetta la tua approvazione' })
          .then(() => store.patchRun(runId, { status: 'waiting' }))
          .catch(() => {});
      }),
  };
}

/** La risposta del browser alla pausa di approvazione. */
async function approve(runId, nodeId, acceptedIds) {
  const control = live.get(runId);
  if (!control) {
    const e = new Error('Questa run non è più in corso');
    e.status = 404;
    throw e;
  }
  const gate = control.approvals.get(nodeId);
  if (!gate) {
    const e = new Error('Questo nodo non sta aspettando niente');
    e.status = 400;
    throw e;
  }
  control.approvals.delete(nodeId);

  const wanted = new Set(acceptedIds || []);
  const kept = gate.anchors.filter((a) => wanted.has(a.item.assetId));
  await store.patchRun(runId, {
    status: 'running',
    nodes: control.ctx.setNode(nodeId, { awaiting: null, status: 'running', note: `${kept.length} approvate` }),
  });
  gate.resolve(kept);
  return { approved: kept.length };
}

function cancel(runId) {
  const control = live.get(runId);
  if (!control) return { cancelled: false };
  control.cancelled = true;
  // Un nodo fermo in attesa di approvazione non si sblocca da solo.
  for (const [, gate] of control.approvals) gate.resolve([]);
  control.approvals.clear();
  return { cancelled: true };
}

module.exports = { topoSort, validate, estimate, start, approve, cancel };
