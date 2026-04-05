/**
 * Tests that prove how the data model handles paths belonging to multiple networks.
 *
 * Real-world scenario: Watts Creek Pathway is physically part of both the NCC Greenbelt
 * and Capital Pathway networks. The pipeline assigns it member_of: ncc-greenbelt (one
 * network), but both networks list it in their members array.
 *
 * These tests verify what the data model produces in this situation, and whether
 * the URLs generated for network members correspond to pages that actually exist.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// --------------------------------------------------------------------------
// Fixture setup — mirrors the real Watts Creek / Greenbelt / Capital Pathway case
// --------------------------------------------------------------------------

const { tmpDir, cityPath } = vi.hoisted(() => {
  const _fs = require('node:fs');
  const _path = require('node:path');
  const _os = require('node:os');
  const tmpDir = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'bike-path-membership-test-'));
  const cityPath = _path.join(tmpDir, 'testcity');
  return { tmpDir, cityPath };
});

vi.stubEnv('CITY', 'testcity');
vi.stubEnv('CONTENT_DIR', tmpDir);

vi.mock('../src/lib/config/config.server', () => ({
  CONTENT_DIR: tmpDir,
  cityDir: cityPath,
}));

import { loadBikePathEntries, type BikePathPage } from '../src/lib/bike-paths/bike-path-entries.server';

beforeAll(() => {
  const bikePathsDir = path.join(cityPath, 'bike-paths');
  fs.mkdirSync(bikePathsDir, { recursive: true });

  fs.writeFileSync(path.join(cityPath, 'bikepaths.yml'), `bike_paths:
  # Path in one network only — the simple case
  - name: Rideau Canal Pathway
    member_of: ncc-greenbelt
    osm_relations: [100]
    highway: cycleway
    surface: asphalt

  # Path physically in TWO networks, assigned to one by the pipeline
  - name: Watts Creek Pathway
    member_of: ncc-greenbelt
    osm_relations: [200]
    highway: cycleway
    surface: asphalt

  # Path in one network only
  - name: Experimental Farm Pathway
    member_of: capital-pathway
    osm_relations: [300]
    highway: cycleway
    surface: asphalt

  # Network A — NCC Greenbelt
  - name: NCC Greenbelt
    type: network
    members:
      - rideau-canal-pathway
      - watts-creek-pathway
    operator: NCC
    highway: cycleway

  # Network B — Capital Pathway
  # Lists watts-creek-pathway because it's physically part of this network too
  - name: Capital Pathway
    type: network
    members:
      - watts-creek-pathway
      - experimental-farm-pathway
    operator: NCC
    highway: cycleway
`);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function getPages() {
  return loadBikePathEntries().pages;
}

function getNetworks(pages: BikePathPage[]) {
  return pages.filter(p => p.memberRefs && p.memberRefs.length > 0);
}

function getPage(pages: BikePathPage[], slug: string) {
  return pages.find(p => p.slug === slug);
}

// --------------------------------------------------------------------------
// Hypothesis 1: multi-membership exists in the data structure
// --------------------------------------------------------------------------

describe('multi-network membership exists', () => {
  it('watts creek appears in ncc-greenbelt memberRefs', () => {
    const pages = getPages();
    const greenbelt = getPage(pages, 'ncc-greenbelt')!;
    const memberSlugs = greenbelt.memberRefs!.map(m => m.slug);
    expect(memberSlugs).toContain('watts-creek-pathway');
  });

  it('watts creek appears in capital-pathway memberRefs', () => {
    const pages = getPages();
    const capital = getPage(pages, 'capital-pathway')!;
    const memberSlugs = capital.memberRefs!.map(m => m.slug);
    expect(memberSlugs).toContain('watts-creek-pathway');
  });

  it('watts creek has a single memberOf value', () => {
    const pages = getPages();
    const watts = getPage(pages, 'watts-creek-pathway')!;
    // memberOf is a string, not an array — it can only hold one network
    expect(watts.memberOf).toBe('ncc-greenbelt');
  });
});

// --------------------------------------------------------------------------
// Hypothesis 2: the page system generates exactly one URL per member path
// --------------------------------------------------------------------------

describe('page generation for multi-network members', () => {
  it('member-detail would generate one route per path, using memberOf', () => {
    const pages = getPages();

    // This mirrors the filter in member-detail.astro line 9:
    //   pages.filter(p => p.standalone && p.memberOf)
    // And the params at line 21:
    //   params: { network: page.memberOf!, slug: page.slug }
    const memberPaths = pages.filter(p => p.standalone && p.memberOf);
    const generatedRoutes = memberPaths.map(p => ({
      network: p.memberOf!,
      slug: p.slug,
    }));

    // Watts Creek generates ONE route under ncc-greenbelt
    const wattsRoutes = generatedRoutes.filter(r => r.slug === 'watts-creek-pathway');
    expect(wattsRoutes).toHaveLength(1);
    expect(wattsRoutes[0].network).toBe('ncc-greenbelt');

    // No route is generated for capital-pathway/watts-creek-pathway
    const wattsUnderCapital = generatedRoutes.find(
      r => r.slug === 'watts-creek-pathway' && r.network === 'capital-pathway',
    );
    expect(wattsUnderCapital).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// Hypothesis 3: network member URLs are broken for secondary memberships
//
// This is the core failing test. The sitemap (and index page) generate URLs
// by combining the current network's slug with the member's slug:
//   paths.bikePath(m.slug, net.slug, locale)
//
// But the page only exists under the member's memberOf network. So for
// secondary members, the generated URL points to a page that doesn't exist.
// --------------------------------------------------------------------------

describe('network member URLs must resolve to existing pages', () => {
  it('every standalone memberRef URL corresponds to an actual page', () => {
    const pages = getPages();
    const networks = getNetworks(pages);

    // Build the set of pages that member-detail.astro would actually generate.
    // Each member path generates exactly one page at: /bike-paths/{memberOf}/{slug}
    const memberPaths = pages.filter(p => p.standalone && p.memberOf);
    const existingMemberPages = new Set(
      memberPaths.map(p => `${p.memberOf}/${p.slug}`),
    );

    // Also include standalone paths without memberOf (flat URLs from detail.astro)
    const standalonePages = new Set(
      pages.filter(p => p.standalone && !p.memberOf && !p.memberRefs).map(p => p.slug),
    );

    // Check every network's memberRefs — the URL constructed using the member's
    // memberOf (not the current network slug) must resolve to an actual page.
    // Views must use: paths.bikePath(m.slug, m.memberOf ?? net.slug, locale)
    const brokenLinks: string[] = [];

    for (const net of networks) {
      for (const ref of net.memberRefs!) {
        if (!ref.standalone) continue;

        // Correct URL construction: use member's primary network, fall back to current
        const networkForUrl = ref.memberOf ?? net.slug;
        const memberUrl = `${networkForUrl}/${ref.slug}`;

        const hasNestedPage = existingMemberPages.has(memberUrl);
        const hasFlatPage = standalonePages.has(ref.slug);

        if (!hasNestedPage && !hasFlatPage) {
          brokenLinks.push(
            `${net.name} links to /bike-paths/${memberUrl}/ but no page exists` +
            ` (member's memberOf is ${ref.memberOf ?? 'undefined'})`,
          );
        }
      }
    }

    expect(brokenLinks, `Broken member URLs:\n${brokenLinks.join('\n')}`).toEqual([]);
  });
});
