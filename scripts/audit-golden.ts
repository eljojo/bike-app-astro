/**
 * Cross-reference the golden IA YAMLs against current bikepaths.yml
 * (pipeline output). Reports existence, geographic coherence per network,
 * filter_out reality, reclassification state, cross-membership state.
 *
 * Usage:
 *   npx tsx scripts/audit-golden.ts
 *
 * Reads:
 *   tests/golden/ottawa/*.yaml
 *   ~/code/bike-routes/ottawa/bikepaths.yml
 *   .cache/bikepath-geometry/ottawa/*.geojson (for full-geometry map pass)
 */
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';

type Anchor = [number, number];
interface BpEntry {
  slug: string;
  name: string;
  type?: string;
  path_type?: string;
  member_of?: string;
  network?: string;
  surface?: string;
  highway?: string;
  bicycle?: string;
  lit?: string;
  listed?: boolean;
  standalone?: boolean;
  osm_relations?: number[];
  osm_way_ids?: number[];
  anchors?: Anchor[];
  members?: string[];
}
interface BikePathsYml {
  bike_paths?: BpEntry[];
}

interface GoldenNetwork {
  slug: string;
  name?: string;
  tier_1_paths?: string[];
  tier_2_paths?: string[];
  segments?: string[];
  stage_1_monolith_slug?: string;
  sibling_networks_with_cross_membership?: string[];
  related?: string[];
}
interface GoldenTab {
  networks?: GoldenNetwork[];
  standalone_paths?: string[];
}
interface GoldenIA {
  tabs?: Record<string, GoldenTab>;
  filter_out?: Array<{ slug: string; reason?: string }>;
  reclassify_as_connector?: Array<{ slug: string; reason?: string }>;
  renames?: Array<{ from_slug: string; to_slug: string }>;
  reclassifications?: Array<{ slug: string; from?: string; to: string }>;
  cross_memberships?: Array<{ slug: string; primary_memberOf: string; also_listed_in?: string[] }>;
  segments_expectations?: Array<{ slug: string; min_named_segments: number; note?: string }>;
}

const GOLDEN_DIR = '/home/dev/code/bike-app-astro/tests/golden/ottawa';
const BIKEPATHS = '/home/dev/code/bike-routes/ottawa/bikepaths.yml';
const CACHE_DIR = '/home/dev/code/bike-app-astro/.cache/bikepath-geometry/ottawa';

const bp = yaml.load(fs.readFileSync(BIKEPATHS, 'utf-8')) as BikePathsYml;
const bpEntries = bp.bike_paths ?? [];
const bySlug = new Map<string, BpEntry>();
for (const e of bpEntries) bySlug.set(e.slug, e);

function deepMerge(t: Record<string, unknown>, s: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(s)) {
    const tv = t[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      deepMerge(tv as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      t[k] = v;
    }
  }
}
const goldenFiles = ['01-pathways.yaml', '02-bikeways.yaml', '03-local-trails.yaml', '04-long-distance.yaml', '05-mtb.yaml', '06-everything-else.yaml'];
const golden: Record<string, unknown> = {};
for (const f of goldenFiles) deepMerge(golden, yaml.load(fs.readFileSync(path.join(GOLDEN_DIR, f), 'utf-8')) as Record<string, unknown>);
const g = golden as unknown as GoldenIA;

interface Ref { slug: string; source: string; role: string }
const refs: Ref[] = [];
for (const [tabKey, tab] of Object.entries(g.tabs ?? {})) {
  for (const net of tab.networks ?? []) {
    refs.push({ slug: net.slug, source: tabKey, role: 'network-head' });
    for (const s of net.tier_1_paths ?? []) refs.push({ slug: s, source: `${tabKey}/${net.slug}`, role: 'tier1' });
    for (const s of net.tier_2_paths ?? []) refs.push({ slug: s, source: `${tabKey}/${net.slug}`, role: 'tier2' });
    for (const s of net.segments ?? []) refs.push({ slug: s, source: `${tabKey}/${net.slug}`, role: 'segment' });
  }
  for (const s of tab.standalone_paths ?? []) refs.push({ slug: s, source: tabKey, role: 'standalone' });
}
for (const e of g.filter_out ?? []) refs.push({ slug: e.slug, source: 'filter_out', role: 'filter_out' });
for (const e of g.reclassify_as_connector ?? []) refs.push({ slug: e.slug, source: 'reclassify_as_connector', role: 'connector' });
for (const e of g.reclassifications ?? []) refs.push({ slug: e.slug, source: 'reclassifications', role: 'reclass' });
for (const e of g.cross_memberships ?? []) {
  refs.push({ slug: e.slug, source: 'cross_memberships', role: 'cross-member' });
  refs.push({ slug: e.primary_memberOf, source: 'cross_memberships', role: 'cross-primary' });
  for (const n of e.also_listed_in ?? []) refs.push({ slug: n, source: 'cross_memberships', role: 'cross-secondary' });
}
for (const e of g.segments_expectations ?? []) refs.push({ slug: e.slug, source: 'segments_expectations', role: 'segment-parent' });

