import { describe, it, expect } from 'vitest';
import { isHardExcluded, scoreBikePath } from '../src/lib/bike-paths/bike-path-scoring';
import type { SluggedBikePathYml } from '../src/lib/bike-paths/bikepaths-yml';

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
    expect(isHardExcluded(entry({ name: 'Pine Grove', network: 'Pine Grove' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Nordic Trail', network: 'KanataNordicCampground' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Mer Bleue', network: 'Mer Bleue' }))).toBe(true);
    expect(isHardExcluded(entry({ name: 'Walk', network: 'rwn' }))).toBe(true);
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

describe('scoreBikePath', () => {
  it('scores a high-quality NCC pathway', () => {
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
    // osm_relations(+3) + rcn(+3) + overlaps(+3) + NCC(+2) + cycleway(+1) + bilingual(+1) + asphalt(+1) = 14
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

  it('recognises City of Ottawa operator', () => {
    const score = scoreBikePath(entry({
      name: 'Crosstown Bikeway',
      operator: 'City of Ottawa',
    }), 0);
    expect(score).toBeGreaterThanOrEqual(2);
  });
});
