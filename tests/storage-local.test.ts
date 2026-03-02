import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DIR = path.join(import.meta.dirname, '.test-uploads');

afterAll(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('local R2 adapter', () => {
  it('stores and retrieves files', async () => {
    const { createLocalR2 } = await import('../src/lib/storage-local');
    const r2 = createLocalR2(TEST_DIR);

    await r2.put('photos/testkey1', Buffer.from('fake image data'));

    const head = await r2.head('photos/testkey1');
    expect(head).not.toBeNull();
    expect(head!.size).toBeGreaterThan(0);

    const obj = await r2.get('photos/testkey1');
    expect(obj).not.toBeNull();

    await r2.delete('photos/testkey1');
    const after = await r2.head('photos/testkey1');
    expect(after).toBeNull();
  });

  it('head returns null for non-existent files', async () => {
    const { createLocalR2 } = await import('../src/lib/storage-local');
    const r2 = createLocalR2(TEST_DIR);
    const result = await r2.head('photos/doesnotexist');
    expect(result).toBeNull();
  });
});
