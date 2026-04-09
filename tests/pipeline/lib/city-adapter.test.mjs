// Tests for the city adapter's memberSort comparator.
//
// Two-bucket sort: named trails first (no digits), alphabetical; numbered
// trails second, natural numeric order. This is what the bike path detail
// page renders in its "children" list.

import { describe, it, expect } from 'vitest';
import { loadCityAdapter } from '../../../scripts/pipeline/lib/city-adapter.mjs';

const ottawa = loadCityAdapter('ottawa');

function sortNames(names) {
  return names
    .map((name) => ({ name }))
    .sort(ottawa.memberSort)
    .map((e) => e.name);
}

describe('ottawa adapter memberSort', () => {
  it('exists on the Ottawa adapter', () => {
    expect(ottawa.memberSort).toBeTypeOf('function');
  });

  it('puts named trails before numbered trails (two-bucket sort)', () => {
    const sorted = sortNames([
      'Trail 14', 'Hermit', 'Trail #3', 'Salamander', 'Piste 60 (Raquette)',
      'Bypass', 'Trail #24', 'Chemin Cowden',
    ]);
    expect(sorted).toEqual([
      // Named bucket — no digits, alphabetical
      'Bypass',
      'Chemin Cowden',
      'Hermit',
      'Salamander',
      // Numbered bucket — natural name sort across prefixes ("Piste" < "Trail")
      // and natural numeric order within a prefix.
      'Piste 60 (Raquette)',
      'Trail #3',
      'Trail 14',
      'Trail #24',
    ]);
  });

  it('sorts "Trail #3" before "Trail #24" within the numbered bucket', () => {
    const sorted = sortNames(['Trail #24', 'Trail #3', 'Trail #33', 'Trail #9']);
    expect(sorted).toEqual(['Trail #3', 'Trail #9', 'Trail #24', 'Trail #33']);
  });

  it('sorts mixed numeric trail refs in natural order', () => {
    const sorted = sortNames([
      'Trail 47', 'Trail 14', 'Trail 22', 'Trail 36b', 'Trail 19', 'Trail 20', 'Trail 28',
    ]);
    expect(sorted).toEqual([
      'Trail 14', 'Trail 19', 'Trail 20', 'Trail 22', 'Trail 28', 'Trail 36b', 'Trail 47',
    ]);
  });

  it('interleaves "Trail #N" and "Trail N" within the numbered bucket', () => {
    // OSM mixes these styles. Within the numbered bucket they should form
    // one ordered sequence, not two.
    const sorted = sortNames([
      'Trail 14', 'Trail #3', 'Trail 7', 'Trail #24', 'Trail 22B', 'Trail #1 Ridge Road',
    ]);
    expect(sorted).toEqual([
      'Trail #1 Ridge Road',
      'Trail #3',
      'Trail 7',
      'Trail 14',
      'Trail 22B',
      'Trail #24',
    ]);
  });

  it('sorts Piste entries naturally within the numbered bucket', () => {
    const sorted = sortNames(['Piste 60 (Raquette)', 'Piste 12', 'Piste 25']);
    expect(sorted).toEqual(['Piste 12', 'Piste 25', 'Piste 60 (Raquette)']);
  });

  it('sorts named French trails alphabetically', () => {
    const sorted = sortNames([
      'Sentier des Loups', 'Sentier Horizon', 'Sentier de la Rivière',
    ]);
    // All three are named (no digits). Collation: "de la" < "des" < "Horizon".
    expect(sorted).toEqual([
      'Sentier de la Rivière',
      'Sentier des Loups',
      'Sentier Horizon',
    ]);
  });

  it('case/diacritic insensitive: "Écluse" sorts near "ecluse"', () => {
    const sorted = sortNames(['Écluse Nord', 'beaver trail', 'Écluse Sud', 'ARNPRIOR']);
    expect(sorted).toEqual([
      'ARNPRIOR',
      'beaver trail',
      'Écluse Nord',
      'Écluse Sud',
    ]);
  });

  it('treats any name with a digit as numbered', () => {
    const sorted = sortNames([
      'Sentier 52 du Parc de la Gatineau Parkway',
      'Hermit',
      'Trail 22B',
    ]);
    // Hermit (named) first. Then numbered bucket: "Sentier 52…" < "Trail 22B"
    // because S < T.
    expect(sorted).toEqual([
      'Hermit',
      'Sentier 52 du Parc de la Gatineau Parkway',
      'Trail 22B',
    ]);
  });

  it('is stable for entries without a name', () => {
    const a = { name: 'Trail 1' };
    const b = {}; // no name
    expect(() => [a, b].sort(ottawa.memberSort)).not.toThrow();
  });
});
