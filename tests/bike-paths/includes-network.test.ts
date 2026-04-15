/**
 * Integration test: markdown includes: pages should display as networks.
 *
 * Uses the demo city fixture (bike-routes/demo/) — runs with any
 * CONTENT_DIR that has a demo city. No env var hacks, no skipIf.
 */
import { describe, it, expect, beforeAll } from 'vitest';

let pages: any[];

beforeAll(async () => {
  process.env.CITY = 'demo';
  const mod = await import('../../src/lib/bike-paths/bike-path-entries.server');
  if ('_clearCache' in mod) (mod as any)._clearCache();
  const result = mod.loadBikePathEntries();
  pages = result.pages;
});

function page(slug: string) {
  const p = pages.find((p: any) => p.slug === slug);
  expect(p, `page ${slug} must exist`).toBeDefined();
  return p;
}

describe('markdown includes: pages display as networks', () => {
  it('red-costera has memberRefs', () => {
    const p = page('red-costera');
    expect(p.memberRefs, 'includes: page should have memberRefs like a network').toBeDefined();
    expect(p.memberRefs.length).toBeGreaterThanOrEqual(2);
  });

  it('red-costera members match the includes list', () => {
    const p = page('red-costera');
    const memberSlugs = (p.memberRefs ?? []).map((m: any) => m.slug);
    expect(memberSlugs).toContain('sendero-del-lago');
    expect(memberSlugs).toContain('sendero-del-parque');
  });

  it('red-costera is listed and standalone', () => {
    const p = page('red-costera');
    expect(p.listed).toBe(true);
    expect(p.standalone).toBe(true);
  });

  it('included entries still have their own pages', () => {
    const lago = page('sendero-del-lago');
    expect(lago.standalone).toBe(true);
    const parque = page('sendero-del-parque');
    expect(parque.standalone).toBe(true);
  });
});
