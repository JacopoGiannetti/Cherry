// One-off: genera le foto delle 12 ricette preset (piani curati da Cherry)
// e stampa gli URL hosted da fal, da hardcodare nel catalogo dell'app.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { generateRecipeImage } = require('../services/fal-image');

const RECIPES = [
  { key: 'rigatoni', prompt: 'rigatoni pasta in creamy tomato basil sauce, torn fresh basil, Italian trattoria dish' },
  { key: 'risotto', prompt: 'creamy wild mushroom risotto with parsley and cracked pepper, Italian dish' },
  { key: 'ribollita', prompt: 'tuscan ribollita, white bean and kale stew with crusty sourdough bread, rustic bowl' },
  { key: 'gyros', prompt: 'greek pita gyros stuffed with crispy spiced chickpeas, tomato, red onion, creamy tzatziki sauce' },
  { key: 'briam', prompt: 'greek briam, roasted zucchini eggplant potato and tomato in olive oil, rustic ceramic baking dish' },
  { key: 'orzo', prompt: 'lemon orzo salad with kalamata olives, cherry tomatoes and white feta cubes, mediterranean plate' },
  { key: 'friedrice', prompt: 'crispy golden tofu fried rice with peas, carrots and scallions, asian bowl' },
  { key: 'ramen', prompt: 'ramen noodles in creamy peanut broth with bok choy and chili oil drizzle, japanese bowl' },
  { key: 'eggplant', prompt: 'sticky glazed teriyaki eggplant over steamed rice with sesame seeds and scallions, japanese bowl' },
  { key: 'lasagna', prompt: 'lasagna slice with rich mushroom lentil ragu and creamy bechamel, golden baked top' },
  { key: 'butternutmac', prompt: 'creamy butternut squash mac and cheese in a cast iron skillet with crispy golden breadcrumbs' },
  { key: 'jackfruit', prompt: 'pulled bbq jackfruit sliders with purple cabbage slaw on toasted brioche buns' },
];

(async () => {
  const results = {};
  await Promise.all(
    RECIPES.map(async ({ key, prompt }) => {
      const url = await generateRecipeImage({ title: key, imagePrompt: prompt });
      results[key] = url;
      console.log(`${key}: ${url}`);
    })
  );
  console.log('\nJSON:\n' + JSON.stringify(results, null, 2));
})();
