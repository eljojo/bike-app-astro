import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DIR = path.join(import.meta.dirname, '.test-uploads');

// Minimal valid 1x1 PNG for upload validation tests
const VALID_PNG = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
  0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
  0x44, 0xAE, 0x42, 0x60, 0x82,
]);

afterAll(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('local bucket adapter', () => {
  it('stores and retrieves files', async () => {
    const { createLocalBucket } = await import('../src/lib/media/storage.adapter-local');
    const bucket = createLocalBucket(TEST_DIR);

    await bucket.put('photos/testkey1', Buffer.from('fake image data'));

    const head = await bucket.head('photos/testkey1');
    expect(head).not.toBeNull();
    expect(head!.size).toBeGreaterThan(0);

    const obj = await bucket.get('photos/testkey1');
    expect(obj).not.toBeNull();

    await bucket.delete('photos/testkey1');
    const after = await bucket.head('photos/testkey1');
    expect(after).toBeNull();
  });

  it('head returns null for non-existent files', async () => {
    const { createLocalBucket } = await import('../src/lib/media/storage.adapter-local');
    const bucket = createLocalBucket(TEST_DIR);
    const result = await bucket.head('photos/doesnotexist');
    expect(result).toBeNull();
  });
});

describe('staged upload flow', () => {
  it('stores to pending, validates, promotes to photos', async () => {
    const { createLocalBucket } = await import('../src/lib/media/storage.adapter-local');
    const bucket = createLocalBucket(TEST_DIR);
    const { confirmUpload } = await import('../src/lib/media/storage.adapter-r2');

    // Simulate presign + upload to pending
    await bucket.put('uploads/pending/testimg1', VALID_PNG);

    // Confirm should validate, promote to bucket root, return key as R2 path
    const result = await confirmUpload(bucket, 'testimg1');
    expect(result.key).toBe('testimg1');
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.contentType).toBe('image/png');

    // File should be at bucket root now, not pending/
    const promoted = await bucket.head('testimg1');
    expect(promoted).not.toBeNull();
    const pending = await bucket.head('uploads/pending/testimg1');
    expect(pending).toBeNull();
  });

  it('rejects non-image uploads', async () => {
    const { createLocalBucket } = await import('../src/lib/media/storage.adapter-local');
    const bucket = createLocalBucket(TEST_DIR);
    const { confirmUpload } = await import('../src/lib/media/storage.adapter-r2');

    await bucket.put('uploads/pending/badfile', Buffer.from('not an image'));

    await expect(confirmUpload(bucket, 'badfile')).rejects.toThrow('Invalid image');

    // File should be cleaned up from pending
    const pending = await bucket.head('uploads/pending/badfile');
    expect(pending).toBeNull();
  });
});
