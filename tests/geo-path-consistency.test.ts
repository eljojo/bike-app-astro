import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression test: all functions in build-data-plugin that read bike path
 * GeoJSON files must reference the same directory (public/bike-paths/geo).
 *
 * A rename from /paths to /bike-paths left two functions pointing at the old
 * directory, silently breaking route overlap computation and cover photos.
 */
describe('build-data-plugin geo directory references', () => {
  const pluginSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'build-data-plugin.ts'),
    'utf-8',
  );

  it('all geo directory references use public/bike-paths/geo', () => {
    // Find all lines that construct a path to a geo directory under public/
    const geoPathRefs = pluginSource
      .split('\n')
      .filter(line => /public.*geo/.test(line) && /path\.join/.test(line));

    expect(geoPathRefs.length).toBeGreaterThanOrEqual(3); // loadGeoFiles, loadGeoCoordinates, loadGeoElevation

    for (const line of geoPathRefs) {
      expect(line).toContain("'bike-paths'");
      expect(line).not.toMatch(/['"]paths['"]\s*,\s*['"]geo['"]/);
    }
  });

  it('no references to the old public/paths/geo directory', () => {
    expect(pluginSource).not.toContain("'public', 'paths', 'geo'");
  });
});
