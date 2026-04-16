/**
 * Golden IA internal consistency check. Run after editing
 * tests/golden/ottawa/*.yaml to catch dangling refs, tier collisions,
 * filter_out vs member conflicts, unknown cross-membership targets.
 *
 * Reports:
 *   - ERRORS (must fix): internal contradictions
 *   - WARNINGS (review): references to networks/paths not declared in golden
 *   - Networks declared in golden but not in bikepaths.yml (pipeline work gap)
 *   - Paths declared in golden but not in bikepaths.yml (pipeline work gap)
 *
 * Exit 1 if errors, 0 otherwise.
 *
 * Usage:
 *   npx tsx scripts/check-golden-consistency.ts
 */
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';

interface GoldenNetwork {
  slug: string;
  tier_1_paths?: string[];
  tier_2_paths?: string[];
  segments?: string[];
}
interface GoldenTab {
  networks?: GoldenNetwork[];
  standalone_paths?: string[];
}
interface GoldenIA {
  tabs?: Record<string, GoldenTab>;
  filter_out?: Array<{ slug: string }>;
  reclassify_as_connector?: Array<{ slug: string }>;
  cross_memberships?: Array<{ slug: string; primary_memberOf: string; also_listed_in?: string[] }>;
  reclassifications?: Array<{ slug: string; to: string }>;
  segments_expectations?: Array<{ slug: string }>;
}
interface BpEntry { slug: string }
interface BikePathsYml { bike_paths?: BpEntry[] }

const GOLDEN_DIR = '/home/dev/code/bike-app-astro/tests/golden/ottawa';
const BIKEPATHS = '/home/dev/code/bike-routes/ottawa/bikepaths.yml';
const files = ['01-pathways.yaml', '02-bikeways.yaml', '03-local-trails.yaml', '04-long-distance.yaml', '05-mtb.yaml', '06-everything-else.yaml'];

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
const merged: Record<string, unknown> = {};
for (const f of files) deepMerge(merged, yaml.load(fs.readFileSync(path.join(GOLDEN_DIR, f), 'utf-8')) as Record<string, unknown>);
const golden = merged as unknown as GoldenIA;

const bp = yaml.load(fs.readFileSync(BIKEPATHS, 'utf-8')) as BikePathsYml;
const bpSlugs = new Set((bp.bike_paths ?? []).map((e) => e.slug));

const errors: string[] = [];
const warnings: string[] = [];

const declaredNetworks = new Set<string>();
const declaredPaths = new Set<string>();
const goldenFilterOut = new Set((golden.filter_out ?? []).map((e) => e.slug));
const goldenConnector = new Set((golden.reclassify_as_connector ?? []).map((e) => e.slug));

for (const [, tab] of Object.entries(golden.tabs ?? {})) {
  for (const net of tab.networks ?? []) {
    declaredNetworks.add(net.slug);
    for (const s of net.tier_1_paths ?? []) declaredPaths.add(s);
    for (const s of net.tier_2_paths ?? []) declaredPaths.add(s);
    for (const s of net.segments ?? []) declaredPaths.add(s);
  }
  for (const s of tab.standalone_paths ?? []) declaredPaths.add(s);
}

// Tier collisions + duplicates within tier
for (const [tabKey, tab] of Object.entries(golden.tabs ?? {})) {
  for (const net of tab.networks ?? []) {
    const t1 = new Set(net.tier_1_paths ?? []);
    const t2 = new Set(net.tier_2_paths ?? []);
    for (const s of t1) if (t2.has(s)) errors.push(`${tabKey}/${net.slug}: ${s} in both tier_1 and tier_2`);
    const t1arr = net.tier_1_paths ?? [];
    for (let i = 0; i < t1arr.length; i++) for (let j = i + 1; j < t1arr.length; j++) {
      if (t1arr[i] === t1arr[j]) errors.push(`${tabKey}/${net.slug}: duplicate ${t1arr[i]} in tier_1_paths`);
    }
    const t2arr = net.tier_2_paths ?? [];
    for (let i = 0; i < t2arr.length; i++) for (let j = i + 1; j < t2arr.length; j++) {
      if (t2arr[i] === t2arr[j]) errors.push(`${tabKey}/${net.slug}: duplicate ${t2arr[i]} in tier_2_paths`);
    }
  }
}

