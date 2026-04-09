/**
 * City adapter — region-specific configuration for build-bikepaths and other scripts.
 *
 * Each city exports:
 *   - relationNamePattern: regex string for OSM relation name matching
 *   - namedWayQueries(bbox): array of { label, q } Overpass queries for named ways
 *   - externalData: optional external data source config (e.g. catastro)
 *   - memberSort(a, b): comparator for ordering a network's members
 *
 * Add new cities by adding a case to the switch below.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Two-bucket member sort for bike-path detail pages:
//
//   1. Named entries first (no digit in the name), alphabetical:
//        "a numberless thing", "ab another thing", "Hermit", "Salamander"…
//   2. Numbered entries after, ordered by the FIRST number in the name
//      (irrespective of prefix text), tiebroken alphabetically:
//        "Trail 1", "2", "Piste 3", "Trail #4", "Sentier 5", "Trail 5",
//        "58 Konnektor"…
//
// This matches how people browse a park's trail list: memorable named
// trails rise to the top, then the numbered grid flows below them purely
// by trail number. "Trail #3" and "Trail 3" and "Piste 3" all share the
// same sort key, so the prefix style (OSM inconsistency) doesn't matter.
//
// Collation for the name-bucket fallback is locale-aware, case- and
// diacritic-insensitive. Cities with specific needs (ref order, distance
// order) can override `memberSort` on their adapter.
const namedBucketCollator = new Intl.Collator('en', { sensitivity: 'base' });
const tiebreakCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function firstNumberIn(name) {
  if (!name) return null;
  const m = String(name).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function naturalNameSort(a, b) {
  const aNum = firstNumberIn(a?.name);
  const bNum = firstNumberIn(b?.name);

  // Named bucket first.
  if (aNum === null && bNum !== null) return -1;
  if (aNum !== null && bNum === null) return 1;

  // Both named: alphabetical.
  if (aNum === null && bNum === null) {
    return namedBucketCollator.compare(a?.name || '', b?.name || '');
  }

  // Both numbered: sort by extracted number; tiebreak alphabetically so
  // "Sentier 5" and "Trail 5" sit next to each other in a stable order.
  if (aNum !== bNum) return aNum - bNum;
  return tiebreakCollator.compare(a?.name || '', b?.name || '');
}

// ---------------------------------------------------------------------------
// Santiago
// ---------------------------------------------------------------------------

const santiago = {
  relationNamePattern: '[Cc]iclo|[Bb]ici|[Pp]ista [Rr]ecreativa|[Pp]arque',

  namedWayQueries: (bbox) => [
    { label: 'cycleways', q: `[out:json][timeout:60];way["highway"="cycleway"]["name"](${bbox});out geom tags;` },
    { label: 'bike paths', q: `[out:json][timeout:60];way["highway"="path"]["bicycle"~"designated|yes"]["name"](${bbox});out geom tags;` },
    { label: 'bike lanes', q: `[out:json][timeout:60];way["cycleway"~"lane|track"]["name"](${bbox});out geom tags;` },
    { label: 'bike lanes (left)', q: `[out:json][timeout:60];way["cycleway:left"~"lane|track"]["name"](${bbox});out geom tags;` },
    { label: 'bike lanes (right)', q: `[out:json][timeout:60];way["cycleway:right"~"lane|track"]["name"](${bbox});out geom tags;` },
    { label: 'bike lanes (both)', q: `[out:json][timeout:60];way["cycleway:both"~"lane|track"]["name"](${bbox});out geom tags;` },
    { label: 'linear parks', q: `[out:json][timeout:60];way["leisure"="park"]["name"~"[Pp]arque.*[Cc]anal|[Pp]arque.*[Ll]ineal|[Pp]arque.*[Bb]ici"](${bbox});out geom tags;` },
    { label: 'pistas recreativas', q: `[out:json][timeout:60];way["name"~"[Pp]ista [Rr]ecreativa"](${bbox});out geom tags;` },
  ],

  externalData: {
    type: 'catastro',
    url: 'https://raw.githubusercontent.com/pedaleable/mapa-catastro/refs/heads/gh-pages/datos/catastro.geojson',
  },

  parallelLaneFilter: null,

  memberSort: naturalNameSort,
};

// ---------------------------------------------------------------------------
// Ottawa
// ---------------------------------------------------------------------------

const ottawa = {
  // NCC pathways, recreational trails, cycling routes (English + French)
  relationNamePattern: '[Pp]athway|[Tt]rail|[Cc]ycl|[Bb]ike|[Ss]entier|MUP|[Pp]iste',

  namedWayQueries: (bbox) => [
    { label: 'cycleways', q: `[out:json][timeout:60];way["highway"="cycleway"]["name"](${bbox});out geom tags;` },
    { label: 'bike paths', q: `[out:json][timeout:60];way["highway"="path"]["bicycle"~"designated|yes"]["name"](${bbox});out geom tags;` },
    { label: 'bike lanes', q: `[out:json][timeout:60];way["cycleway"~"lane|track"]["name"](${bbox});out geom tags;` },
    { label: 'bike lanes (left)', q: `[out:json][timeout:60];way["cycleway:left"~"lane|track"]["name"](${bbox});out geom tags;` },
    { label: 'bike lanes (right)', q: `[out:json][timeout:60];way["cycleway:right"~"lane|track"]["name"](${bbox});out geom tags;` },
    { label: 'bike lanes (both)', q: `[out:json][timeout:60];way["cycleway:both"~"lane|track"]["name"](${bbox});out geom tags;` },
    // Multi-use paths designated for cycling (NCC pathways, recreational paths)
    { label: 'multi-use paths', q: `[out:json][timeout:60];way["highway"="path"]["bicycle"~"designated|yes"]["name"](${bbox});out geom tags;` },
    // Footways designated for cycling (shared MUPs tagged as footway)
    { label: 'shared footways', q: `[out:json][timeout:60];way["highway"="footway"]["bicycle"~"designated|yes"]["name"](${bbox});out geom tags;` },
  ],

  externalData: null,

  parallelLaneFilter: null,

  discoverNetworks: true,

  memberSort: naturalNameSort,
};

// ---------------------------------------------------------------------------
// Parallel lane filter (default)
// ---------------------------------------------------------------------------

/**
 * Default filter for parallel lane discovery.
 * Accepts any highway=cycleway without a name or crossing tag.
 * City adapters can override with stricter filters.
 *
 * @param {object} tags — OSM tags from the way
 * @returns {boolean} — true if the way should be considered
 */
export function defaultParallelLaneFilter(tags) {
  return tags.highway === 'cycleway' && !tags.name && !tags.crossing;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const adapters = { santiago, ottawa };

export function loadCityAdapter(cityName) {
  const adapter = adapters[cityName];
  if (!adapter) {
    const available = Object.keys(adapters).join(', ');
    throw new Error(`No city adapter for "${cityName}". Available: ${available}`);
  }
  return adapter;
}
