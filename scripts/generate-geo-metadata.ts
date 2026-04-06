/**
 * Generate geo-metadata.json — maps geoId → path metadata for tile generation.
 *
 * Reads bikepaths.yml + markdown to build the same merged pages as the Astro app,
 * then writes a JSON file mapping each geoId to its page metadata.
 *
 * This runs as part of prebuild, after copy-path-geometry and before generate-path-tiles.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { GeoMetaEntry } from './generate-path-tiles';

if (!process.env.CITY) {
  console.log('[geo-metadata] No CITY set — skipping');
  process.exit(0);
}

const { loadBikePathEntries } = await import('../src/lib/bike-paths/bike-path-entries.server');

const outDir = path.join('public', 'bike-paths', 'geo');
const outPath = path.join(outDir, 'geo-metadata.json');

const { pages } = loadBikePathEntries();

const metadata: Record<string, GeoMetaEntry> = {};

// Member pages are processed before network pages (loadBikePathEntries order).
// Network pages aggregate their members' geoFiles, so without first-write-wins
// the network slug would overwrite the member slug for shared geoIds.
for (const page of pages) {
  for (const file of page.geoFiles) {
    const geoId = file.replace(/\.geojson$/, '');
    if (metadata[geoId]) continue; // member already registered this geoId
    metadata[geoId] = {
      slug: page.slug,
      name: page.name,
      memberOf: page.memberOf ?? '',
      surface: page.surface ?? '',
      hasPage: page.standalone,
      path_type: page.path_type ?? '',
      length_km: page.length_km ?? 0,
    };
  }
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(metadata));

console.log(`[geo-metadata] Wrote metadata for ${Object.keys(metadata).length} geo IDs`);
