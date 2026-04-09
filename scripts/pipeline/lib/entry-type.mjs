// entry-type.mjs
//
// Derives the `type` field for bikepaths.yml entries.
// See _ctx/entry-types.md for the spec.
//
// Called after derivePathType in the pipeline. Depends on:
// - path_type (from derivePathType)
// - _ways (transient geometry, available during build)
// - osm_relations, osm_names, name
//
// Network entries already have type: 'network' — this function skips them.

import { haversineM } from './geo.mjs';

/**
 * Compute total length in metres from _ways (Overpass geometry format).
 * _ways is Array<Array<{lat, lon}>> — each inner array is a way's node list.
 */
export function waysLengthM(ways) {
  if (!ways?.length) return 0;
  let total = 0;
  for (const way of ways) {
    for (let i = 1; i < way.length; i++) {
      total += haversineM(
        [way[i - 1].lon, way[i - 1].lat],
        [way[i].lon, way[i].lat],
      );
    }
  }
  return total;
}

const LONG_DISTANCE_M = 50_000;
const MEGATRAIL_M = 30_000;

/**
 * Check if an entry qualifies as long-distance.
 * Usable before deriveEntryType runs (e.g. during network member resolution).
 *
 * @param {object} entry — a bikepaths.yml entry with _ways still attached
 * @returns {boolean}
 */
export function isLongDistance(entry) {
  if (entry.type === 'long-distance') return true;
  // MTB trails are local by nature — a trail system is a network of loops,
  // not a linear touring route, regardless of total geometry length.
  // Exception: NCN-tagged MTB entries are long-distance routes on rough terrain.
  if ((entry.mtb || entry.path_type === 'mtb-trail') && entry.network !== 'ncn') return false;
  const lengthM = waysLengthM(entry._ways);
  const hasRelation = entry.osm_relations?.length > 0;
  if (entry.network === 'ncn' && hasRelation && lengthM >= LONG_DISTANCE_M) return true;
  if (entry.network === 'rcn' && hasRelation && lengthM >= LONG_DISTANCE_M) return true;
  if (entry.ref && hasRelation && lengthM >= LONG_DISTANCE_M) return true;
  // Megatrail: long enough to be a destination, but must have some identity
  // (relation or ref) — pure length alone could promote unnamed chains
  if (lengthM >= MEGATRAIL_M && (hasRelation || entry.ref)) return true;
  return false;
}

/**
 * Derive entry type. Returns undefined for entries that already have a type
 * (networks). Returns 'destination', 'infrastructure', or 'connector'.
 *
 * @param {object} entry — a bikepaths.yml entry with _ways still attached
 * @param {object} [thresholds] — city-configurable thresholds
 * @param {number} [thresholds.destinationLengthM=1000] — min length for MUP/trail destinations
 * @param {number} [thresholds.infrastructureLengthM=300] — min length for infrastructure (below = connector)
 * @returns {string|undefined}
 */
export function deriveEntryType(entry, thresholds = {}) {
  if (entry.type === 'network' || entry.type === 'long-distance') return undefined;

  const {
    destinationLengthM = 1000,
    infrastructureLengthM = 300,
  } = thresholds;

  const pt = entry.path_type;
  const lengthM = waysLengthM(entry._ways);
  const hasRelation = entry.osm_relations?.length > 0;
  const hasOsmName = entry.osm_names?.length > 0;

  // Long-distance: named routes people plan trips for.
  if (isLongDistance(entry)) return 'long-distance';

  // Named cycling routes (OSM relations) are destinations — someone created
  // a relation for this path, which means it has real-world identity.
  if (hasRelation) return 'destination';

  // MTB trails: classification depends on discovery provenance.
  // Network members always get pages. Unnamed chains (pipeline artifacts
  // auto-named from nearby parks) go on the map but don't get pages.
  // Named-way trails use the standard length threshold.
  if (pt === 'mtb-trail') {
    if (entry.member_of) return 'destination';
    if (entry._discovery_source === 'unnamed-chain') return 'infrastructure';
    if (lengthM >= destinationLengthM) return 'destination';
    return 'connector';
  }

  // Bike lanes and paved shoulders: infrastructure at best, connector if tiny
  if (pt === 'bike-lane' || pt === 'paved-shoulder' || pt === 'separated-lane') {
    return lengthM >= infrastructureLengthM ? 'infrastructure' : 'connector';
  }

  // MUPs and trails: destination if long enough, infrastructure if named,
  // connector if short and unnamed
  if (pt === 'mup' || pt === 'trail') {
    if (lengthM >= destinationLengthM) return 'destination';
    if (hasOsmName) return 'infrastructure';
    return lengthM >= infrastructureLengthM ? 'infrastructure' : 'connector';
  }

  // Fallback
  return 'infrastructure';
}
