/**
 * Generate geo-metadata.json — maps geoId → path metadata for tile generation.
 *
 * Reads bikepaths.yml + markdown to build the same merged pages as the Astro app,
 * then writes a JSON file mapping each geoId to its page metadata.
 *
 * This runs as part of prebuild, after cache-path-geometry and before generate-path-tiles.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { GeoMetaEntry } from './generate-path-tiles';

/** Minimal page shape consumed by buildGeoMetadata. */
export interface GeoMetaPage {
  slug: string;
  name: string;
  geoFiles: string[];
  memberOf?: string;
  surface?: string;
  standalone: boolean;
  path_type?: string;
  length_km?: number;
  /** Present and non-empty when the page is a network aggregating member paths. */
  memberRefs?: unknown[] | undefined;
}

/**
 * Build the geoId → metadata map from the Astro page set.
 *
 * Non-network pages are registered first so member slugs always win over
 * any network page that claims the same geoIds. The natural
 * loadBikePathEntries order cannot be trusted: markdown-only `includes:`
 * networks (e.g. gatineau-cycling-network) can be returned before their
 * members, and without this sort the network slug overwrites each
 * member's slug on its tile features — breaking list-item hover/lock
 * highlighting because the map filter matches nothing.
 */
export function buildGeoMetadata(pages: GeoMetaPage[]): Record<string, GeoMetaEntry> {
  const isNetwork = (p: GeoMetaPage): boolean => (p.memberRefs?.length ?? 0) > 0;
  const sorted = [
    ...pages.filter(p => !isNetwork(p)),
    ...pages.filter(isNetwork),
  ];

  const metadata: Record<string, GeoMetaEntry> = {};
  for (const page of sorted) {
    for (const file of page.geoFiles) {
      const geoId = file.replace(/\.geojson$/, '');
      if (metadata[geoId]) continue; // first-write-wins: non-networks already claimed these
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
  return metadata;
}

// --- CLI entry point ---
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isMainModule) {
  if (!process.env.CITY) {
    console.log('[geo-metadata] No CITY set — skipping');
    process.exit(0);
  }

  const { loadBikePathEntries } = await import('../src/lib/bike-paths/bike-path-entries.server');

  const outDir = path.join('public', 'bike-paths', 'geo');
  const outPath = path.join(outDir, 'geo-metadata.json');

  const { pages } = loadBikePathEntries();
  const metadata = buildGeoMetadata(pages);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(metadata));

  console.log(`[geo-metadata] Wrote metadata for ${Object.keys(metadata).length} geo IDs`);
}
