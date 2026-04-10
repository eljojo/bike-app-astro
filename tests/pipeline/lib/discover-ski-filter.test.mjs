// Unit tests for the ski-only way filter in lib/ski-filter.ts.
//
// The filter prevents Nordic ski trails (e.g. Parc de la Gatineau's numbered
// pistes) from being promoted to standalone bikepaths.yml entries via the
// junction-way discovery path. Mixed-use trails (summer MTB / winter
// groomed) must still come through unchanged.

import { describe, it, expect } from 'vitest';
import { isSkiOnlyWay } from '../../../scripts/pipeline/lib/ski-filter.ts';

describe('isSkiOnlyWay', () => {
  it('returns false for missing tags', () => {
    expect(isSkiOnlyWay(undefined)).toBe(false);
    expect(isSkiOnlyWay(null)).toBe(false);
    expect(isSkiOnlyWay({})).toBe(false);
  });

  // --- bicycle=no (always excluded regardless of piste tags) ---

  it('bicycle=no alone → true', () => {
    expect(isSkiOnlyWay({ highway: 'path', bicycle: 'no' })).toBe(true);
  });

  it('bicycle=no on a cycleway → true', () => {
    // Rare, but if OSM says no, we listen.
    expect(isSkiOnlyWay({ highway: 'cycleway', bicycle: 'no' })).toBe(true);
  });

  it('bicycle=no on a road → true', () => {
    expect(isSkiOnlyWay({ highway: 'tertiary', bicycle: 'no' })).toBe(true);
  });

  // --- Piste 12 (the motivating case): highway=path + piste:type=nordic ---

  it('Piste 12 style way (highway=path, piste:type=nordic, no bicycle) → true', () => {
    // OSM way 278992292 — a Nordic ski trail in Parc de la Gatineau that
    // slipped into bikepaths.yml via junction-node discovery.
    expect(
      isSkiOnlyWay({
        highway: 'path',
        name: 'Piste 12',
        'piste:type': 'nordic',
        'piste:name': '12',
        'piste:difficulty': 'intermediate',
        'piste:grooming': 'backcountry',
      }),
    ).toBe(true);
  });

  it('piste:name alone (no piste:type) still triggers the filter', () => {
    expect(
      isSkiOnlyWay({ highway: 'path', name: 'Piste 25', 'piste:name': '25' }),
    ).toBe(true);
  });

  // --- Trail #3 (dual-use): must NOT be filtered ---

  it('Trail #3 style way (piste:type=nordic + bicycle=designated + mtb:scale) → false', () => {
    // OSM way 636602417 — real summer MTB trail that's groomed for classic
    // skiing in winter. bicycle=designated is the cycling evidence.
    expect(
      isSkiOnlyWay({
        highway: 'path',
        name: 'Trail #3',
        bicycle: 'designated',
        foot: 'designated',
        'mtb:scale': '2',
        'piste:type': 'nordic',
        surface: 'gravel',
      }),
    ).toBe(false);
  });

  it('highway=path with bicycle=yes + piste:type → false', () => {
    expect(
      isSkiOnlyWay({ highway: 'path', bicycle: 'yes', 'piste:type': 'nordic' }),
    ).toBe(false);
  });

  // --- Ottawa River Pathway: highway=cycleway must never be filtered ---

  it('highway=cycleway + piste:type=nordic → false (cycleway is implicit cycling)', () => {
    // OSM way 35555563 — Ottawa River Pathway segment groomed for skiing
    // in winter. The cycleway tag is enough to keep it.
    expect(
      isSkiOnlyWay({
        highway: 'cycleway',
        name: 'Ottawa River Pathway',
        'piste:type': 'nordic',
      }),
    ).toBe(false);
  });

  it('highway=cycleway with no bicycle tag and no piste tag → false', () => {
    expect(isSkiOnlyWay({ highway: 'cycleway', name: 'Canal Pathway' })).toBe(false);
  });

  // --- Regular non-ski ways: must pass through untouched ---

  it('regular cycling way (no piste, no bicycle=no) → false', () => {
    expect(
      isSkiOnlyWay({
        highway: 'path',
        bicycle: 'designated',
        surface: 'asphalt',
        name: 'Some MUP',
      }),
    ).toBe(false);
  });

  it('regular road → false', () => {
    expect(isSkiOnlyWay({ highway: 'residential', name: 'Main St' })).toBe(false);
  });

  it('footway with name but no piste/bicycle deny → false', () => {
    // A footway without piste tagging is outside this filter's scope.
    expect(isSkiOnlyWay({ highway: 'footway', name: 'Some Walk' })).toBe(false);
  });

  // --- Roads with piste tags: must NOT be filtered (implicit bike access) ---

  it('highway=unclassified road with piste:type=nordic → false', () => {
    // OSM way 622927966 — "Chemin du Lac-Philippe" in Gatineau Park is a
    // road that doubles as a groomed Nordic piste in winter. Roads have
    // implicit cycling access; the filter only targets path/footway ways.
    expect(
      isSkiOnlyWay({
        highway: 'unclassified',
        name: 'Chemin du Lac-Philippe',
        'piste:type': 'nordic',
      }),
    ).toBe(false);
  });

  it('highway=tertiary road with piste:type=nordic → false', () => {
    // OSM way 640411785 — "Promenade du Lac-Fortune" in Gatineau Park.
    expect(
      isSkiOnlyWay({
        highway: 'tertiary',
        name: 'Promenade du Lac-Fortune',
        'piste:type': 'nordic',
      }),
    ).toBe(false);
  });

  it('highway=footway with piste:type=nordic → true', () => {
    // Footways with piste tags are ski/pedestrian infrastructure.
    expect(
      isSkiOnlyWay({ highway: 'footway', 'piste:type': 'nordic', name: 'Ski Walk' }),
    ).toBe(true);
  });
});
