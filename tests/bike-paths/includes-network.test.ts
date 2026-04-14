/**
 * Integration test: markdown includes: pages should display as networks.
 *
 * Calls loadBikePathEntries() with real Ottawa data to verify that
 * markdown grouping pages (like gatineau-cycling-network) get memberRefs
 * and appear as expandable networks on the index page.
 *
 * Requires CONTENT_DIR + CITY env vars (set by nix develop / make test).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.env.HOME!, 'code', 'bike-routes');
const CITY = process.env.CITY || 'ottawa';
const ymlPath = path.join(CONTENT_DIR, CITY, 'bikepaths.yml');
const canRun = fs.existsSync(ymlPath);

// Dynamic import to avoid blowing up when env isn't set
let pages: any[];

beforeAll(async () => {
  if (!canRun) return;
  const { loadBikePathEntries } = await import('../../src/lib/bike-paths/bike-path-entries.server');
  const result = loadBikePathEntries();
  pages = result.pages;
});

function page(slug: string) {
  const p = pages.find((p: any) => p.slug === slug);
  expect(p, `page ${slug} must exist`).toBeDefined();
  return p;
}

describe.skipIf(!canRun)('markdown includes: pages display as networks', () => {
  it('gatineau-cycling-network has memberRefs', () => {
    const p = page('gatineau-cycling-network');
    expect(p.memberRefs, 'includes: page should have memberRefs like a network').toBeDefined();
    expect(p.memberRefs.length).toBeGreaterThanOrEqual(2);
  });

  it('gatineau-cycling-network members are Gatineau-side paths', () => {
    const p = page('gatineau-cycling-network');
    const memberSlugs = (p.memberRefs ?? []).map((m: any) => m.slug);
    // These are in the markdown's includes: list
    expect(memberSlugs).toContain('sentier-du-ruisseau-de-la-brasserie-pathway');
    expect(memberSlugs).toContain('sentier-du-lac-leamy-pathway');
    expect(memberSlugs).toContain('confederation-pathway');
  });

  it('gatineau-cycling-network is listed and standalone', () => {
    const p = page('gatineau-cycling-network');
    expect(p.listed).toBe(true);
    expect(p.standalone).toBe(true);
  });
});
