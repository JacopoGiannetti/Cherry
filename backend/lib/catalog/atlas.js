// L'atlante dei piatti: l'elenco curato di piatti veri per ogni tile del
// wizard (backend/catalog/atlas/*.json). Si legge una volta all'avvio.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'catalog', 'atlas');

// Gli id delle tile come li manda l'app. Sono solo cucine:
// "comfort" e "light & fresh" sono motivi della spesa, non tile.
const TILES = [
  'Italian', 'Mexican', 'Japanese', 'Greek', 'Thai', 'Indian',
  'American', 'Chinese', 'Middle Eastern', 'Korean', 'Fresh & light',
];

let cache = null;

function load() {
  if (cache) return cache;
  const dishes = [];
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    for (const dish of data.dishes || []) dishes.push(dish);
  }
  cache = { dishes, byKey: new Map(dishes.map((d) => [d.key, d])) };
  return cache;
}

function allDishes() {
  return load().dishes;
}

function dish(key) {
  return load().byKey.get(key) || null;
}

/** Piatti di almeno una delle tile; nessuna tile = tutto l'atlante. */
function dishesForTiles(tiles) {
  const all = load().dishes;
  if (!tiles || !tiles.length) return all;
  return all.filter((d) => d.tiles.some((t) => tiles.includes(t)));
}

module.exports = { TILES, allDishes, dish, dishesForTiles };
