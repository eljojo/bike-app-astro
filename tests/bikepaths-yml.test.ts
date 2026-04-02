import { describe, it, expect } from 'vitest';
import { slugifyBikePathName, parseBikePathsYml } from '../src/lib/bike-paths/bikepaths-yml.server';

describe('slugifyBikePathName', () => {
  it('converts path name to kebab-case slug', () => {
    expect(slugifyBikePathName('Sentier des Voyageurs Pathway')).toBe('sentier-des-voyageurs-pathway');
  });

  it('handles accented characters', () => {
    expect(slugifyBikePathName('Sentier du Lac-des-Fées')).toBe('sentier-du-lac-des-fees');
  });

  it('handles parenthetical suffixes', () => {
    expect(slugifyBikePathName('Ottawa River Pathway (east)')).toBe('ottawa-river-pathway-east');
  });

  it('strips special characters', () => {
    expect(slugifyBikePathName('#72B (Irish Cream)')).toBe('72b-irish-cream');
  });

  it('collapses multiple hyphens', () => {
    expect(slugifyBikePathName('Sentier du Ruisseau-de-la-Brasserie Pathway')).toBe('sentier-du-ruisseau-de-la-brasserie-pathway');
  });
});

describe('parseBikePathsYml', () => {
  it('parses YML content into slugged entries', () => {
    const yml = `bike_paths:
  - name: Sentier des Voyageurs Pathway
    osm_relations:
      - 215128
    network: lcn
    surface: asphalt
  - name: Ottawa River Pathway (east)
    osm_relations:
      - 7174864
    network: rcn
    operator: NCC`;

    const { entries } = parseBikePathsYml(yml);
    expect(entries).toHaveLength(2);
    expect(entries[0].slug).toBe('sentier-des-voyageurs-pathway');
    expect(entries[0].surface).toBe('asphalt');
    expect(entries[1].slug).toBe('ottawa-river-pathway-east');
    expect(entries[1].operator).toBe('NCC');
  });

  it('handles duplicate slugs by appending index', () => {
    const yml = `bike_paths:
  - name: Trail 50
    network: lcn
  - name: Trail 50
    network: rcn`;

    const { entries } = parseBikePathsYml(yml);
    expect(entries[0].slug).toBe('trail-50-1');
    expect(entries[1].slug).toBe('trail-50-2');
  });

  it('sorts duplicate slugs deterministically by OSM relation ID', () => {
    const yml = `bike_paths:
  - name: River Path
    osm_relations:
      - 9999
  - name: River Path
    osm_relations:
      - 1111`;

    const { entries } = parseBikePathsYml(yml);
    // Entry with relation 1111 sorts first (r1111 < r9999)
    // But original YAML order is preserved in the output
    expect(entries[0].slug).toBe('river-path-2'); // rel 9999 → sorted second
    expect(entries[1].slug).toBe('river-path-1'); // rel 1111 → sorted first
  });

  it('throws on invalid YAML structure', () => {
    expect(() => parseBikePathsYml('not_bike_paths: []')).toThrow('bike_paths array');
  });
});
