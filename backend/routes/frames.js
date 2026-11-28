// Rifai i fotogrammi degli step di una ricetta Instagram (menu della ricetta).
// Si monta su /v1 DOPO routes/web.js, che ha già fatto CORS e verificato il token (req.uid).
// Risponde subito: il lavoro dura circa un minuto e la pagina segue lo stato sul documento.
const express = require('express');
const { requireEntitlement } = require('../lib/entitlement');
const { checkQuota, consumeQuota } = require('../lib/rate-limit');
const { regenerateFrames } = require('../lib/web-import');

const router = express.Router();

router.post('/recipes/:id/frames', requireEntitlement, async (req, res) => {
  if (!req.uid) return res.status(401).json({ error: 'unauthorized' });
  try {
    if (!(await checkQuota(req.uid, 'jobs'))) {
      return res.status(429).json({ error: 'daily_limit', message: 'Try again tomorrow.' });
    }
    const out = await regenerateFrames(req.uid, req.params.id);
    if (out.started) consumeQuota(req.uid, 'jobs').catch(() => {});
    res.json(out);
  } catch (e) {
    const status = e.code === 'not_found' ? 404 : e.code === 'not_instagram' ? 400 : 500;
    if (status === 500) console.error('[frames] rifai:', e.message);
    res.status(status).json({ error: e.code || 'frames_failed', message: e.userMessage || 'We couldn’t start that. Try again.' });
  }
});

module.exports = router;
