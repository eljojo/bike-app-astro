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

// Locale-aware natural-name comparator. Two-bucket sort:
//
//   1. Named trails first (no digits in the name), alphabetical.
//   2. Numbered trails after (anything containing a digit), natural numeric
//      order — "Trail #3" before "Trail #24", "Piste 12" before "Piste 60".
//
// The bucket split matches how people browse a park's trail list: memorable
// named trails like "Hermit" or "Salamander" rise to the top, then the
// anonymous numbered grid flows below them in order. OSM tags are
// inconsistent about whether numbered refs get a "#" prefix ("Trail #3" vs
// "Trail 3") — normalising "#" out of the sort key lets both styles
// interleave within the numbered bucket.
//
// Sort is diacritic- and case-insensitive so "Écluse" and "ecluse" sort
// together and "sentier" next to "Sentier". Cities with specific needs
// (ref order, distance order) can override `memberSort` on their adapter.
const naturalNameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
function normaliseForSort(name) {
  return (name || '').replace(/#\s*/g, '').replace(/\s+/g, ' ').trim();
}
function isNumbered(name) {
  return /\d/.test(name || '');
}
function naturalNameSort(a, b) {
  const aNum = isNumbered(a?.name);
  const bNum = isNumbered(b?.name);
  if (aNum !== bNum) return aNum ? 1 : -1; // named first, numbered after
  return naturalNameCollator.compare(normaliseForSort(a?.name), normaliseForSort(b?.name));
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
