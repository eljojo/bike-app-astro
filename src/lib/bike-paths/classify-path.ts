/**
 * Bike path classification.
 *
 * One module for all classification: MTB detection, path_type derivation,
 * and clustering type. The pipeline, clustering, and facts all import from here.
 *
 * Browser-safe — no .server.ts, no node:* imports.
 */

import { isUnpaved, isPaved, isMaintainedUnpaved } from './surfaces.ts';

// ---------------------------------------------------------------------------
// Predicates — shared vocabulary for classification and facts
// ---------------------------------------------------------------------------

interface HasHighway { highway?: string; surface?: string; parallel_to?: string }
interface HasMtbScale { 'mtb:scale'?: string | number; 'mtb:scale:imba'?: string | number }
interface HasBicycle { bicycle?: string }

/** Trail-type highway: path/footway, or unpaved cycleway. Not parallel_to (road infra). */
export function isTrailType(entry: HasHighway): boolean {
  if (entry.parallel_to) return false;
  const hw = entry.highway;
  if (hw === 'path' || hw === 'footway') return true;
  if (hw === 'cycleway' && isUnpaved(entry.surface)) return true;
  return false;
}

/** Separated from car traffic — highway=cycleway. */
export function isSeparatedFromCars(entry: HasHighway): boolean {
  return entry.highway === 'cycleway';
}

/** Explicit MTB trail: mtb:scale >= 1 or mtb:scale:imba present. Scale 0 = any bike, excluded. */
export function isExplicitMtb(entry: HasMtbScale): boolean {
  const scale = entry['mtb:scale'];
  if (scale != null && scale !== '0' && scale !== 0) return true;
  if (entry['mtb:scale:imba'] != null) return true;
  return false;
}

