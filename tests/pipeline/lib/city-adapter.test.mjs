// Tests for the city adapter's memberSort comparator.
//
// Two-bucket sort:
//   1. Named trails first (no digit in name), alphabetical.
//   2. Numbered trails after, sorted by the FIRST number in the name
//      (ignoring prefix text and "#"), tiebroken alphabetically.

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

  it('matches the spec: named first alphabetical, numbered by extracted number', () => {
    // The canonical expected ordering the user described.
    const sorted = sortNames([
      'Trail 5', '2', 'a numberless thing', 'Trail #4', 'Piste 3',
      'ab another numberless thing', 'Sentier 5', 'Trail 1', '58 Konnektor',
    ]);
    expect(sorted).toEqual([
      'a numberless thing',
      'ab another numberless thing',
      'Trail 1',
      '2',
      'Piste 3',
      'Trail #4',
      'Sentier 5',
      'Trail 5',
      '58 Konnektor',
    ]);
  });

  it('puts named trails before numbered trails', () => {
    const sorted = sortNames([
      'Trail 14', 'Hermit', 'Trail #3', 'Salamander', 'Bypass', 'Piste 60 (Raquette)',
    ]);
    expect(sorted).toEqual([
      'Bypass',
      'Hermit',
      'Salamander',
      'Trail #3',
      'Trail 14',
      'Piste 60 (Raquette)',
    ]);
  });

  it('sorts numbered trails across prefixes by their number alone', () => {
    // Prefix text does not affect the ordering — only the embedded number.
    const sorted = sortNames([
      'Piste 12', 'Trail #3', 'Sentier 5', 'Trail #24', 'Piste 60',
      'Trail 7', 'Trail #1 Ridge Road',
    ]);
    expect(sorted).toEqual([
      'Trail #1 Ridge Road', // 1
      'Trail #3',            // 3
      'Sentier 5',           // 5
      'Trail 7',             // 7
      'Piste 12',            // 12
      'Trail #24',           // 24
      'Piste 60',            // 60
    ]);
  });

  it('tiebreaks entries with the same number alphabetically', () => {
    const sorted = sortNames(['Trail 5', 'Sentier 5', 'Piste 5']);
    // Same extracted number; case-insensitive alphabetical order.
    expect(sorted).toEqual(['Piste 5', 'Sentier 5', 'Trail 5']);
  });

  it('treats a standalone numeric name as its own number', () => {
    const sorted = sortNames(['Hermit', '2', 'Piste 1', 'Trail 3']);
    expect(sorted).toEqual(['Hermit', 'Piste 1', '2', 'Trail 3']);
  });

  it('uses the first number when multiple are present', () => {
    const sorted = sortNames(['Trail 50B', 'Trail 3', 'Trail 20-2', 'Trail 5 (part 2)']);
    expect(sorted).toEqual([
      'Trail 3',           // 3
      'Trail 5 (part 2)',  // 5 (not 2)
      'Trail 20-2',        // 20 (not 2)
      'Trail 50B',         // 50
    ]);
  });

  it('sorts named French trails alphabetically', () => {
    const sorted = sortNames([
      'Sentier des Loups', 'Sentier Horizon', 'Sentier de la Rivière',
    ]);
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

  it('is stable for entries without a name', () => {
    const a = { name: 'Trail 1' };
    const b = {}; // no name
    expect(() => [a, b].sort(ottawa.memberSort)).not.toThrow();
  });
});