const seen = new Set<string>();
const uniqRefs = refs.filter((r) => { const k = `${r.slug}|${r.source}|${r.role}`; if (seen.has(k)) return false; seen.add(k); return true; });
const missing = uniqRefs.filter((r) => !bySlug.has(r.slug));

console.log('=== MISSING FROM bikepaths.yml ===');
console.log(`Total references: ${uniqRefs.length}, missing: ${missing.length}`);
const missingByRole: Record<string, number> = {};
for (const m of missing) missingByRole[m.role] = (missingByRole[m.role] ?? 0) + 1;
console.log('By role:', missingByRole);

console.log('\n=== NETWORK GEOGRAPHIC COHERENCE ===');
for (const [tabKey, tab] of Object.entries(g.tabs ?? {})) {
  for (const net of tab.networks ?? []) {
    const allMembers = [...(net.tier_1_paths ?? []), ...(net.tier_2_paths ?? []), ...(net.segments ?? [])];
    const pts: Array<{ slug: string; lat: number; lng: number; member_of: string }> = [];
    const missingMembers: string[] = [];
    for (const s of allMembers) {
      const p = bySlug.get(s);
      const anchor = p?.anchors?.[0];
      if (!p || !anchor) { missingMembers.push(s); continue; }
      pts.push({ slug: s, lat: anchor[1], lng: anchor[0], member_of: p.member_of ?? '' });
    }
    if (pts.length === 0) { console.log(`[${tabKey}/${net.slug}] NO GEOMETRY FOUND (${allMembers.length} members listed)`); continue; }
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const latMin = Math.min(...lats), latMax = Math.max(...lats);
    const lngMin = Math.min(...lngs), lngMax = Math.max(...lngs);
    const correct = pts.filter((p) => p.member_of === net.slug).length;
    const wrong = pts.filter((p) => p.member_of && p.member_of !== net.slug);
    console.log(`[${tabKey}/${net.slug}] ${pts.length}/${allMembers.length} found, center=(${((latMin + latMax) / 2).toFixed(3)},${((lngMin + lngMax) / 2).toFixed(3)}), spread=(${(latMax - latMin).toFixed(3)},${(lngMax - lngMin).toFixed(3)}), ${correct} correct, ${wrong.length} wrong, ${missingMembers.length} missing`);
    if (missingMembers.length > 0) console.log(`  missing: ${missingMembers.slice(0, 5).join(', ')}${missingMembers.length > 5 ? ` (+${missingMembers.length - 5})` : ''}`);
    if (wrong.length > 0) {
      const bd: Record<string, number> = {};
      for (const w of wrong) bd[w.member_of] = (bd[w.member_of] ?? 0) + 1;
      console.log(`  wrong member_of:`, bd);
    }
  }
}

console.log('\n=== FILTER_OUT CHECK ===');
const foFound = (g.filter_out ?? []).filter((e) => bySlug.has(e.slug));
console.log(`${foFound.length}/${(g.filter_out ?? []).length} filter_out entries exist in bikepaths.yml`);

console.log('\n=== RECLASSIFICATIONS ===');
let rOk = 0, rWrong = 0, rMissing = 0;
for (const e of g.reclassifications ?? []) {
  const p = bySlug.get(e.slug);
  if (!p) { rMissing++; continue; }
  const parts = e.to.split('/');
  const tgt = parts[1] === 'standalone' ? '' : parts[1];
  if ((p.member_of ?? '') === tgt) rOk++;
  else rWrong++;
}
console.log(`  ${rOk} already in target, ${rWrong} need to move, ${rMissing} missing from bikepaths.yml`);

