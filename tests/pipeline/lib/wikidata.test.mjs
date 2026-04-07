import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWikidataEntity, extractBikePathMetadata, enrichWithWikidata, validateWikidataEntity } from '../../../scripts/pipeline/lib/wikidata.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const realFixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'wikidata-Q5035630.json'), 'utf8')
);

describe('fetchWikidataEntity', () => {
  it('fetches entity data from Wikidata REST API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(realFixture),
    });
    const entity = await fetchWikidataEntity('Q5035630', mockFetch);
    expect(entity.id).toBe('Q5035630');
    expect(entity.labels.en).toBeDefined();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/Q5035630',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': expect.any(String) }),
      })
    );
  });
});

describe('extractBikePathMetadata', () => {
  it('extracts metadata from real Capital Pathway entity', () => {
    const meta = extractBikePathMetadata(realFixture);
    expect(meta.description_en).toBeDefined();
    expect(meta.length_km).toBeGreaterThan(100);
    expect(meta.inception).toBe('1970s');
    expect(meta.website).toContain('ncc-ccn.gc.ca');
  });

  it('extracts commons_image from P18', () => {
    const meta = extractBikePathMetadata(realFixture);
    expect(meta.commons_image).toBe('Ottawa Sept 09 2006 068.jpg');
  });

  it('extracts commons_category from P373', () => {
    const meta = extractBikePathMetadata(realFixture);
    expect(meta.commons_category).toBe('Capital Pathway');
  });

  it('extracts operator_qid from P126', () => {
    const meta = extractBikePathMetadata(realFixture);
    expect(meta.operator_qid).toBe('Q613449');
  });

  it('extracts instance_of from P31 (multiple values)', () => {
    const meta = extractBikePathMetadata(realFixture);
    expect(meta.instance_of).toEqual(['Q221722', 'Q12670591']);
  });

  it('extracts social from P3984 with URL-based platform detection', () => {
    const meta = extractBikePathMetadata(realFixture);
    expect(meta.social).toEqual([
      {
        platform: 'reddit',
        username: 'bikeinottawa',
        url: 'https://www.reddit.com/r/bikeinottawa',
      },
    ]);
  });

  it('extracts wikipedia_sitelinks from sitelinks', () => {
    const meta = extractBikePathMetadata(realFixture);
    expect(meta.wikipedia_sitelinks).toEqual({
      en: {
        title: 'Capital Pathway',
        url: 'https://en.wikipedia.org/wiki/Capital_Pathway',
      },
    });
    // frwiki not present in fixture — should not have fr key
    expect(meta.wikipedia_sitelinks.fr).toBeUndefined();
  });

  it('handles entity with no statements', () => {
    const empty = { id: 'Q999', labels: {}, descriptions: {}, statements: {} };
    const meta = extractBikePathMetadata(empty);
    expect(meta.length_km).toBeUndefined();
    expect(meta.inception).toBeUndefined();
    expect(meta.website).toBeUndefined();
    expect(meta.commons_image).toBeUndefined();
    expect(meta.commons_category).toBeUndefined();
    expect(meta.operator_qid).toBeUndefined();
    expect(meta.instance_of).toBeUndefined();
    expect(meta.social).toEqual([]);
    expect(meta.wikipedia_sitelinks).toBeUndefined();
  });
});

describe('enrichWithWikidata', () => {
  it('enriches entries that have wikidata field', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(realFixture),
    });
    const entries = [
      { name: 'Capital Pathway', wikidata: 'Q5035630' },
      { name: 'No Wikidata Path' },
    ];
    const count = await enrichWithWikidata(entries, { fetchFn: mockFetch });
    expect(count).toBe(1);
    expect(entries[0].wikidata_meta).toBeDefined();
    expect(entries[0].wikidata_meta.length_km).toBeGreaterThan(100);
    expect(entries[0].name_fr).toBeDefined();
    expect(entries[0].name_en).toBeDefined();
    expect(entries[1].wikidata_meta).toBeUndefined();
  });

  it('skips entries already enriched', async () => {
    const mockFetch = vi.fn();
    const entries = [
      { name: 'Already Done', wikidata: 'Q123', wikidata_meta: { length_km: 10 } },
    ];
    const count = await enrichWithWikidata(entries, { fetchFn: mockFetch });
    expect(count).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('validateWikidataEntity', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns when P402 does not match entry osm_relations', () => {
    validateWikidataEntity(realFixture, {
      name: 'Capital Pathway',
      osm_relations: [99999],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Wikidata P402=10990511 not found in osm_relations')
    );
  });

  it('does not warn when P402 matches entry osm_relations', () => {
    validateWikidataEntity(realFixture, {
      name: 'Capital Pathway',
      osm_relations: [10990511],
    });
    // P402 should not warn — but P31 and P2789 are valid too, so no warnings at all
    const p402Warnings = warnSpy.mock.calls.filter(c => c[0].includes('P402'));
    expect(p402Warnings).toHaveLength(0);
  });

  it('warns when P31 has no expected Q-IDs', () => {
    const entity = {
      statements: {
        P31: [
          { value: { content: 'Q99999' } },
        ],
      },
    };
    validateWikidataEntity(entity, { name: 'Weird Path' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unexpected Wikidata instance_of [Q99999]')
    );
  });

  it('does not warn for real fixture P31 (has expected Q-IDs)', () => {
    validateWikidataEntity(realFixture, { name: 'Capital Pathway' });
    const p31Warnings = warnSpy.mock.calls.filter(c => c[0].includes('instance_of'));
    expect(p31Warnings).toHaveLength(0);
  });

  it('warns when P2789 has no cycling activities', () => {
    const entity = {
      statements: {
        P2789: [
          { value: { content: 'Q999' } },
          { value: { content: 'Q888' } },
        ],
      },
    };
    validateWikidataEntity(entity, { name: 'Hiking Trail' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no cycling activity in P2789')
    );
  });

  it('does not warn when P2789 includes cycling (real fixture)', () => {
    validateWikidataEntity(realFixture, { name: 'Capital Pathway' });
    const p2789Warnings = warnSpy.mock.calls.filter(c => c[0].includes('P2789'));
    expect(p2789Warnings).toHaveLength(0);
  });
});
