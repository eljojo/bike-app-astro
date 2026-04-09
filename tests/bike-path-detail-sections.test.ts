/**
 * Structural contract test for the bike path detail page.
 *
 * Asserts that the real Astro-rendered HTML contains the correct sections,
 * facts, and ordering. Runs against built HTML from `dist/` after
 * `CITY=demo astro build`.
 *
 * Uses CSS classes and structural selectors — no data-testid attributes.
 * The demo city (bike-routes/demo/) is the fixture — enrich it to exercise
 * new sections.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseHTML(html: string): Document {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
}

function q(doc: Document, selector: string): Element | null {
  return doc.querySelector(selector);
}

/** Assert element A appears before element B in document order. */
function assertOrder(doc: Document, selectorA: string, selectorB: string) {
  const a = q(doc, selectorA);
  const b = q(doc, selectorB);
  expect(a, `${selectorA} must exist`).not.toBeNull();
  expect(b, `${selectorB} must exist`).not.toBeNull();
  const cmp = a!.compareDocumentPosition(b!);
  expect(cmp & 4, `${selectorA} must come before ${selectorB} in DOM`).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Load built HTML — requires `CITY=demo astro build` to have run
// ---------------------------------------------------------------------------

const DIST = path.resolve('dist', 'client');
const HAS_BUILD = fs.existsSync(
  path.join(DIST, 'bike-paths', 'red-de-ciclovias', 'ciclovia-avenida-ecuador', 'index.html'),
);

function readPage(urlPath: string): Document | null {
  const htmlPath = path.join(DIST, urlPath, 'index.html');
  if (!fs.existsSync(htmlPath)) return null;
  return parseHTML(fs.readFileSync(htmlPath, 'utf-8'));
}

let memberPage: Document;
let standalonePage: Document | null;
let networkPage: Document;

beforeAll(() => {
  if (!HAS_BUILD) return;
  memberPage = readPage('/bike-paths/red-de-ciclovias/ciclovia-avenida-ecuador')!;
  standalonePage = readPage('/bike-paths/ruta-rio-chillan');
  networkPage = readPage('/bike-paths/red-de-ciclovias')!;
});

// ---------------------------------------------------------------------------
// Member page — section presence
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_BUILD)('member page sections', () => {
  it('has a title', () => {
    const h1 = q(memberPage, '.bike-path-title h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toContain('Ciclovía Avenida Ecuador');
  });

  it('has a network badge linking to parent', () => {
    const badge = q(memberPage, '.network-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Red de Ciclovías');
    expect(badge!.getAttribute('href')).toContain('red-de-ciclovias');
  });

  it('has vibe text from markdown', () => {
    const vibe = q(memberPage, '.bike-path-vibe');
    expect(vibe).not.toBeNull();
    expect(vibe!.textContent).toContain('Ciclovía que cruza el centro');
  });

  it('has a map', () => {
    expect(q(memberPage, '.bike-path-sidebar-map') || q(memberPage, '.network-map-full')).not.toBeNull();
  });

  it('has body text', () => {
    const body = q(memberPage, '.bike-path-description');
    expect(body).not.toBeNull();
    expect(body!.textContent).toContain('Avenida Ecuador');
  });

  it('has edit CTA', () => {
    expect(q(memberPage, '.bike-path-edit-cta')).not.toBeNull();
  });

  it('has nearest major path callout', () => {
    const el = q(memberPage, 'a.nearest-major-path');
    expect(el, 'nearest-major-path must exist').not.toBeNull();
    expect(el!.getAttribute('href')).toBeTruthy();
  });

  it('has facts table', () => {
    expect(q(memberPage, '.bike-path-facts-table')).not.toBeNull();
  });

  it('has website link', () => {
    const link = q(memberPage, '.external-link-website');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('ciclovias.chillan.cl');
  });

  it('has wikipedia link', () => {
    const link = q(memberPage, '.external-link-wikipedia');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toContain('wikipedia.org');
  });

  it('has OSM attribution with relation link', () => {
    const osm = q(memberPage, '.bike-path-osm');
    expect(osm).not.toBeNull();
    expect(osm!.innerHTML).toContain('relation/99001');
  });

  it('has back link to network', () => {
    const back = q(memberPage, '.bike-path-back');
    expect(back).not.toBeNull();
    expect(back!.innerHTML).toContain('red-de-ciclovias');
  });
});

// ---------------------------------------------------------------------------
// Member page — facts table completeness
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_BUILD)('member page facts', () => {
  const requiredFacts = [
    'fact-length',
    'fact-path-type',
    'fact-surface',
    'fact-surface-quality',
    'fact-traffic',
    'fact-lighting',
    'fact-network',
    'fact-operator',
    'fact-alongside',
    'fact-ref',
    'fact-established',
  ];

  for (const factClass of requiredFacts) {
    it(`has .${factClass}`, () => {
      expect(q(memberPage, `.bike-path-facts-table .${factClass}`), `missing .${factClass}`).not.toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Member page — section ordering
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_BUILD)('member page section order', () => {
  it('title before vibe', () => assertOrder(memberPage, '.bike-path-title', '.bike-path-vibe'));
  it('title before body', () => assertOrder(memberPage, '.bike-path-title', '.bike-path-description'));
  it('body before nearest major path', () => assertOrder(memberPage, '.bike-path-description', '.nearest-major-path'));
  it('osm attribution before back link', () => assertOrder(memberPage, '.bike-path-osm', '.bike-path-back'));
});

// ---------------------------------------------------------------------------
// Standalone page (Ruta Río Chillán) — osm_way_ids, no network
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_BUILD)('standalone page', () => {
  it('was built', () => {
    expect(standalonePage, 'Ruta Río Chillán page must exist in build output').not.toBeNull();
  });

  it('has no network badge', () => {
    if (!standalonePage) return;
    expect(q(standalonePage, '.network-badge')).toBeNull();
  });

  it('has a map', () => {
    if (!standalonePage) return;
    expect(q(standalonePage, '.bike-path-sidebar-map') || q(standalonePage, '.network-map-full')).not.toBeNull();
  });

  it('has OSM attribution with way link (not text search)', () => {
    if (!standalonePage) return;
    const osm = q(standalonePage, '.bike-path-osm');
    expect(osm).not.toBeNull();
    expect(osm!.innerHTML).toContain('openstreetmap.org/way/');
    expect(osm!.innerHTML).not.toContain('search?query=');
  });

  it('back link goes to index (not a network)', () => {
    if (!standalonePage) return;
    const back = q(standalonePage, '.bike-path-back a');
    expect(back).not.toBeNull();
    expect(back!.getAttribute('href')).toMatch(/\/bike-paths\/$/);
  });
});

// ---------------------------------------------------------------------------
// Network page
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_BUILD)('network page', () => {
  it('was built', () => {
    expect(networkPage).not.toBeNull();
  });

  it('has title', () => {
    expect(q(networkPage, '.bike-path-title h1')!.textContent).toContain('Red de Ciclovías');
  });

  it('has full-width map', () => {
    expect(q(networkPage, '.network-map-full')).not.toBeNull();
  });

  it('has no network badge (it IS a network)', () => {
    expect(q(networkPage, '.network-badge')).toBeNull();
  });

  it('has no nearest-major-path (networks skip this)', () => {
    expect(q(networkPage, '.nearest-major-path')).toBeNull();
  });

  it('has back link', () => {
    expect(q(networkPage, '.bike-path-back')).not.toBeNull();
  });
});
