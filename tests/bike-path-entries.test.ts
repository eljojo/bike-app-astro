import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Create temp dir at module scope — vi.hoisted ensures it's available for vi.mock
const { tmpDir, cityPath } = vi.hoisted(() => {
  const _fs = require('node:fs');
  const _path = require('node:path');
  const _os = require('node:os');
  const tmpDir = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'bike-path-entries-test-'));
  const cityPath = _path.join(tmpDir, 'testcity');
  return { tmpDir, cityPath };
});

vi.stubEnv('CITY', 'testcity');
vi.stubEnv('CONTENT_DIR', tmpDir);

// Mock config.server so cityDir points at our fixture directory.
// This must use vi.mock (hoisted) since the module is imported at load time.
vi.mock('../src/lib/config/config.server', () => ({
  CONTENT_DIR: tmpDir,
  cityDir: cityPath,
}));

import { loadBikePathEntries } from '../src/lib/bike-paths/bike-path-entries.server';

beforeAll(() => {
  const bikePathsDir = path.join(cityPath, 'bike-paths');
  fs.mkdirSync(bikePathsDir, { recursive: true });

  // Create bikepaths.yml with test entries
  fs.writeFileSync(path.join(cityPath, 'bikepaths.yml'), `bike_paths:
  - name: Ottawa River Pathway
    osm_relations: [7174864]
    network: rcn
    operator: NCC
    highway: cycleway
    surface: asphalt
    name_en: Ottawa River Pathway
    name_fr: Sentier de la riviere des Outaouais
  - name: Rideau Canal Pathway
    osm_relations: [1234567]
    network: rcn
    operator: NCC
    highway: cycleway
    surface: asphalt
  - name: Small Local Path
    highway: cycleway
  - name: Some Random Road
    highway: tertiary
  - name: Claimed By Includes
    osm_relations: [9999999]
    network: rcn
    operator: City
    highway: cycleway
`);

  // Markdown that matches a YML entry by slug
  fs.writeFileSync(path.join(bikePathsDir, 'rideau-canal-pathway.md'), `---
name: Rideau Canal Pathway
name_fr: Sentier du canal Rideau
vibe: A gentle ride along the canal
tags:
  - scenic
  - flat
photo_key: rideau-canal-photo
featured: true
---
The Rideau Canal Pathway runs along the historic canal.
`);

  // Markdown that uses includes to claim a YML entry
  fs.writeFileSync(path.join(bikePathsDir, 'combined-pathways.md'), `---
name: Combined Pathways
includes:
  - claimed-by-includes
tags:
  - combined
---
This page combines multiple YML entries.
`);

  // Hidden markdown (should be excluded)
  fs.writeFileSync(path.join(bikePathsDir, 'hidden-path.md'), `---
name: Hidden Path
hidden: true
---
This should not appear.
`);

  // Markdown with no matching YML entry
  fs.writeFileSync(path.join(bikePathsDir, 'standalone-guide.md'), `---
name: Standalone Guide
tags:
  - guide
stub: true
---
A guide with no YML backing.
`);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadBikePathEntries', () => {
  it('returns correct structure with pages, allYmlEntries, geoFiles arrays', () => {
    const result = loadBikePathEntries();
    expect(Array.isArray(result.pages)).toBe(true);
    expect(Array.isArray(result.allYmlEntries)).toBe(true);
    expect(Array.isArray(result.geoFiles)).toBe(true);
  });

  it('is synchronous — does not return a Promise', () => {
    const result = loadBikePathEntries();
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.pages).toBeDefined();
  });

  it('parses all YML entries', () => {
    const { allYmlEntries } = loadBikePathEntries();
    expect(allYmlEntries.length).toBe(5);
    expect(allYmlEntries.map(e => e.name)).toContain('Ottawa River Pathway');
    expect(allYmlEntries.map(e => e.name)).toContain('Rideau Canal Pathway');
  });

  it('every page has required fields', () => {
    const { pages } = loadBikePathEntries();
    for (const page of pages) {
      expect(typeof page.slug).toBe('string');
      expect(page.slug.length).toBeGreaterThan(0);
      expect(typeof page.name).toBe('string');
      expect(Array.isArray(page.tags)).toBe(true);
      expect(Array.isArray(page.ymlEntries)).toBe(true);
      expect(Array.isArray(page.osmRelationIds)).toBe(true);
      expect(Array.isArray(page.geoFiles)).toBe(true);
      expect(Array.isArray(page.points)).toBe(true);
      expect(typeof page.score).toBe('number');
      expect(typeof page.hasMarkdown).toBe('boolean');
      expect(typeof page.stub).toBe('boolean');
      expect(typeof page.featured).toBe('boolean');
    }
  });

  it('tier 2 relation fields default to empty', () => {
    const { pages } = loadBikePathEntries();
    for (const page of pages) {
      expect(page.routeCount).toBe(0);
      expect(page.overlappingRoutes).toEqual([]);
      expect(page.nearbyPhotos).toEqual([]);
      expect(page.nearbyPlaces).toEqual([]);
      expect(page.nearbyPaths).toEqual([]);
      expect(page.connectedPaths).toEqual([]);
      expect(page.elevation_gain_m).toBeUndefined();
    }
  });

  it('markdown pages claim YML slugs — no duplicate slugs across pages', () => {
    const { pages } = loadBikePathEntries();
    const slugs = pages.map(p => p.slug);
    const uniqueSlugs = new Set(slugs);
    expect(slugs.length).toBe(uniqueSlugs.size);
  });

  it('excludes hidden markdown entries', () => {
    const { pages } = loadBikePathEntries();
    const slugs = pages.map(p => p.slug);
    expect(slugs).not.toContain('hidden-path');
  });

  it('merges markdown with matching YML entry by slug', () => {
    const { pages } = loadBikePathEntries();
    const rideau = pages.find(p => p.slug === 'rideau-canal-pathway');
    expect(rideau).toBeDefined();
    expect(rideau!.hasMarkdown).toBe(true);
    expect(rideau!.name).toBe('Rideau Canal Pathway');
    expect(rideau!.name_fr).toBe('Sentier du canal Rideau');
    expect(rideau!.vibe).toBe('A gentle ride along the canal');
    expect(rideau!.tags).toEqual(['scenic', 'flat']);
    expect(rideau!.photo_key).toBe('rideau-canal-photo');
    expect(rideau!.featured).toBe(true);
    expect(rideau!.body).toContain('Rideau Canal Pathway runs along');
    expect(rideau!.osmRelationIds).toEqual([1234567]);
    expect(rideau!.ymlEntries.length).toBe(1);
  });

  it('markdown includes claim YML entries by slug', () => {
    const { pages } = loadBikePathEntries();
    const combined = pages.find(p => p.slug === 'combined-pathways');
    expect(combined).toBeDefined();
    expect(combined!.hasMarkdown).toBe(true);
    expect(combined!.ymlEntries.length).toBe(1);
    expect(combined!.ymlEntries[0].name).toBe('Claimed By Includes');
    expect(combined!.osmRelationIds).toEqual([9999999]);

    // The claimed slug should not appear as a separate page
    const claimedPage = pages.find(p => p.slug === 'claimed-by-includes');
    expect(claimedPage).toBeUndefined();
  });

  it('excludes hard-excluded YML entries (tertiary road)', () => {
    const { pages } = loadBikePathEntries();
    const road = pages.find(p => p.slug === 'some-random-road');
    expect(road).toBeUndefined();
  });

  it('includes low-scoring YML entries as Tier 1 candidates (route overlaps may rescue them)', () => {
    const { pages } = loadBikePathEntries();
    // "Small Local Path" has highway: cycleway only -> score 1, passes TIER1_MIN_SCORE (1)
    // It's a Tier 1 candidate — Tier 2 in build-data-plugin will re-score with real overlap data
    const small = pages.find(p => p.slug === 'small-local-path');
    expect(small).toBeDefined();
    expect(small!.score).toBe(1);
    expect(small!.hasMarkdown).toBe(false);
  });

  it('includes high-scoring unclaimed YML entries without markdown', () => {
    const { pages } = loadBikePathEntries();
    const ottawa = pages.find(p => p.slug === 'ottawa-river-pathway');
    expect(ottawa).toBeDefined();
    expect(ottawa!.hasMarkdown).toBe(false);
    expect(ottawa!.score).toBeGreaterThanOrEqual(4);
    expect(ottawa!.osmRelationIds).toEqual([7174864]);
  });

  it('standalone markdown with no YML match is included', () => {
    const { pages } = loadBikePathEntries();
    const guide = pages.find(p => p.slug === 'standalone-guide');
    expect(guide).toBeDefined();
    expect(guide!.hasMarkdown).toBe(true);
    expect(guide!.stub).toBe(true);
    expect(guide!.ymlEntries.length).toBe(0);
  });
});
