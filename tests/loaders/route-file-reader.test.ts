import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readRouteDir } from '../../src/loaders/route-file-reader';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-reader-'));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

function createRouteFixture(slug: string, opts: {
  frontmatter?: string;
  body?: string;
  mediaYml?: string;
  gpxFiles?: Record<string, string>;
  translations?: Record<string, string>;
} = {}) {
  const routeDir = path.join(tmpDir, slug);
  fs.mkdirSync(routeDir, { recursive: true });

  const fm = opts.frontmatter ?? `name: Test Route\nstatus: published\nvariants:\n  - name: Main\n    gpx: main.gpx\n    distance_km: 10`;
  const body = opts.body ?? 'A nice ride along the river.';
  fs.writeFileSync(path.join(routeDir, 'index.md'), `---\n${fm}\n---\n\n${body}`);

  if (opts.mediaYml) {
    fs.writeFileSync(path.join(routeDir, 'media.yml'), opts.mediaYml);
  }

  const gpxFiles = opts.gpxFiles ?? {
    'main.gpx': `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk><trkseg>
    <trkpt lat="45.0" lon="-75.0"><ele>50</ele></trkpt>
    <trkpt lat="45.1" lon="-75.1"><ele>60</ele></trkpt>
  </trkseg></trk>
</gpx>`
  };

  for (const [filename, content] of Object.entries(gpxFiles)) {
    fs.writeFileSync(path.join(routeDir, filename), content);
  }

  if (opts.translations) {
    for (const [locale, content] of Object.entries(opts.translations)) {
      fs.writeFileSync(path.join(routeDir, `index.${locale}.md`), content);
    }
  }

  return routeDir;
}

describe('readRouteDir', () => {
  it('parses frontmatter and body from index.md', () => {
    const routePath = createRouteFixture('basic-route');
    const result = readRouteDir(routePath, 'basic-route');
    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe('Test Route');
    expect(result!.body).toBe('A nice ride along the river.');
  });

  it('loads and parses media.yml', () => {
    const routePath = createRouteFixture('media-route', {
      mediaYml: '- key: abc123\n  type: photo\n  caption: Canal view\n- key: def456\n  type: photo\n  cover: true',
    });
    const result = readRouteDir(routePath, 'media-route');
    expect(result!.media).toHaveLength(2);
    expect(result!.media[0].key).toBe('abc123');
    expect(result!.media[1].cover).toBe(true);
  });

  it('returns empty media array when no media.yml exists', () => {
    const routePath = createRouteFixture('no-media-route');
    const result = readRouteDir(routePath, 'no-media-route');
    expect(result!.media).toEqual([]);
  });

  it('parses GPX tracks referenced in frontmatter variants', () => {
    const routePath = createRouteFixture('gpx-route');
    const result = readRouteDir(routePath, 'gpx-route');
    expect(result!.gpxTracks).toHaveProperty('main.gpx');
    expect(result!.gpxTracks['main.gpx'].points.length).toBeGreaterThan(0);
    expect(result!.gpxTracks['main.gpx'].distance_m).toBeGreaterThan(0);
  });

  it('preserves raw file contents for content hashing', () => {
    const routePath = createRouteFixture('raw-route', {
      mediaYml: '- key: abc\n  type: photo',
    });
    const result = readRouteDir(routePath, 'raw-route');
    expect(result!.rawContents.indexMd).toContain('name: Test Route');
    expect(result!.rawContents.mediaYml).toContain('key: abc');
    expect(result!.rawContents.gpxFiles).toHaveProperty('main.gpx');
  });

  it('loads locale translation files', () => {
    const routePath = createRouteFixture('translated-route', {
      translations: {
        fr: '---\nname: Route Test\n---\n\nUne belle balade.',
      },
    });
    const result = readRouteDir(routePath, 'translated-route', ['fr']);
    expect(result!.translations).toHaveProperty('fr');
    expect(result!.translations.fr.frontmatter.name).toBe('Route Test');
    expect(result!.translations.fr.body).toBe('Une belle balade.');
  });

  it('returns null when index.md is missing', () => {
    const routePath = path.join(tmpDir, 'missing-index');
    fs.mkdirSync(routePath, { recursive: true });
    const result = readRouteDir(routePath, 'missing-index');
    expect(result).toBeNull();
  });

  it('returns empty track for GPX with no valid track data', () => {
    const routePath = createRouteFixture('bad-gpx', {
      gpxFiles: { 'main.gpx': 'not valid xml at all' },
    });
    const result = readRouteDir(routePath, 'bad-gpx');
    expect(result).not.toBeNull();
    // parseGpx returns an empty track (0 points) for unparseable XML
    expect(result!.gpxTracks['main.gpx'].points).toEqual([]);
    expect(result!.gpxTracks['main.gpx'].distance_m).toBe(0);
  });
});
