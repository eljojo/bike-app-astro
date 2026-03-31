import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { haversineM } from '../src/lib/geo/proximity';

/**
 * Regression test: the demo city must have GeoJSON geometry so that length_km
 * is computed during the build. A prior rename from /paths to /bike-paths broke
 * this silently. The E2E test in e2e/functional.spec.ts catches the rendered
 * output; this test ensures the fixture data itself is valid.
 */
describe('demo bike path GeoJSON fixture', () => {
  const cacheDir = path.resolve('.cache', 'bikepath-geometry', 'demo');
  const geoFile = path.join(cacheDir, 'name-ciclovia-avenida-ecuador.geojson');

  it('fixture file exists', () => {
    expect(fs.existsSync(geoFile)).toBe(true);
  });

  it('contains LineString features that produce the expected length', () => {
    const geojson = JSON.parse(fs.readFileSync(geoFile, 'utf-8'));
    expect(geojson.features.length).toBeGreaterThanOrEqual(1);

    let totalM = 0;
    for (const feature of geojson.features) {
      const coords: number[][] = feature.geometry.coordinates;
      for (let i = 1; i < coords.length; i++) {
        totalM += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
      }
    }
    const km = Math.round(totalM / 1000 * 10) / 10;
    expect(km).toBe(3.1);
  });
});
