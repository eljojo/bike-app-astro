import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readRideFile } from '../../src/loaders/ride-file-reader';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ride-reader-'));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

const MINIMAL_GPX = `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk><trkseg>
    <trkpt lat="45.0" lon="-75.0"><ele>50</ele><time>2026-01-23T14:00:00Z</time></trkpt>
    <trkpt lat="45.1" lon="-75.1"><ele>60</ele><time>2026-01-23T14:30:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

function createRideFixture(relPath: string, opts: {
  sidecarMd?: string;
  mediaYml?: string;
  gpx?: string;
} = {}) {
  const absPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, opts.gpx ?? MINIMAL_GPX);

  if (opts.sidecarMd) {
    const mdPath = absPath.replace(/\.gpx$/i, '.md');
    fs.writeFileSync(mdPath, opts.sidecarMd);
  }

  if (opts.mediaYml) {
    const mediaPath = absPath.replace(/\.gpx$/i, '-media.yml');
    fs.writeFileSync(mediaPath, opts.mediaYml);
  }
}

describe('readRideFile', () => {
  it('parses GPX track with distance and elevation', () => {
    createRideFixture('2026/01/23-basic.gpx');
    const result = readRideFile(tmpDir, '2026/01/23-basic.gpx');
    expect(result).not.toBeNull();
    expect(result!.gpxTrack.distance_m).toBeGreaterThan(0);
    expect(result!.gpxTrack.points.length).toBe(2);
  });

  it('extracts date and builds slug from path', () => {
    createRideFixture('2026/03/15-spring-ride.gpx');
    const result = readRideFile(tmpDir, '2026/03/15-spring-ride.gpx');
    expect(result!.date).toEqual({ year: 2026, month: 3, day: 15 });
    expect(result!.slug).toBe('2026-03-15-spring-ride');
  });

  it('builds name-only slug for tour rides', () => {
    createRideFixture('2026/06/spain/01-first-day.gpx');
    const result = readRideFile(tmpDir, '2026/06/spain/01-first-day.gpx', 'spain');
    expect(result!.slug).toBe('first-day');
    expect(result!.tourSlug).toBe('spain');
  });

  it('loads sidecar .md frontmatter and body', () => {
    createRideFixture('2026/01/23-canal.gpx', {
      sidecarMd: '---\nname: Canal Ride\ncountry: CA\nhighlight: true\n---\n\nGreat winter ride.',
    });
    const result = readRideFile(tmpDir, '2026/01/23-canal.gpx');
    expect(result!.frontmatter.name).toBe('Canal Ride');
    expect(result!.frontmatter.country).toBe('CA');
    expect(result!.frontmatter.highlight).toBe(true);
    expect(result!.body).toBe('Great winter ride.');
  });

  it('loads -media.yml', () => {
    createRideFixture('2026/01/23-photos.gpx', {
      mediaYml: '- key: abc123\n  type: photo\n  caption: River view',
    });
    const result = readRideFile(tmpDir, '2026/01/23-photos.gpx');
    expect(result!.media).toHaveLength(1);
    expect(result!.media[0].key).toBe('abc123');
  });

  it('preserves raw contents for content hashing', () => {
    createRideFixture('2026/01/23-raw.gpx', {
      sidecarMd: '---\nname: Raw Test\n---\n\nBody.',
      mediaYml: '- key: x\n  type: photo',
    });
    const result = readRideFile(tmpDir, '2026/01/23-raw.gpx');
    expect(result!.rawContents.sidecarMd).toContain('name: Raw Test');
    expect(result!.rawContents.gpxXml).toContain('<gpx');
    expect(result!.rawContents.mediaYml).toContain('key: x');
  });

  it('returns null for invalid date paths', () => {
    createRideFixture('invalid/path.gpx');
    const result = readRideFile(tmpDir, 'invalid/path.gpx');
    expect(result).toBeNull();
  });

  it('returns null when GPX has no valid track data', () => {
    createRideFixture('2026/01/23-bad.gpx', { gpx: 'not xml' });
    const result = readRideFile(tmpDir, '2026/01/23-bad.gpx');
    // parseGpx returns empty track (0 points) for non-GPX content — treat as failed
    expect(result).toBeNull();
  });

  it('returns empty defaults when no sidecar files exist', () => {
    createRideFixture('2026/02/10-solo.gpx');
    const result = readRideFile(tmpDir, '2026/02/10-solo.gpx');
    expect(result!.frontmatter).toEqual({});
    expect(result!.body).toBe('');
    expect(result!.media).toEqual([]);
    expect(result!.rawContents.sidecarMd).toBeUndefined();
    expect(result!.rawContents.mediaYml).toBeUndefined();
  });
});
