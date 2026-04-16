/**
 * Bucket the 785 bikepaths.yml entries by character (network_member, bike-lane-on-road,
 * street-connector, destination-standalone, etc.). Prints counts + first 15 samples per
 * non-obvious bucket + the full DESTINATION_STANDALONE list (the most likely "gem" bucket).
 *
 * Usage:
 *   npx tsx scripts/audit-candidates.ts
 */
import yaml from 'js-yaml';
import fs from 'node:fs';

type Anchor = [number, number];
interface BpEntry {
  slug: string;
  name: string;
  type?: string;
  path_type?: string;
  member_of?: string;
  highway?: string;
  bicycle?: string;
  surface?: string;
  lit?: string;
  anchors?: Anchor[];
  osm_way_ids?: number[];
  members?: string[];
}
interface BikePathsYml { bike_paths?: BpEntry[] }

const bp = yaml.load(fs.readFileSync('/home/dev/code/bike-routes/ottawa/bikepaths.yml', 'utf-8')) as BikePathsYml;

const STREET_WORDS = ['street', 'avenue', 'road', 'drive', 'lane', 'crescent', 'boulevard', 'rue ', 'chemin', 'way', 'place', 'court', 'circle', 'path ', 'route', 'highway'];

function classify(e: BpEntry): string {
  const ways = (e.osm_way_ids ?? []).length;
  const type = e.type ?? '';
  const pt = e.path_type ?? '';
  const name = (e.name ?? '').toLowerCase();
  const hasMember = !!e.member_of;
  const hasMembers = (e.members ?? []).length > 0;
  const looksLikeStreet = STREET_WORDS.some((w) => name.includes(w));

  if (type === 'network' || hasMembers) return 'NETWORK';
  if (type === 'long-distance') return 'LONG_DISTANCE';
  if (hasMember) return 'NETWORK_MEMBER';
  if (pt === 'mtb-trail') return 'MTB_STANDALONE';

  if (type === 'infrastructure') {
    if (pt === 'bike-lane' || pt === 'separated-lane' || pt === 'paved-shoulder') return 'BIKELANE_ON_ROAD';
    if (looksLikeStreet) return 'ROAD_AS_PATH';
    return 'INFRASTRUCTURE_OTHER';
  }
  if (type === 'connector') {
    if (ways <= 2 && looksLikeStreet) return 'STREET_CONNECTOR';
    return 'CONNECTOR_OTHER';
  }
  if (type === 'destination' && ways <= 2 && looksLikeStreet) return 'SHORT_DESTINATION_STREETNAMED';
  if (type === 'destination') return 'DESTINATION_STANDALONE';
  return 'UNCLASSIFIED';
}

const buckets = new Map<string, BpEntry[]>();
for (const e of bp.bike_paths ?? []) {
  const c = classify(e);
  let arr = buckets.get(c);
  if (!arr) { arr = []; buckets.set(c, arr); }
  arr.push(e);
}

console.log('=== CANDIDATE CLASSIFICATION ===');
for (const [k, arr] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${k}: ${arr.length}`);
}

const nonObvious = ['STREET_CONNECTOR', 'BIKELANE_ON_ROAD', 'ROAD_AS_PATH', 'INFRASTRUCTURE_OTHER', 'CONNECTOR_OTHER', 'SHORT_DESTINATION_STREETNAMED', 'DESTINATION_STANDALONE'];
console.log('\n=== SAMPLES PER BUCKET (non-obvious buckets) ===');
for (const bucket of nonObvious) {
  const arr = buckets.get(bucket) ?? [];
  if (arr.length === 0) continue;
  console.log(`\n--- ${bucket} (${arr.length} entries) — first 15 ---`);
  for (const e of arr.slice(0, 15)) {
    const anchor = e.anchors?.[0];
    console.log(`  ${e.slug}  "${e.name}"`);
    console.log(`    ways=${(e.osm_way_ids ?? []).length} highway=${e.highway ?? '-'} bicycle=${e.bicycle ?? '-'} surface=${e.surface ?? '-'} lit=${e.lit ?? '-'}`);
    console.log(`    type=${e.type} path_type=${e.path_type} member_of=${e.member_of ?? '-'} anchor=${anchor ? anchor[1].toFixed(3) : '?'},${anchor ? anchor[0].toFixed(3) : '?'}`);
  }
}

console.log('\n=== ALL DESTINATION_STANDALONE ENTRIES ===');
const dest = (buckets.get('DESTINATION_STANDALONE') ?? []).sort((a, b) => (b.osm_way_ids?.length ?? 0) - (a.osm_way_ids?.length ?? 0));
for (const e of dest) {
  const a = e.anchors?.[0];
  const w = (e.osm_way_ids ?? []).length;
  const latStr = a ? a[1].toFixed(3) : '?';
  console.log(`  ${e.slug}  "${e.name}"  ${w}w  ${e.path_type ?? ''}  ${e.highway ?? ''}${e.bicycle ? '/' + e.bicycle : ''}  lat=${latStr}`);
}
