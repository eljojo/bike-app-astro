import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readContentCache, writeContentCache, type ContentCache } from '../../src/lib/content/content-cache.server';

describe('content-cache', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-cache-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  describe('readContentCache', () => {
    it('returns empty entries when cache file does not exist', () => {
      const cache = readContentCache(path.join(cacheDir, 'missing.json'), 1);
      expect(cache.entries).toEqual({});
    });

    it('returns empty entries when version mismatches', () => {
      const data: ContentCache = { version: 1, entries: { foo: { digest: 'abc', data: { x: 1 } } } };
      fs.writeFileSync(path.join(cacheDir, 'old.json'), JSON.stringify(data));
      const cache = readContentCache(path.join(cacheDir, 'old.json'), 2);
      expect(cache.entries).toEqual({});
    });

    it('returns entries when version matches', () => {
      const data: ContentCache = { version: 3, entries: { bar: { digest: 'def', data: { y: 2 } } } };
      fs.writeFileSync(path.join(cacheDir, 'valid.json'), JSON.stringify(data));
      const cache = readContentCache(path.join(cacheDir, 'valid.json'), 3);
      expect(cache.entries).toEqual({ bar: { digest: 'def', data: { y: 2 } } });
    });

    it('returns empty entries on corrupted JSON', () => {
      fs.writeFileSync(path.join(cacheDir, 'bad.json'), 'not json');
      const cache = readContentCache(path.join(cacheDir, 'bad.json'), 1);
      expect(cache.entries).toEqual({});
    });
  });

  describe('writeContentCache', () => {
    it('creates cache directory and writes file', () => {
      const filePath = path.join(cacheDir, 'sub', 'cache.json');
      const entries = { slug1: { digest: 'aaa', data: { name: 'Test' } } };
      writeContentCache(filePath, 1, entries);

      const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(written.version).toBe(1);
      expect(written.entries.slug1.digest).toBe('aaa');
    });
  });
});
