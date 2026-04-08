import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { gpxHash, hashPath, needsRegeneration, mapThumbPaths } from '../src/lib/maps/map-generation.server';
import { MAP_CACHE_DIR } from '../src/lib/maps/map-paths.server';

const TEST_SLUG = '_test-regen';
const TEST_DIR = path.join(MAP_CACHE_DIR, TEST_SLUG);

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// gpxHash
// ---------------------------------------------------------------------------
describe('gpxHash', () => {
  it('returns a 16-char hex string', () => {
    const hash = gpxHash('<gpx>content</gpx>');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns the same hash for the same content (stability)', () => {
    const content = '<gpx>stable content</gpx>';
    expect(gpxHash(content)).toBe(gpxHash(content));
  });

  it('returns different hashes for different content (sensitivity)', () => {
    expect(gpxHash('<gpx>content A</gpx>')).not.toBe(gpxHash('<gpx>content B</gpx>'));
  });
});

// ---------------------------------------------------------------------------
// hashPath
// ---------------------------------------------------------------------------
describe('hashPath', () => {
  it('returns path under public/maps/slug/.gpx-hash', () => {
    const result = hashPath('my-route');
    expect(result).toBe(path.join(MAP_CACHE_DIR, 'my-route', '.gpx-hash'));
  });

  it('path contains slug and .gpx-hash filename', () => {
    const result = hashPath('canal-loop');
    expect(result).toContain('canal-loop');
    expect(path.basename(result)).toBe('.gpx-hash');
  });
});

// ---------------------------------------------------------------------------
// mapThumbPaths
// ---------------------------------------------------------------------------
describe('mapThumbPaths', () => {
  it('returns all 5 expected output paths', () => {
    const paths = mapThumbPaths('my-route');
    expect(paths.thumbLarge).toBe(path.join(MAP_CACHE_DIR, 'my-route', 'map-1500.webp'));
    expect(paths.thumb).toBe(path.join(MAP_CACHE_DIR, 'my-route', 'map-750.webp'));
    expect(paths.thumbSmall).toBe(path.join(MAP_CACHE_DIR, 'my-route', 'map-375.webp'));
    expect(paths.social).toBe(path.join(MAP_CACHE_DIR, 'my-route', 'map-social.jpg'));
    expect(paths.full).toBe(path.join(MAP_CACHE_DIR, 'my-route', 'map.png'));
  });

  it('includes variant key in path when provided', () => {
    const paths = mapThumbPaths('my-route', 'variants-return');
    expect(paths.thumb).toBe(path.join(MAP_CACHE_DIR, 'my-route', 'variants-return', 'map-750.webp'));
    expect(paths.thumbLarge).toContain('variants-return');
  });

});

// ---------------------------------------------------------------------------
// needsRegeneration
// ---------------------------------------------------------------------------

function writeHashFile(slug: string, hash: string): void {
  const hashDir = path.join(MAP_CACHE_DIR, slug);
  fs.mkdirSync(hashDir, { recursive: true });
  fs.writeFileSync(path.join(hashDir, '.gpx-hash'), hash, 'utf-8');
}

function writeOutputFiles(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ['map-1500.webp', 'map-750.webp', 'map-375.webp']) {
    fs.writeFileSync(path.join(dir, file), 'fake', 'utf-8');
  }
}

describe('needsRegeneration', () => {
  it('returns true when no hash file exists', () => {
    expect(needsRegeneration(TEST_SLUG, 'abc123')).toBe(true);
  });

  it('returns true when stored hash differs from current hash', () => {
    writeHashFile(TEST_SLUG, 'oldhash');
    writeOutputFiles(TEST_DIR);
    expect(needsRegeneration(TEST_SLUG, 'newhash')).toBe(true);
  });

  it('returns false when hash matches AND all expected output files exist', () => {
    const hash = gpxHash('<gpx>content</gpx>');
    writeHashFile(TEST_SLUG, hash);
    writeOutputFiles(TEST_DIR);
    expect(needsRegeneration(TEST_SLUG, hash)).toBe(false);
  });

  it('returns true when hash matches but an output file is missing', () => {
    const hash = gpxHash('<gpx>content</gpx>');
    writeHashFile(TEST_SLUG, hash);
    fs.mkdirSync(TEST_DIR, { recursive: true });
    // Write only two of the three required files
    fs.writeFileSync(path.join(TEST_DIR, 'map-1500.webp'), 'fake', 'utf-8');
    fs.writeFileSync(path.join(TEST_DIR, 'map-750.webp'), 'fake', 'utf-8');
    // map-375.webp is missing
    expect(needsRegeneration(TEST_SLUG, hash)).toBe(true);
  });

});