console.log('\n=== SEGMENTS EXPECTATIONS ===');
for (const e of g.segments_expectations ?? []) {
  const p = bySlug.get(e.slug);
  if (!p) { console.log(`  ${e.slug}: MISSING`); continue; }
  console.log(`  ${e.slug}: ${p.osm_way_ids?.length ?? 0} ways, type=${p.type}, expects min ${e.min_named_segments}`);
}

// Per-network full-geometry map
interface FeatureProps { surface?: string; name?: string }
interface FeatureGeom { type: 'LineString' | 'MultiLineString'; coordinates: number[][] | number[][][] }
interface Feature { properties?: FeatureProps; geometry?: FeatureGeom }
interface FeatureCollection { features?: Feature[] }

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const cachedFiles = fs.existsSync(CACHE_DIR) ? new Set(fs.readdirSync(CACHE_DIR)) : new Set<string>();

function loadGeomForEntry(e: BpEntry): Feature[] {
  const features: Feature[] = [];
  for (const relId of e.osm_relations ?? []) {
    const f = `${relId}.geojson`;
    if (!cachedFiles.has(f)) continue;
    try { features.push(...((JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf-8')) as FeatureCollection).features ?? [])); } catch { /* ignore */ }
  }
  return features;
}

interface GeomSummary { lenKm: number; latMin: number; latMax: number; lngMin: number; lngMax: number; surfaces: Map<string, number>; names: Map<string, number>; wayCount: number }
function summarize(features: Feature[]): GeomSummary {
  let lenKm = 0, latMin = 90, latMax = -90, lngMin = 180, lngMax = -180, wayCount = 0;
  const surfaces = new Map<string, number>(); const names = new Map<string, number>();
  for (const feat of features) {
    const geom = feat.geometry;
    if (!geom) continue;
    const lines: number[][][] = geom.type === 'MultiLineString' ? (geom.coordinates as number[][][]) : [geom.coordinates as number[][]];
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        const [lng, lat] = line[i] as [number, number];
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
        if (lng < lngMin) lngMin = lng;
        if (lng > lngMax) lngMax = lng;
        if (i > 0) {
          const [plng, plat] = line[i - 1] as [number, number];
          lenKm += haversineKm(plat, plng, lat, lng);
        }
      }
    }
    const s = feat.properties?.surface;
    if (s) surfaces.set(s, (surfaces.get(s) ?? 0) + 1);
    const n = feat.properties?.name;
    if (n) names.set(n, (names.get(n) ?? 0) + 1);
    wayCount++;
  }
  return { lenKm, latMin, latMax, lngMin, lngMax, surfaces, names, wayCount };
}

console.log('\n=== NETWORK GEOGRAPHIC MAP (from cached geometry) ===');
for (const [tabKey, tab] of Object.entries(g.tabs ?? {})) {
  for (const net of tab.networks ?? []) {
    const members = [...(net.tier_1_paths ?? []), ...(net.tier_2_paths ?? []), ...(net.segments ?? [])];
    if (members.length === 0) { console.log(`[${tabKey}/${net.slug}] no members listed`); continue; }
    const all: Feature[] = [];
    for (const s of members) {
      const entry = bySlug.get(s);
      if (entry) all.push(...loadGeomForEntry(entry));
    }
    const sum = summarize(all);
    if (sum.wayCount === 0) { console.log(`[${tabKey}/${net.slug}] ${members.length}m NO cached geometry`); continue; }
    const topSurfaces = [...sum.surfaces.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s}(${n})`).join(', ');
    const topNames = [...sum.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n}(${c})`).join('; ');
    console.log(`[${tabKey}/${net.slug}] ${members.length}m ${sum.wayCount}w ${sum.lenKm.toFixed(1)}km  lat ${sum.latMin.toFixed(3)}..${sum.latMax.toFixed(3)} lng ${sum.lngMin.toFixed(3)}..${sum.lngMax.toFixed(3)}`);
    console.log(`  surfaces: ${topSurfaces}`);
    console.log(`  OSM names: ${topNames || '(none)'}`);
  }
}
