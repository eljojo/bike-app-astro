import { describe, it, expect } from 'vitest';
import { computeDirectoryDigest, computeFileDigest } from '../src/lib/directory-digest.server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('computeFileDigest', () => {
  it('produces consistent digest for same files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world');

    const d1 = computeFileDigest([
      path.join(tmpDir, 'a.txt'),
      path.join(tmpDir, 'b.txt'),
    ]);
    const d2 = computeFileDigest([
      path.join(tmpDir, 'a.txt'),
      path.join(tmpDir, 'b.txt'),
    ]);
    expect(d1).toBe(d2);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns MD5 hex string', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');

    const d = computeFileDigest([path.join(tmpDir, 'a.txt')]);
    expect(d).toMatch(/^[a-f0-9]{32}$/);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('changes when file is modified', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
    const filePath = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(filePath, 'hello');

    const d1 = computeFileDigest([filePath]);

    // Touch the file to change mtime
    const future = new Date(Date.now() + 1000);
    fs.utimesSync(filePath, future, future);

    const d2 = computeFileDigest([filePath]);
    expect(d1).not.toBe(d2);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('skips non-existent files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
    const filePath = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(filePath, 'hello');

    const d1 = computeFileDigest([filePath]);
    const d2 = computeFileDigest([filePath, path.join(tmpDir, 'missing.txt')]);
    // Adding a non-existent file should not crash, but digest should differ
    // because the missing file is simply skipped
    expect(d1).toBe(d2);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('computeDirectoryDigest', () => {
  it('includes files from specified subdirectories', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'content');
    fs.mkdirSync(path.join(tmpDir, 'variants'));
    fs.writeFileSync(path.join(tmpDir, 'variants', 'main.gpx'), 'gpx');

    const d = computeDirectoryDigest(tmpDir, { includeSubdirs: ['variants'] });
    expect(d).toMatch(/^[a-f0-9]{32}$/); // MD5 hex

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('produces consistent digest for same directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'content');
    fs.mkdirSync(path.join(tmpDir, 'variants'));
    fs.writeFileSync(path.join(tmpDir, 'variants', 'main.gpx'), 'gpx');

    const d1 = computeDirectoryDigest(tmpDir, { includeSubdirs: ['variants'] });
    const d2 = computeDirectoryDigest(tmpDir, { includeSubdirs: ['variants'] });
    expect(d1).toBe(d2);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('changes when a file is modified', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'content');

    const d1 = computeDirectoryDigest(tmpDir);

    const future = new Date(Date.now() + 1000);
    fs.utimesSync(path.join(tmpDir, 'index.md'), future, future);

    const d2 = computeDirectoryDigest(tmpDir);
    expect(d1).not.toBe(d2);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('changes when a subdirectory file is modified', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'content');
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'sub', 'file.txt'), 'hello');

    const d1 = computeDirectoryDigest(tmpDir, { includeSubdirs: ['sub'] });

    const future = new Date(Date.now() + 1000);
    fs.utimesSync(path.join(tmpDir, 'sub', 'file.txt'), future, future);

    const d2 = computeDirectoryDigest(tmpDir, { includeSubdirs: ['sub'] });
    expect(d1).not.toBe(d2);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('ignores missing subdirectories', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'content');

    // Should not throw when subdir doesn't exist
    const d = computeDirectoryDigest(tmpDir, { includeSubdirs: ['nonexistent'] });
    expect(d).toMatch(/^[a-f0-9]{32}$/);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('works without options', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-'));
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'content');

    const d = computeDirectoryDigest(tmpDir);
    expect(d).toMatch(/^[a-f0-9]{32}$/);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
