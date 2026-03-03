import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DIR = path.join(import.meta.dirname, '.test-uploads');

afterAll(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('local bucket adapter', () => {
  it('stores and retrieves files', async () => {
    const { createLocalBucket } = await import('../src/lib/storage-local');
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
    const { createLocalBucket } = await import('../src/lib/storage-local');
    const bucket = createLocalBucket(TEST_DIR);
    const result = await bucket.head('photos/doesnotexist');
    expect(result).toBeNull();
  });
});
