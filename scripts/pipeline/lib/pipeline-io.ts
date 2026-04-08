// scripts/pipeline/lib/pipeline-io.ts
//
// Filesystem I/O for the pipeline: manual entries, markdown slugs/overrides, YAML output.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
// Note: do NOT import slugify here — none of the extracted functions use it.

export function loadManualEntries(dataDir: string) {
  const manualPath = path.join(dataDir, 'manual-entries.yml');
  if (!fs.existsSync(manualPath)) return [];
  const data = yaml.load(fs.readFileSync(manualPath, 'utf8')) as any;
  const entries = data?.manual_entries || [];
  if (entries.length > 0) {
    console.log(`  Loaded ${entries.length} manual entries`);
  }
  return entries;
}

export function loadMarkdownSlugs(dataDir: string) {
  const bikePathsDir = path.join(dataDir, 'bike-paths');
  const slugs = new Set<string>();
  if (fs.existsSync(bikePathsDir)) {
    for (const f of fs.readdirSync(bikePathsDir)) {
      if (!f.endsWith('.md') || f.includes('.fr.')) continue;
      slugs.add(f.replace(/\.md$/, ''));
      // Parse includes from frontmatter — claims those slugs too
      try {
        const content = fs.readFileSync(path.join(bikePathsDir, f), 'utf8');
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const includes = fmMatch[1].match(/includes:\n((?:\s+-\s+.+\n?)*)/);
          if (includes) {
            for (const line of includes[1].split('\n')) {
              const slug = line.replace(/^\s+-\s+/, '').trim();
              if (slug) slugs.add(slug);
            }
          }
        }
      } catch {}
    }
  }
  return slugs;
}

// Fields that markdown frontmatter can override on bikepaths.yml entries.
// member_of has special handling (network reassignment). Everything else
// is a simple field overwrite — if a human puts it in markdown, it wins.
export const MARKDOWN_OVERRIDE_FIELDS = [
  'member_of', 'operator', 'path_type', 'type',
];

export function parseMarkdownOverrides(bikePathsDir: string) {
  const overrides = new Map<string, Record<string, any>>();
  if (!bikePathsDir || !fs.existsSync(bikePathsDir)) return overrides;
  for (const f of fs.readdirSync(bikePathsDir).filter(f => f.endsWith('.md') && !f.includes('.fr.'))) {
    const content = fs.readFileSync(path.join(bikePathsDir, f), 'utf8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    let fm: any;
    try { fm = yaml.load(fmMatch[1]); } catch { continue; }
    const mdSlug = f.replace('.md', '');
    const override: Record<string, any> = {};
    for (const field of MARKDOWN_OVERRIDE_FIELDS) {
      if (fm?.[field] != null) override[field] = fm[field];
    }
    if (Object.keys(override).length > 0) overrides.set(mdSlug, override);
  }
  return overrides;
}

export function writeYaml(
  entries: any[],
  superNetworks: any[],
  bikepathsPath: string,
  slugMap: Map<any, string>,
): void {
  // Strip transient fields
  for (const entry of entries) {
    delete entry._ways;
    delete entry._member_relations;
    if (entry._parkName) { entry.park = entry._parkName; }
    delete entry._parkName;
    delete entry._discovery_source;
    delete entry._isUnnamedChain;
  }
  // Compact anchors to bbox
  for (const entry of entries) {
    if (entry.anchors?.length > 2) {
      const lngs = entry.anchors.map((a: number[]) => a[0]);
      const lats = entry.anchors.map((a: number[]) => a[1]);
      entry.anchors = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
    }
  }
  // Final cleanup: strip member_of from large detached long-distance entries
  for (const entry of entries) {
    if (entry.type === 'long-distance' && entry.member_of && (entry.osm_way_ids?.length ?? 0) >= 200) {
      delete entry.member_of;
    }
  }
  const yamlData: Record<string, any> = { bike_paths: entries };
  if (superNetworks.length > 0) yamlData.super_networks = superNetworks;
  const output = yaml.dump(yamlData, { lineWidth: -1, noRefs: true });
  fs.writeFileSync(bikepathsPath, output);
  const networkEntries = entries.filter(e => e.type === 'network');
  const memberEntries = entries.filter(e => e.member_of);
  console.log(`\nWrote ${entries.length} entries (${networkEntries.length} networks, ${memberEntries.length} members) to ${bikepathsPath}`);
}
