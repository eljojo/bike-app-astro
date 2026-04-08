// name-cluster.test.mjs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pickClusterName } from '../../../scripts/pipeline/lib/name-cluster.mjs';

const southMarch = JSON.parse(readFileSync(new URL('../fixtures/south-march-trails.json', import.meta.url), 'utf8'));

describe('pickClusterName', () => {
  it('uses park name when Overpass returns a containing area', () => {
    const result = pickClusterName(southMarch.entries, southMarch.park.name);
    expect(result).toBe('South March Highlands Conservation Forest');
  });

  it('falls back to majority operator when no park name', () => {
    const members = southMarch.entries.map(e => ({ ...e, operator: 'NCC' }));
    expect(pickClusterName(members, null)).toBe('NCC Trails');
  });

  it('falls back to longest-geometry member when no park and no operator', () => {
    // DeerDrop Baypass has the longest geometry (901m) in the fixture
    expect(pickClusterName(southMarch.entries, null)).toBe('DeerDrop Baypass');
  });

  it('uses majority operator, not unanimous', () => {
    const members = [
      { name: 'A', highway: 'path', operator: 'NCC' },
      { name: 'B', highway: 'path', operator: 'NCC' },
      { name: 'C', highway: 'path', operator: 'Other' },
    ];
    expect(pickClusterName(members, null)).toBe('NCC Trails');
  });

  it('skips operator fallback when no majority', () => {
    const members = [
      { name: 'Coconut Tree', operator: 'NCC' },
      { name: 'Beartree', operator: 'City of Ottawa' },
    ];
    expect(pickClusterName(members, null)).toBe('Coconut Tree');
  });

  it('skips generic names (numeric-only)', () => {
    const members = [
      { name: '12345' },
      { name: 'Good Trail' },
    ];
    expect(pickClusterName(members, null)).toBe('Good Trail');
  });

  it('skips relation-ID names', () => {
    const members = [
      { name: 'relation-99999' },
      { name: 'Real Name' },
    ];
    expect(pickClusterName(members, null)).toBe('Real Name');
  });

  it('uses most-ways member name when no park name', () => {
    const members = [
      { name: 'Short St', highway: 'cycleway', _ways: [[1], [2]] },
      { name: 'Long Avenue', highway: 'cycleway', _ways: [[1], [2], [3], [4], [5]] },
      { name: 'Tiny Rd', highway: 'cycleway', _ways: [[1]] },
    ];
    expect(pickClusterName(members, null)).toBe('Long Avenue');
  });

  it('still uses park name for trail clusters', () => {
    const members = [
      { name: 'Trail A', highway: 'path', _ways: [[1]] },
      { name: 'Trail B', highway: 'path', _ways: [[1], [2], [3]] },
    ];
    expect(pickClusterName(members, 'Big Forest Park')).toBe('Big Forest Park');
  });

  it('uses operator for trail clusters without park', () => {
    const members = [
      { name: 'Trail A', highway: 'path', operator: 'NCC', _ways: [[1]] },
      { name: 'Trail B', highway: 'path', operator: 'NCC', _ways: [[1], [2]] },
    ];
    expect(pickClusterName(members, null)).toBe('NCC Trails');
  });

  it('skips operator naming for urban clusters', () => {
    const members = [
      { name: 'Elgin Street', highway: 'cycleway', operator: 'OC Transpo', _ways: [[1], [2], [3]] },
      { name: 'Rideau Street', highway: 'cycleway', operator: 'OC Transpo', _ways: [[1], [2], [3], [4], [5]] },
    ];
    // Should NOT be "OC Transpo Trails", should use most-ways
    expect(pickClusterName(members, null)).toBe('Rideau Street');
  });
});