// filter_out / connector conflicts with declared membership
for (const fo of goldenFilterOut) {
  if (declaredPaths.has(fo)) errors.push(`${fo} appears in filter_out AND as a network member`);
  if (declaredNetworks.has(fo)) errors.push(`${fo} appears in filter_out AND as a network head`);
}
for (const c of goldenConnector) {
  if (declaredPaths.has(c)) errors.push(`${c} appears in reclassify_as_connector AND as a network member`);
  if (declaredNetworks.has(c)) errors.push(`${c} appears in reclassify_as_connector AND as a network head`);
  if (goldenFilterOut.has(c)) errors.push(`${c} appears in reclassify_as_connector AND filter_out`);
}

// Cross-membership sanity
for (const cm of golden.cross_memberships ?? []) {
  if (!cm.slug) { errors.push('cross_memberships entry missing slug'); continue; }
  if (cm.primary_memberOf && !declaredNetworks.has(cm.primary_memberOf)) {
    warnings.push(`cross_memberships/${cm.slug}: primary_memberOf=${cm.primary_memberOf} not declared as a golden network`);
  }
  for (const also of cm.also_listed_in ?? []) {
    if (!declaredNetworks.has(also)) warnings.push(`cross_memberships/${cm.slug}: also_listed_in ${also} not declared as a golden network`);
  }
}

// Reclassifications point at known targets
for (const r of golden.reclassifications ?? []) {
  if (!r.to) { errors.push(`reclassifications/${r.slug}: missing 'to'`); continue; }
  const [tab, target] = r.to.split('/');
  if (!golden.tabs?.[tab]) warnings.push(`reclassifications/${r.slug}: target tab "${tab}" not in golden`);
  else if (target !== 'standalone' && !declaredNetworks.has(target)) {
    warnings.push(`reclassifications/${r.slug}: target network "${target}" not in golden`);
  }
}

// segments_expectations refs
for (const se of golden.segments_expectations ?? []) {
  if (!declaredPaths.has(se.slug) && !declaredNetworks.has(se.slug) && !bpSlugs.has(se.slug)) {
    warnings.push(`segments_expectations/${se.slug}: not declared in golden, not in bikepaths.yml`);
  }
}

// filter_out / connector slugs should exist in bikepaths.yml (or the golden is already resolved)
for (const fo of goldenFilterOut) if (!bpSlugs.has(fo)) warnings.push(`filter_out/${fo}: not in bikepaths.yml`);
for (const c of goldenConnector) if (!bpSlugs.has(c)) warnings.push(`reclassify_as_connector/${c}: not in bikepaths.yml`);

// Gap lists — informational
const networksMissing = [...declaredNetworks].filter((n) => !bpSlugs.has(n)).sort();
const pathsMissing = [...declaredPaths].filter((p) => !bpSlugs.has(p)).sort();

console.log('\n=== ERRORS (must fix) ===');
if (errors.length === 0) console.log('none');
for (const e of errors) console.log('  ✗', e);

console.log('\n=== WARNINGS (review) ===');
if (warnings.length === 0) console.log('none');
for (const w of warnings) console.log('  ⚠', w);

console.log('\n=== Networks declared in golden but not yet produced by pipeline ===');
console.log('(Stage 1.5+ pipeline work creates these.)');
for (const n of networksMissing) console.log('  •', n);

console.log('\n=== Path slugs declared in golden but not in current bikepaths.yml ===');
console.log('(Pipeline produces these in Stage 2 or via decomposition.)');
for (const p of pathsMissing) console.log('  •', p);

console.log('\n=== SUMMARY ===');
console.log(`Errors: ${errors.length}, Warnings: ${warnings.length}`);
console.log(`Networks declared: ${declaredNetworks.size}, missing from bikepaths.yml: ${networksMissing.length}`);
console.log(`Paths declared: ${declaredPaths.size}, missing from bikepaths.yml: ${pathsMissing.length}`);
console.log(`filter_out: ${goldenFilterOut.size}, reclassify_as_connector: ${goldenConnector.size}`);

process.exit(errors.length > 0 ? 1 : 0);
