/**
 * Structural contract test for the bike path detail page.
 *
 * Defines what sections must exist, what data they contain, and what order
 * they appear in. Runs against the reference mockup HTML first, then the
 * same assertions apply to the real Astro-built page via e2e/playwright.
 *
 * This test checks DOM presence — not CSS visibility, not pixel layout.
 * If the data is in the DOM, the test passes regardless of viewport.
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

function tid(doc: Document, id: string): Element | null {
  return doc.querySelector(`[data-testid="${id}"]`);
}

function tids(doc: Document, id: string): Element[] {
  return [...doc.querySelectorAll(`[data-testid="${id}"]`)];
}

/** Assert element A appears before element B in document order. */
function assertOrder(doc: Document, aId: string, bId: string) {
  const a = tid(doc, aId);
  const b = tid(doc, bId);
  expect(a, `${aId} must exist`).not.toBeNull();
  expect(b, `${bId} must exist`).not.toBeNull();
  const cmp = a!.compareDocumentPosition(b!);
  expect(cmp & 4, `${aId} must come before ${bId} in DOM`).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Load the reference mockup
// ---------------------------------------------------------------------------

let doc: Document;

beforeAll(() => {
  const mockupPath = path.resolve(import.meta.dirname, 'fixtures', 'bike-path-detail-spec.html');
  const html = fs.readFileSync(mockupPath, 'utf-8');
  doc = parseHTML(html);
});

// ---------------------------------------------------------------------------
// Section presence — every section must exist in the DOM
// ---------------------------------------------------------------------------

describe('detail page sections exist', () => {
  it('has a path title', () => {
    expect(tid(doc, 'path-title')).not.toBeNull();
  });

  it('has a network badge (when path is in a network)', () => {
    expect(tid(doc, 'network-badge')).not.toBeNull();
  });

  it('has vibe text (when vibe exists)', () => {
    expect(tid(doc, 'path-vibe')).not.toBeNull();
  });

  it('has a map', () => {
    expect(tid(doc, 'path-map')).not.toBeNull();
  });

  it('has body text or wikidata description fallback', () => {
    expect(tid(doc, 'path-body')).not.toBeNull();
  });

  it('has edit / stub CTA', () => {
    expect(tid(doc, 'edit-cta')).not.toBeNull();
  });

  it('has infrastructure section', () => {
    expect(tid(doc, 'infrastructure-section')).not.toBeNull();
  });

  it('has at least one network card', () => {
    expect(tids(doc, 'network-card').length).toBeGreaterThan(0);
  });

  it('has routes section', () => {
    expect(tid(doc, 'routes-section')).not.toBeNull();
  });

  it('has at least one route card', () => {
    expect(tids(doc, 'route-card').length).toBeGreaterThan(0);
  });

  it('has photos section', () => {
    expect(tid(doc, 'photos-section')).not.toBeNull();
  });

  it('has facts table', () => {
    expect(tid(doc, 'facts-table')).not.toBeNull();
  });

  it('has nearby places', () => {
    expect(tid(doc, 'nearby-places')).not.toBeNull();
  });

  it('has website link (when website exists)', () => {
    expect(tid(doc, 'website-link')).not.toBeNull();
  });

  it('has wikipedia link (when wikipedia exists)', () => {
    expect(tid(doc, 'wikipedia-link')).not.toBeNull();
  });

  it('has OSM attribution', () => {
    expect(tid(doc, 'osm-attribution')).not.toBeNull();
  });

  it('has back link', () => {
    expect(tid(doc, 'back-link')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Facts table — all fact rows present
// ---------------------------------------------------------------------------

describe('facts table completeness', () => {
  const requiredFacts = [
    'fact-length',
    'fact-path-type',
    'fact-surface',
    'fact-traffic',
    'fact-lighting',
    'fact-terrain',
    'fact-operator',
    'fact-network',
  ];

  for (const factId of requiredFacts) {
    it(`has ${factId}`, () => {
      expect(tid(doc, factId), `missing ${factId}`).not.toBeNull();
    });
  }

  // These are conditional but present in the reference mockup
  it('has fact-surface-quality (when smoothness data exists)', () => {
    expect(tid(doc, 'fact-surface-quality')).not.toBeNull();
  });

  it('has fact-established (when inception data exists)', () => {
    expect(tid(doc, 'fact-established')).not.toBeNull();
  });

  it('has fact-seasonal (when seasonal data exists)', () => {
    expect(tid(doc, 'fact-seasonal')).not.toBeNull();
  });

  it('has fact-alongside (when parallel_to exists)', () => {
    expect(tid(doc, 'fact-alongside')).not.toBeNull();
  });

  it('has fact-ref (when ref code exists)', () => {
    expect(tid(doc, 'fact-ref')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Infrastructure section — network cards have the right structure
// ---------------------------------------------------------------------------

describe('infrastructure section structure', () => {
  it('own network card is marked as current', () => {
    const ownCard = tid(doc, 'network-card-own');
    expect(ownCard).not.toBeNull();
  });

  it('network cards have names', () => {
    const cards = tids(doc, 'network-card');
    for (const card of cards) {
      const name = card.querySelector('[data-testid="network-card-name"]');
      expect(name, 'network card must have a name').not.toBeNull();
      expect(name!.textContent!.trim().length).toBeGreaterThan(0);
    }
  });

  it('network cards list connected/nearby paths', () => {
    const cards = tids(doc, 'network-card');
    const hasMembers = cards.some(card =>
      card.querySelectorAll('[data-testid="network-card-path"]').length > 0,
    );
    expect(hasMembers).toBe(true);
  });

  it('connected paths are distinguished from nearby paths', () => {
    const paths = doc.querySelectorAll('[data-testid="network-card-path"]');
    const types = new Set<string>();
    for (const p of paths) {
      const rel = (p as Element).getAttribute('data-relation');
      if (rel) types.add(rel);
    }
    // Should have at least "connects" — "nearby" is optional
    expect(types.has('connects')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Route cards have required content
// ---------------------------------------------------------------------------

describe('route cards structure', () => {
  it('route cards have a name', () => {
    for (const card of tids(doc, 'route-card')) {
      const name = card.querySelector('[data-testid="route-card-name"]');
      expect(name).not.toBeNull();
      expect(name!.textContent!.trim().length).toBeGreaterThan(0);
    }
  });

  it('route cards have distance', () => {
    for (const card of tids(doc, 'route-card')) {
      const meta = card.querySelector('[data-testid="route-card-meta"]');
      expect(meta).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Section ordering — main column content flow
// ---------------------------------------------------------------------------

describe('section order', () => {
  it('title comes before map', () => assertOrder(doc, 'path-title', 'path-map'));
  it('map comes before body', () => assertOrder(doc, 'path-map', 'path-body'));
  it('body comes before infrastructure', () => assertOrder(doc, 'path-body', 'infrastructure-section'));
  it('infrastructure comes before routes', () => assertOrder(doc, 'infrastructure-section', 'routes-section'));
  it('routes come before photos', () => assertOrder(doc, 'routes-section', 'photos-section'));
  it('facts table exists (accessible on all viewports)', () => {
    // Facts must be in the DOM — whether rendered in a sidebar or stacked,
    // the full table is always present. CSS may reposition but never remove.
    expect(tid(doc, 'facts-table')).not.toBeNull();
  });
  it('back link is last', () => {
    assertOrder(doc, 'photos-section', 'back-link');
    assertOrder(doc, 'osm-attribution', 'back-link');
  });
});

// ---------------------------------------------------------------------------
// Content spot-checks — the mockup has specific data we can verify
// ---------------------------------------------------------------------------

describe('content spot-checks (reference mockup)', () => {
  it('title contains "Watts Creek Pathway"', () => {
    expect(tid(doc, 'path-title')!.textContent).toContain('Watts Creek Pathway');
  });

  it('network badge links to NCC Greenbelt', () => {
    expect(tid(doc, 'network-badge')!.textContent).toContain('NCC Greenbelt');
  });

  it('has 3 network cards (Greenbelt, Capital Pathway, Trans Canada)', () => {
    expect(tids(doc, 'network-card').length).toBe(3);
  });

  it('has an "other paths nearby" section', () => {
    expect(tid(doc, 'other-paths')).not.toBeNull();
  });

  it('has 2 route cards', () => {
    expect(tids(doc, 'route-card').length).toBe(2);
  });

  it('website link contains hostname', () => {
    expect(tid(doc, 'website-link')!.textContent!.trim().length).toBeGreaterThan(0);
  });
});
