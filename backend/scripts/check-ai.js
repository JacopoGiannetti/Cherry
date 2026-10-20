// Verifica end-to-end i servizi AI usando gli stessi client del backend.
// Uso: npm run check:ai
require('dotenv').config();
const axios = require('axios');
const { keys } = require('../config/keys');
const { generateJSON } = require('../services/gemini');
const { extractionSchema, buildExtractionPrompt } = require('../prompts/swap');

const ok = (s) => console.log(`  OK    ${s}`);
const ko = (s) => console.log(`  MANCA ${s}`);

const SAMPLE_RECIPE = `Creamy garlic pasta: 200g spaghetti, 2 tbsp butter,
4 garlic cloves, 100ml heavy cream, parmesan. Boil pasta, melt butter,
add garlic, pour cream, toss with pasta and cheese. Serves 2, 15 minutes.`;

async function checkGemini() {
  if (!keys.gemini.apiKey) return ko('GEMINI_API_KEY assente nel .env');
  try {
    const out = await generateJSON({
      prompt: buildExtractionPrompt({ sourceType: 'text', text: SAMPLE_RECIPE }),
      schema: extractionSchema,
      temperature: 0.2,
      label: 'check',
      thinkingLevel: 'LOW',
    });
    if (out.found && out.recipe && Array.isArray(out.recipe.ingredients)) {
      ok(`Gemini ${keys.gemini.model} — JSON strutturato valido ("${out.recipe.title}", ${out.recipe.ingredients.length} ingredienti)`);
    } else {
      ko(`Gemini ${keys.gemini.model} — risposta fuori schema: ${JSON.stringify(out).slice(0, 120)}`);
    }
  } catch (e) {
    ko(`Gemini ${keys.gemini.model} — ${e.message}`);
  }
}

async function checkFal() {
  if (!keys.fal.apiKey) return ko('FAL_KEY assente nel .env');
  try {
    const r = await axios.post(
      'https://fal.run/fal-ai/flux-2/klein/4b',
      { prompt: 'a bowl of pasta, food photography', image_size: 'square', num_images: 1 },
      { headers: { Authorization: `Key ${keys.fal.apiKey}` }, timeout: 90000 }
    );
    const url = r.data.images && r.data.images[0] && r.data.images[0].url;
    ok(url ? 'fal.ai FLUX.2 klein — immagine generata' : 'fal.ai risponde ma senza immagine');
  } catch (e) {
    const d = e.response && e.response.data;
    ko(`fal.ai — ${e.response ? e.response.status : ''} ${d ? JSON.stringify(d).slice(0, 150) : e.message}`);
  }
}

async function checkRapidApi() {
  if (!keys.rapidApi.apiKey) return ko('RAPIDAPI_KEY assente nel .env');
  try {
    const r = await axios.post(
      `https://${keys.rapidApi.socialHost}${keys.rapidApi.socialPath}`,
      { url: 'https://www.tiktok.com/@tiktok/video/6807491984882765062' },
      {
        headers: {
          'x-rapidapi-key': keys.rapidApi.apiKey,
          'x-rapidapi-host': keys.rapidApi.socialHost,
          'Content-Type': 'application/json',
        },
        timeout: 45000,
      }
    );
    const medias = r.data && r.data.medias;
    ok(medias && medias.length ? `RapidAPI social — ${medias.length} media trovati` : 'RapidAPI risponde ma senza media');
  } catch (e) {
    const d = e.response && e.response.data;
    ko(`RapidAPI — ${e.response ? e.response.status : ''} ${d ? JSON.stringify(d).slice(0, 150) : e.message}`);
  }
}

(async () => {
  await checkGemini();
  await checkFal();
  await checkRapidApi();
})();
