// Tab Scan (§5): menu scan multi-foto e product scan da barcode.
// Il barcode è decodificato ON-DEVICE (VisionKit): qui arriva già la stringa.
const express = require('express');
const { db, FieldValue } = require('../lib/firebase');
const { startJob, JobError } = require('../lib/jobs');
const { consumeQuota } = require('../lib/rate-limit');
const { getTasteProfile } = require('../lib/profile');
const { getCached, setCached, bumpCacheHit } = require('../lib/cache');
const { generateJSON, imagePart } = require('../services/gemini');
const { downloadImage } = require('../services/storage');
const { lookupBarcode } = require('../services/openfoodfacts');
const { buildMenuScanPrompt, menuScanSchema, toAppDish } = require('../prompts/menu-scan');
const { flagsFromOffTags, classifyWithGemini, verdictFor, badgesFor } = require('../lib/verdict');
const { recordEvent } = require('../lib/usage');
const { responseLanguage } = require('../prompts/diet');

const router = express.Router();

const PRODUCT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // dati prodotto: 7 giorni

// POST /scan/menu  { scanId, storagePaths: ["users/uid/uploads/..."] }
// Le foto le ha già caricate l'app su Firebase Storage.
router.post('/menu', (req, res) => {
  const { scanId, storagePaths } = req.body || {};
  if (!scanId || !Array.isArray(storagePaths) || !storagePaths.length || storagePaths.length > 6) {
    return res.status(400).json({ error: 'missing_fields', details: 'scanId e 1-6 storagePaths richiesti' });
  }
  startJob(req, res, {
    type: 'scan.menu',
    payload: { scanId },
    work: async ({ uid }) => {
      const scanRef = db().doc(`users/${uid}/scans/${scanId}`);
      await scanRef.set({
        type: 'menu',
        status: 'running',
        storagePaths,
        createdAt: FieldValue.serverTimestamp(),
      });

      const images = await Promise.all(storagePaths.map((p) => downloadImage(p)));
      const profile = await getTasteProfile(uid);
      const result = await generateJSON({
        prompt: buildMenuScanPrompt(profile, images.length),
        schema: menuScanSchema,
        parts: images.map((img) => imagePart(img.buffer, img.mimeType)),
        temperature: 0.3,
        label: 'menu-scan',
      });
      consumeQuota(uid, 'jobs', 1);

      await scanRef.set(
        {
          status: 'done',
          restaurantName: result.restaurantName || null,
          bestBets: (result.bestBets || []).map(toAppDish),
          askForThese: (result.askForThese || []).map(toAppDish),
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    },
  });
});

const translationSchema = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    ingredients: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['name', 'ingredients'],
};

/**
 * Open Food Facts dà nome e ingredienti nella lingua dell'etichetta:
 * l'utente li vede nella lingua dell'app. Cache per barcode e lingua,
 * perché la cache del prodotto è condivisa tra utenti di lingue diverse.
 * Se la traduzione non riesce si mostra l'originale.
 */
async function localizeProduct(product, verdict, profile) {
  const lang = profile.language || 'en';
  const offending = verdict.offendingIngredients || [];
  const key = `${product.barcode}_${lang}`;
  let translated = await getCached('productTranslations', key, PRODUCT_CACHE_TTL_MS);
  const covers = translated && offending.every((i) => translated.ingredients[i.name]);
  if (!covers) {
    try {
      const names = offending.map((i) => i.name);
      const result = await generateJSON({
        prompt: [
          `Translate this grocery product's name and ingredient names into ${responseLanguage(profile)}.`,
          'Write the name as a shop would label it in that language. Keep brand names, trademarks and proper nouns as they are.',
          'If a text is already in that language, return it unchanged. Same order and count for ingredients.',
          JSON.stringify({ name: product.name, ingredients: names }),
        ].join('\n'),
        schema: translationSchema,
        temperature: 0.1,
        thinkingLevel: 'LOW',
        label: 'product-translate',
      });
      translated = {
        name: result.name || product.name,
        ingredients: {
          ...(translated?.ingredients || {}),
          ...Object.fromEntries(names.map((n, i) => [n, (result.ingredients || [])[i] || n])),
        },
      };
      await setCached('productTranslations', key, translated);
    } catch (e) {
      console.warn('[scan.product] traduzione non riuscita, resta la lingua dell\'etichetta:', e.message);
      return { product, verdict };
    }
  }
  return {
    product: { ...product, name: translated.name },
    verdict: {
      ...verdict,
      offendingIngredients: offending.map((i) => ({ ...i, name: translated.ingredients[i.name] || i.name })),
    },
  };
}

// POST /scan/product  { scanId, barcode }
router.post('/product', (req, res) => {
  const { scanId, barcode } = req.body || {};
  if (!scanId || !barcode) {
    return res.status(400).json({ error: 'missing_fields', details: 'scanId e barcode richiesti' });
  }
  startJob(req, res, {
    type: 'scan.product',
    payload: { scanId, barcode },
    work: async ({ uid }) => {
      const scanRef = db().doc(`users/${uid}/scans/${scanId}`);
      await scanRef.set({
        type: 'product',
        status: 'running',
        barcode,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Cache globale prodotto+flags: il barcode è uguale per tutti (§10.3).
      let entry = await getCached('products', String(barcode), PRODUCT_CACHE_TTL_MS);
      if (entry && entry.product && !('nutrition' in entry.product)) {
        // Voce di prima dei valori nutrizionali: si riscarica il prodotto,
        // la classificazione resta buona.
        const product = await lookupBarcode(barcode);
        if (product) {
          entry = { product, flags: entry.flags };
          await setCached('products', String(barcode), entry);
        }
      } else if (entry) {
        bumpCacheHit('products', String(barcode));
        recordEvent(uid, 'scan.productCacheHit');
      } else {
        const product = await lookupBarcode(barcode);
        if (!product) {
          await scanRef.set({ status: 'not_found' }, { merge: true });
          return;
        }
        let flags = flagsFromOffTags(product);
        if (!flags) {
          if (product.ingredientsText) {
            flags = await classifyWithGemini(product);
            consumeQuota(uid, 'jobs', 1);
          } else {
            flags = null; // nessun dato: verdetto unknown
          }
        }
        entry = { product, flags };
        await setCached('products', String(barcode), entry);
      }

      const profile = await getTasteProfile(uid);
      const verdict = entry.flags
        ? verdictFor(profile.dietaryIdentity, entry.flags)
        : { fits: null, label: 'Not enough data', offendingIngredients: [] };
      const localized = await localizeProduct(entry.product, verdict, profile);

      await scanRef.set(
        {
          status: 'done',
          product: localized.product,
          verdict: localized.verdict,
          badges: badgesFor(entry.flags, entry.product.nutrition),
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    },
  });
});

module.exports = router;
