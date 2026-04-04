import { describe, it, expect, vi } from 'vitest';
import { isHardExcluded, scoreBikePath, isDestination, SCORE_THRESHOLD } from '../src/lib/bike-paths/bike-path-scoring.server';
import { normalizeOperator } from '../src/lib/bike-paths/bike-path-data.server';
import type { SluggedBikePathYml } from '../src/lib/bike-paths/bikepaths-yml.server';

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: () => ({
    locales: ['en-CA', 'fr-CA'],
    operator_aliases: {
      NCC: ['ncc', 'ccn', 'national capital commission', 'commission de la capitale nationale'],
    },
  }),
}));

function entry(overrides: Partial<SluggedBikePathYml> & { name: string }): SluggedBikePathYml {
  return { slug: 'test', ...overrides };
}

describe('isHardExcluded', () => {
  it('excludes road highways', () => {
    expect(isHardExcluded(entry({ name: 'Baseline Road', highway: 'tertiary' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Bank Street', highway: 'secondary' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'March Road', highway: 'primary' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Side Street', highway: 'residential' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Local Road', highway: 'unclassified' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Walkway', highway: 'footway' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Mall Path', highway: 'pedestrian' }))).toBe(true);
  });

  it('excludes non-cycling networks', () => {
    expect(isHardExcluded(entry({ name: 'MTB Trail', network: 'mtb' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Hiking Trail', network: 'lwn' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Walk', network: 'rwn' }))).toBe(true);
  });

  it('does not exclude city-specific trail networks', () => {
    expect(isHardExcluded(entry({ name: 'Pine Grove', network: 'Pine Grove' }))).toBe(false);
    expect(isHardExcluded(entry({ name: 'Nordic Trail', network: 'KanataNordicCampground' }))).toBe(false);
    expect(isHardExcluded(entry({ name: 'Mer Bleue', network: 'Mer Bleue' }))).toBe(false);
  });

  it('excludes bridge names', () => {
    expect(isHardExcluded(entry({ name: 'Pont Champlain' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Bridge Street Pathway' }))).toBe(false);
    expect(isHardExcluded(entry({ name: 'Corktown Footbridge' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Chief William Commanda Bridge' }))).toBe(true);
  });

  it('excludes numeric-only names and relation IDs', () => {
    expect(isHardExcluded(entry({ name: '54' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'relation-18537256' }))).toBe(true);
  });

  it('excludes winter seasonal paths', () => {
    expect(isHardExcluded(entry({ name: 'Ski Trail', seasonal: 'winter' }))).toBe(true);
  });

  it('does not exclude valid cycling paths', () => {
    expect(isHardExcluded(entry({ name: 'Ottawa River Pathway', highway: 'cycleway', network: 'rcn' }))).toBe(false);
    expect(isHardExcluded(entry({ name: 'Sentier des Voyageurs Pathway', highway: 'cycleway' }))).toBe(false);
  });
});

describe('normalizeOperator', () => {
  it('normalizes operator variants to canonical name using city config', () => {
    expect(normalizeOperator('NCC')).toBe('NCC');
    expect(normalizeOperator('CCN NCC')).toBe('NCC');
    expect(normalizeOperator('NCC/CCN')).toBe('NCC');
    expect(normalizeOperator('Commission de la capitale nationale / National Capital Commission')).toBe('NCC');
    expect(normalizeOperator('National Capital Commission')).toBe('NCC');
  });

  it('passes through operators with no matching alias unchanged', () => {
    expect(normalizeOperator('City of Ottawa')).toBe('City of Ottawa');
    expect(normalizeOperator('Russell Township')).toBe('Russell Township');
  });

  it('returns undefined for empty/undefined input', () => {
    expect(normalizeOperator(undefined)).toBeUndefined();
    expect(normalizeOperator('')).toBeUndefined();
  });
});

describe('scoreBikePath', () => {
  it('scores a high-quality pathway with named operator', () => {
    const score = scoreBikePath(entry({
      name: 'Ottawa River Pathway',
      osm_relations: [7174864],
      network: 'rcn',
      operator: 'NCC',
      highway: 'cycleway',
      surface: 'asphalt',
      name_en: 'Ottawa River Pathway',
      name_fr: 'Sentier de la rivière des Outaouais',
    }), 3);
    // osm_relations(+3) + rcn(+3) + overlaps(+3) + operator(+2) + cycleway(+1) + bilingual(+1) + asphalt(+1) = 14
    expect(score).toBe(14);
  });

  it('scores a minimal cycleway with no extras', () => {
    const score = scoreBikePath(entry({
      name: 'Small Local Path',
      highway: 'cycleway',
    }), 0);
    expect(score).toBe(1);
  });

  it('gives +3 for route overlaps', () => {
    const withOverlap = scoreBikePath(entry({ name: 'Test' }), 1);
    const withoutOverlap = scoreBikePath(entry({ name: 'Test' }), 0);
    expect(withOverlap - withoutOverlap).toBe(3);
  });

  it('gives +2 for any non-empty operator', () => {
    const score = scoreBikePath(entry({
      name: 'Crosstown Bikeway',
      operator: 'City of Ottawa',
    }), 0);
    expect(score).toBe(2);

    const score2 = scoreBikePath(entry({
      name: 'River Trail',
      operator: 'Parks Department',
    }), 0);
    expect(score2).toBe(2);
  });

  it('SCORE_THRESHOLD is 4', () => {
    expect(SCORE_THRESHOLD).toBe(4);
  });

  it('score determines listed vs unlisted', () => {
    // A cycleway with no extras scores 1 — below SCORE_THRESHOLD (4), so unlisted
    const low = scoreBikePath(entry({ name: 'Small Path', highway: 'cycleway' }), 0);
    expect(low).toBe(1);
    expect(low >= SCORE_THRESHOLD).toBe(false); // unlisted

    // Same path with route overlaps scores 4 — meets threshold, so listed
    const withOverlaps = scoreBikePath(entry({ name: 'Small Path', highway: 'cycleway' }), 2);
    expect(withOverlaps).toBe(4);
    expect(withOverlaps >= SCORE_THRESHOLD).toBe(true); // listed
  });
});

describe('isDestination', () => {
  it('non-hidden paths with markdown get standalone pages', () => {
    expect(isDestination(entry({ name: 'Short', slug: 'short' }), 0.5, true, false)).toBe(true);
    expect(isDestination(entry({ name: 'Short', slug: 'short' }), undefined, true, false)).toBe(true);
  });

  it('hidden markdown entries do not get standalone pages', () => {
    expect(isDestination(entry({ name: 'Hidden Path', slug: 'hidden' }), 5.0, true, true)).toBe(false);
    expect(isDestination(entry({ name: 'Hidden Short', slug: 'hidden-short' }), 0.5, true, true)).toBe(false);
  });

  it('networks always get standalone pages', () => {
    expect(isDestination(entry({ name: 'Capital Pathway', slug: 'capital-pathway', type: 'network' }), undefined, false, false)).toBe(true);
  });

  it('paths under 1km without markdown do not get standalone pages', () => {
    expect(isDestination(entry({ name: 'Short Connector', slug: 'short-connector' }), 0.5, false, false)).toBe(false);
    expect(isDestination(entry({ name: 'Tiny Path', slug: 'tiny' }), 0.1, false, false)).toBe(false);
  });

  it('paths >= 1km get standalone pages', () => {
    expect(isDestination(entry({ name: 'Long Path', slug: 'long' }), 1.0, false, false)).toBe(true);
    expect(isDestination(entry({ name: 'Longer', slug: 'longer' }), 5.0, false, false)).toBe(true);
  });

  it('paths with no length data default to standalone', () => {
    expect(isDestination(entry({ name: 'Unknown', slug: 'unknown' }), undefined, false, false)).toBe(true);
  });
});
