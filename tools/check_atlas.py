"""Controllo dell'atlante: valori ammessi, doppioni tra cucine, link delle fonti.

Uso: python3 tools/check_atlas.py [--links]

Sta fuori da backend/ apposta: un file .py lì dentro fa scegliere ai
Buildpack di Cloud Run l'immagine Python, senza Node.
"""
import json
import sys
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent / "backend" / "catalog" / "atlas"

TILES = {"Italian", "Mexican", "Japanese", "Greek", "Thai", "Indian", "American",
         "Chinese", "Middle Eastern", "Korean", "Fresh & light"}
FORMATS = {"pasta", "noodles", "rice_dish", "risotto", "soup", "stew", "curry", "salad", "bowl",
           "sandwich", "wrap", "tacos", "flatbread", "pizza", "dumplings", "bake", "stir_fry",
           "savory_pie", "skewers", "fritters", "stuffed", "egg_dish", "other"}
PROTEINS = {"chickpeas", "lentils", "beans", "tofu", "tempeh", "seitan", "soy_mince",
            "edamame_peas", "mushrooms", "nuts_seeds", "jackfruit", "eggs", "cheese", "fish",
            "shellfish", "vegetables", "grains"}
METHODS = {"stovetop", "oven", "no_cook", "grill", "steam", "deep_fry", "slow_cook",
           "pressure_cook", "air_fry"}
APPLIANCES = {"stovetop", "oven", "microwave", "freezer", "blender", "air_fryer",
              "pressure_cooker", "slow_cooker", "food_processor", "grill"}
DIETS = {"vegan", "vegetarian", "pescatarian"}
TRAD_DIETS = DIETS | {"meat"}
SEASONS = {"spring", "summer", "autumn", "winter"}
OCCASIONS = {"everyday", "hosting", "date", "mealprep", "quick", "comfort"}
EFFORTS = {"low", "medium", "high"}


def load():
    dishes = []
    for path in sorted(HERE.glob("*.json")):
        data = json.loads(path.read_text())
        for dish in data["dishes"]:
            dishes.append((path.name, dish))
    return dishes


def check_fields(file, d):
    errs = []

    def bad(msg):
        errs.append(f"{file} {d.get('key')}: {msg}")

    for field in ("key", "name", "nameEn", "cuisine", "technique"):
        if not isinstance(d.get(field), str) or not d[field].strip():
            bad(f"{field} mancante")
    if not set(d.get("tiles", [])) <= TILES or not d.get("tiles"):
        bad(f"tiles {d.get('tiles')}")
    if d.get("format") not in FORMATS:
        bad(f"format {d.get('format')}")
    if d.get("protein") not in PROTEINS:
        bad(f"protein {d.get('protein')}")
    if d.get("method") not in METHODS:
        bad(f"method {d.get('method')}")
    appliances = d.get("appliances")
    if not isinstance(appliances, list) or not set(appliances) <= APPLIANCES:
        bad(f"appliances {appliances}")
    elif not appliances and d.get("method") != "no_cook":
        bad("nessun elettrodomestico ma serve cottura")
    if d.get("effort") not in EFFORTS:
        bad(f"effort {d.get('effort')}")
    if d.get("familiarity") not in (1, 2, 3):
        bad(f"familiarity {d.get('familiarity')}")
    if d.get("traditionalDiet") not in TRAD_DIETS:
        bad(f"traditionalDiet {d.get('traditionalDiet')}")
    versions = set(d.get("versions", []))
    if not versions or not versions <= DIETS:
        bad(f"versions {d.get('versions')}")
    if "vegan" in versions and not d.get("veganApproach"):
        bad("vegan senza veganApproach")
    if not set(d.get("seasons", [])) <= SEASONS or not d.get("seasons"):
        bad(f"seasons {d.get('seasons')}")
    occasions = set(d.get("occasions", []))
    if not occasions <= OCCASIONS or not occasions:
        bad(f"occasions {d.get('occasions')}")
    minutes = d.get("cookMinutes")
    if not isinstance(minutes, int) or minutes <= 0:
        bad(f"cookMinutes {minutes}")
    elif "quick" in occasions and minutes > 25:
        bad(f"quick con {minutes} minuti")
    sources = d.get("sources") or []
    if not 1 <= len(sources) <= 3 or not all(str(s.get("url", "")).startswith("http") for s in sources):
        bad("sources")
    return errs


def check_link(url):
    req = urllib.request.Request(url, method="GET", headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 "
                      "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Accept": "text/html,application/xhtml+xml",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return url, resp.status
    except urllib.error.HTTPError as e:
        return url, e.code
    except Exception as e:  # noqa: BLE001
        return url, type(e).__name__


def main():
    dishes = load()
    errors = [e for file, d in dishes for e in check_fields(file, d)]

    by_key = defaultdict(list)
    by_name = defaultdict(list)
    for file, d in dishes:
        by_key[d["key"]].append(file)
        by_name[d["nameEn"].lower().strip()].append(f"{file}:{d['key']}")
    dup_keys = {k: v for k, v in by_key.items() if len(v) > 1}
    dup_names = {k: v for k, v in by_name.items() if len(v) > 1}

    print(f"Piatti: {len(dishes)}")
    print("Per file:", dict(Counter(f for f, _ in dishes)))
    tile_cover = Counter(t for _, d in dishes for t in d["tiles"])
    print("Copertura per tile (contando i tag multipli):", dict(tile_cover))
    print("Versioni:", dict(Counter(v for _, d in dishes for v in d["versions"])))
    print("Familiarità:", dict(Counter(d["familiarity"] for _, d in dishes)))
    print(f"\nErrori di campo: {len(errors)}")
    for e in errors:
        print("  ", e)
    print(f"\nChiavi ripetute: {len(dup_keys)}")
    for k, v in dup_keys.items():
        print("  ", k, v)
    print(f"Nomi inglesi ripetuti: {len(dup_names)}")
    for k, v in dup_names.items():
        print("  ", k, v)

    if "--links" in sys.argv:
        urls = sorted({s["url"] for _, d in dishes for s in d["sources"]})
        with ThreadPoolExecutor(max_workers=24) as pool:
            results = list(pool.map(check_link, urls))
        status = Counter()
        dead, unsure = [], []
        for url, code in results:
            if isinstance(code, int) and code < 400:
                status["ok"] += 1
            elif code in (404, 410):
                status["morto"] += 1
                dead.append(url)
            else:
                status[f"non verificabile ({code})"] += 1
                unsure.append((url, code))
        print(f"\nLink: {len(urls)}", dict(status))
        out = {"dead": dead, "unsure": unsure}
        Path("/tmp/vego-atlas-links.json").write_text(json.dumps(out, indent=1))
        for url in dead:
            print("   MORTO", url)


if __name__ == "__main__":
    main()
