import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLocalCalendarFeedCache } from '../src/lib/calendar-feed-cache/feed-cache.adapter-local';
import type { ParsedFeed } from '../src/lib/calendar-suggestions/types';

describe('CalendarFeedCache — local adapter', () => {
  let dir: string;
  let cache: ReturnType<typeof createLocalCalendarFeedCache>;

  const sampleFeed: ParsedFeed = {
    fetched_at: '2026-04-21T00:00:00.000Z',
    source_url: 'https://example.com/feed.ics',
    events: [{ uid: 'a@x', summary: 'Ride A', start: '2026-05-01T10:00:00.000Z' }],
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calfeed-cache-'));
    cache = createLocalCalendarFeedCache(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('returns null when the slug has no entry', async () => {
    expect(await cache.get('unknown-org', 'https://example.com/feed.ics')).toBeNull();
  });

  test('put then get round-trips the feed', async () => {
    await cache.put('qbc', 'https://example.com/feed.ics', sampleFeed, 3600);
    const read = await cache.get('qbc', 'https://example.com/feed.ics');
    expect(read).toEqual(sampleFeed);
  });

  test('returns null when the stored source_url differs from the expected one', async () => {
    await cache.put('qbc', 'https://old.example.com/feed.ics', sampleFeed, 3600);
    expect(await cache.get('qbc', 'https://new.example.com/feed.ics')).toBeNull();
  });

  test('returns null after the TTL expires', async () => {
    await cache.put('qbc', 'https://example.com/feed.ics', sampleFeed, /* ttlSeconds */ 0);
    // TTL=0 means expires_at = Date.now() — any subsequent read sees it expired.
    await new Promise(r => setTimeout(r, 5));
    expect(await cache.get('qbc', 'https://example.com/feed.ics')).toBeNull();
  });

  test('subsequent put overwrites the previous entry', async () => {
    await cache.put('qbc', 'https://example.com/feed.ics', sampleFeed, 3600);
    const next: ParsedFeed = { ...sampleFeed, events: [{ uid: 'b@x', summary: 'Ride B', start: '2026-05-08T10:00:00.000Z' }] };
    await cache.put('qbc', 'https://example.com/feed.ics', next, 3600);
    const read = await cache.get('qbc', 'https://example.com/feed.ics');
    expect(read?.events[0].uid).toBe('b@x');
  });

  test('returns null on corrupt JSON data file', async () => {
    await cache.put('qbc', 'https://example.com/feed.ics', sampleFeed, 3600);
    // Corrupt the data file but leave the meta file intact.
    const dataFile = fs.readdirSync(dir).find(f => f.endsWith('.json') && !f.endsWith('.meta'));
    expect(dataFile).toBeDefined();
    fs.writeFileSync(path.join(dir, dataFile!), 'not-json');
    expect(await cache.get('qbc', 'https://example.com/feed.ics')).toBeNull();
  });
});
