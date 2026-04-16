/**
 * Print the current bike-path information architecture as a tree — for
 * human review. Reads bikepaths.yml, classifies each entry into a tab using
 * the same heuristic the pipeline/presentation layer uses today, then
 * prints the tree:
 *
 *   [tab name]
 *   📁 [network name]
 *     — [path name]
 *     · [segment name]        (standalone:false members)
 *   (no network)
 *     — [path name]
 *   (orphans — member_of in a different tab)
 *
 * Usage:
 *   npx tsx scripts/print-ia-tree.ts [path/to/bikepaths.yml]
 *
 * Default path: ~/code/bike-routes/ottawa/bikepaths.yml
 */
import yaml from 'js-yaml';
import fs from 'node:fs';

interface BpEntry {
  slug: string;
  name: string;
  type?: string;
  path_type?: string;
  member_of?: string;
  listed?: boolean;
  standalone?: boolean;
  osm_way_ids?: number[];
  members?: string[];
}
interface BikePathsYml { bike_paths?: BpEntry[] }

type Tab = 'pathways' | 'bikeways' | 'local_trails' | 'long_distance_trails' | 'mtb' | 'uncategorized';

const DEFAULT_BIKEPATHS = '/home/dev/code/bike-routes/ottawa/bikepaths.yml';
const BIKEPATHS = process.argv[2] ?? DEFAULT_BIKEPATHS;
const bp = yaml.load(fs.readFileSync(BIKEPATHS, 'utf-8')) as BikePathsYml;
const entries = bp.bike_paths ?? [];

function classifyByPathType(e: BpEntry): Tab | null {
  if (e.type === 'long-distance') return 'long_distance_trails';
  if (e.path_type === 'mtb-trail') return 'mtb';
  if (e.path_type === 'trail') return 'local_trails';
  if (e.path_type === 'bike-lane' || e.path_type === 'separated-lane' || e.path_type === 'paved-shoulder') return 'bikeways';
  if (e.path_type === 'mup') return 'pathways';
  return null;
}

function classifyTab(e: BpEntry, all: BpEntry[]): Tab {
  const direct = classifyByPathType(e);
  if (direct) return direct;
  const members: BpEntry[] = [];
  for (const s of e.members ?? []) {
    const m = all.find((x) => x.slug === s);
    if (m) members.push(m);
  }
  for (const m of all.filter((x) => x.member_of === e.slug)) if (!members.includes(m)) members.push(m);
  const counts: Record<string, number> = {};
  for (const m of members) {
    const t = classifyByPathType(m);
    if (t) counts[t] = (counts[t] ?? 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (ranked.length > 0) return ranked[0][0] as Tab;
  return 'uncategorized';
}

const byTab = new Map<Tab, BpEntry[]>();
for (const e of entries) {
  const t = classifyTab(e, entries);
  let arr = byTab.get(t);
  if (!arr) { arr = []; byTab.set(t, arr); }
  arr.push(e);
}

const tabOrder: Tab[] = ['pathways', 'bikeways', 'local_trails', 'long_distance_trails', 'mtb', 'uncategorized'];

function displayName(e: BpEntry): string { return e.name || e.slug; }
function summary(e: BpEntry): string {
  const bits: string[] = [];
  const w = (e.osm_way_ids ?? []).length;
  if (w > 0) bits.push(`${w}w`);
  if (e.path_type) bits.push(e.path_type);
  if (e.type && e.type !== 'destination') bits.push(e.type);
  if (e.listed === false) bits.push('HIDDEN');
  if (e.standalone === false) bits.push('segment');
  return bits.join(' · ');
}

for (const tab of tabOrder) {
  const tabEntries = byTab.get(tab) ?? [];
  if (tabEntries.length === 0) continue;
  console.log(`\n━━━ ${tab.toUpperCase()} (${tabEntries.length} entries) ━━━`);

  const networks = tabEntries.filter((e) => e.type === 'network' || (e.members ?? []).length > 0);
  const networkSlugs = new Set(networks.map((n) => n.slug));
  const memberSlugs = new Set<string>();
  for (const n of networks) for (const m of n.members ?? []) memberSlugs.add(m);
  for (const e of tabEntries) if (e.member_of && networkSlugs.has(e.member_of)) memberSlugs.add(e.slug);
  const standalones = tabEntries.filter((e) => !networkSlugs.has(e.slug) && !memberSlugs.has(e.slug) && !e.member_of);
  const orphans = tabEntries.filter((e) => e.member_of && !networkSlugs.has(e.member_of) && !memberSlugs.has(e.slug));

  for (const n of networks.sort((a, b) => displayName(a).localeCompare(displayName(b)))) {
    console.log(`\n📁 ${displayName(n)}  [${n.slug}]`);
    const s = summary(n);
    if (s) console.log(`    (${s})`);
    const map = new Map<string, BpEntry>();
    for (const sm of n.members ?? []) { const m = entries.find((x) => x.slug === sm); if (m) map.set(m.slug, m); }
    for (const m of entries.filter((x) => x.member_of === n.slug)) map.set(m.slug, m);
    const members = [...map.values()].sort((a, b) => displayName(a).localeCompare(displayName(b)));
    if (members.length === 0) {
      console.log('    (no members)');
    } else {
      for (const m of members) {
        const prefix = m.standalone === false ? '· ' : '— ';
        const s2 = summary(m);
        console.log(`  ${prefix}${displayName(m)}  [${m.slug}]  ${s2 ? '(' + s2 + ')' : ''}`);
      }
    }
  }

  if (standalones.length > 0) {
    console.log('\n(no network)');
    for (const sp of standalones.sort((a, b) => displayName(a).localeCompare(displayName(b)))) {
      const s2 = summary(sp);
      console.log(`  — ${displayName(sp)}  [${sp.slug}]  ${s2 ? '(' + s2 + ')' : ''}`);
    }
  }

  if (orphans.length > 0) {
    console.log('\n(orphans — member_of points to a network in a different tab)');
    for (const o of orphans.sort((a, b) => displayName(a).localeCompare(displayName(b)))) {
      const s2 = summary(o);
      console.log(`  — ${displayName(o)}  [${o.slug}]  → member_of=${o.member_of}  ${s2 ? '(' + s2 + ')' : ''}`);
    }
  }
}

console.log('\n━━━ SUMMARY ━━━');
let listed = 0, hidden = 0;
for (const e of entries) { if (e.listed === false) hidden++; else listed++; }
console.log(`Total entries: ${entries.length}  (${listed} listed, ${hidden} hidden)`);
console.log('Tabs:');
for (const t of tabOrder) {
  const c = (byTab.get(t) ?? []).length;
  if (c) console.log(`  ${t}: ${c}`);
}