/** Designated cycling infrastructure: bicycle=designated. */
export function isDesignatedCycling(entry: HasBicycle): boolean {
  return entry.bicycle === 'designated';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROAD_HIGHWAYS = new Set([
  'primary', 'secondary', 'tertiary', 'residential', 'unclassified',
  'living_street', 'service', 'trunk',
]);

// ---------------------------------------------------------------------------
// Classification functions
// ---------------------------------------------------------------------------

/** Entry shape for classification — any object with OSM-derived fields. */
export interface ClassifiableEntry {
  type?: string;
  highway?: string;
  surface?: string;
  parallel_to?: string;
  cycleway?: string;
  bicycle?: string;
  mtb?: boolean;
  'mtb:scale'?: string | number;
  'mtb:scale:imba'?: string | number;
  path_type?: string;
  [key: string]: unknown;
}

/**
 * Derive path_type from OSM tags.
 *
 * 6-value classification: mup, separated-lane, bike-lane, paved-shoulder, mtb-trail, trail.
 * Requires entry.mtb to be pre-set for MTB detection.
 * Networks return undefined.
 *
 * MUP requires evidence of pavement: highway=cycleway implies pavement,
 * but highway=path or footway with no surface data defaults to trail.
 */
export function derivePathType(entry: ClassifiableEntry): string | undefined {
  if (entry.type === 'network') return undefined;

  // 1. MTB
  if (entry.mtb) return 'mtb-trail';

  // 2-5. Road-based cycling infrastructure.
  const isRoad = ROAD_HIGHWAYS.has(entry.highway!);
  if (entry.parallel_to && !isRoad && entry.highway === 'cycleway') {
    // Standalone cycleway alongside a road (e.g. QED canal path) → mup
  } else if (entry.parallel_to || (isRoad && entry.cycleway)) {
    const cw = entry.cycleway;
    if (cw === 'track') return 'separated-lane';
    if (cw === 'shoulder') return 'paved-shoulder';
    return 'bike-lane';
  }

  // 6. Unpaved surface → trail
  if (isUnpaved(entry.surface)) return 'trail';

  // 7. MUP requires evidence of pavement.
  // highway=cycleway implies paved infrastructure.
  // highway=path/footway with no surface → trail (no evidence of pavement).
  const hw = entry.highway;
  if (hw === 'cycleway') return 'mup';
  if (isPaved(entry.surface)) return 'mup';

  // No evidence of pavement — default to trail
  return 'trail';
}

/**
 * Map path_type to 3-value clustering bucket.
 * Primarily maps derivePathType output. When path_type is not set
 * (e.g. network entries), falls back to raw tag classification so
 * networks retain their type for clustering compatibility checks.
 */
export function pathTypeForClustering(entry: ClassifiableEntry): 'trail' | 'paved' | 'road' | null {
  const pt = entry.path_type;
  if (pt) {
    if (pt === 'trail' || pt === 'mtb-trail') return 'trail';
    if (pt === 'mup') return 'paved';
    if (pt === 'bike-lane' || pt === 'separated-lane' || pt === 'paved-shoulder') return 'road';
    return null;
  }

  // Fallback for entries without path_type (networks, pre-classification entries).
  // Matches the old pathType() behavior from cluster-entries.
  if (entry.parallel_to) return 'road';
  const hw = entry.highway;
  if (hw === 'path' || hw === 'footway') {
    return isPaved(entry.surface) ? 'paved' : 'trail';
  }
  if (hw === 'cycleway') {
    if (isUnpaved(entry.surface)) return 'trail';
    return 'paved';
  }
  if (hw && hw !== 'path' && hw !== 'cycleway' && hw !== 'footway') return 'road';
  return null;
}

// ---------------------------------------------------------------------------
// Pipeline entry points
// ---------------------------------------------------------------------------

/**
 * Early classification: tier-1 MTB + path_type derivation.
 * Run BEFORE clustering so cluster-entries can use path_type.
 * Mutates entries in place.
 */
export function classifyPathsEarly(entries: ClassifiableEntry[]): { mtbCount: number } {
  // Tier 1: explicit MTB
  let mtbCount = 0;
  for (const entry of entries) {
    if (isExplicitMtb(entry)) {
      entry.mtb = true;
      mtbCount++;
    }
  }

  // Initial path_type derivation (uses tier-1 mtb)
  for (const entry of entries) {
    const pt = derivePathType(entry);
    if (pt) entry.path_type = pt;
  }

  return { mtbCount };
}

/**
 * Late classification: tier-2 network inference + tier-3 ambient MTB.
 * Run AFTER clustering creates networks with _memberRefs.
 * Mutates entries in place.
 */
export function classifyPathsLate(entries: ClassifiableEntry[]): { mtbCount: number } {
  let mtbCount = 0;

  // Tier 2: inferred from networks
  for (const entry of entries) {
    if (entry.type !== 'network') continue;
    const memberEntries = (entry._memberRefs || []) as ClassifiableEntry[];
    const hasExplicitMtb = memberEntries.some(m => m.mtb === true);
    if (hasExplicitMtb) {
      if ((isTrailType(entry) || !isPaved(entry.surface)) && !isMaintainedUnpaved(entry.surface)) {
        if (!entry.mtb) { entry.mtb = true; mtbCount++; }
      }
      for (const m of memberEntries) {
        if (isTrailType(m) && !isPaved(m.surface) && !isMaintainedUnpaved(m.surface)) {
          if (!m.mtb) { m.mtb = true; mtbCount++; }
        }
      }
    }
  }

  // Tier 3: ambient — dirt trail without cycling designation
  for (const entry of entries) {
    if (entry.mtb) continue;
    if (entry.parallel_to) continue;
    if (isDesignatedCycling(entry)) continue;
    if (!isTrailType(entry)) continue;
    if (isPaved(entry.surface)) continue;
    if (isMaintainedUnpaved(entry.surface)) continue;
    entry.mtb = true;
    mtbCount++;
  }

  // Update path_type for entries whose mtb changed (trail → mtb-trail)
  for (const entry of entries) {
    if (entry.mtb && entry.path_type === 'trail') {
      entry.path_type = 'mtb-trail';
    }
  }

  return { mtbCount };
}
