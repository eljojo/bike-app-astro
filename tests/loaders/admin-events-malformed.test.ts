import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// A malformed content file must cost one event, not the whole build:
// loadAdminEventData runs eagerly from build-data-plugin with nothing
// catching above it, so anything that throws here kills `astro build`.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-events-malformed-'));

vi.stubEnv('CITY', 'testcity');
vi.stubEnv('CONTENT_DIR', tmpDir);

let loadAdminEventData: typeof import('../../src/loaders/admin-events').loadAdminEventData;

// Bad indentation — gray-matter's js-yaml throws YAMLException on this.
// (An unclosed `[` would not: it swallows the closing `---` fence, so
// gray-matter sees no frontmatter at all and quietly returns {}.)
// The name is parameterised because gray-matter caches by content string:
// two byte-identical broken files would throw once and then return {}.
const brokenFrontmatter = (name: string) =>
  `name: ${name}\n  start_date: "2026-05-01"\nstatus: published\n`;

beforeAll(async () => {
  const eventsDir = path.join(tmpDir, 'testcity', 'events', '2026');
  fs.mkdirSync(eventsDir, { recursive: true });

  fs.writeFileSync(
    path.join(eventsDir, 'good-flat.md'),
    '---\nname: Good Flat\nstart_date: "2026-06-01"\n---\n\nA fine ride.\n',
  );
  // Unquoted date — valid YAML, but parses to a Date rather than a string.
  fs.writeFileSync(
    path.join(eventsDir, 'unquoted-date.md'),
    '---\nname: Unquoted Date\nstart_date: 2026-09-01\n---\n\nStill a ride.\n',
  );
  fs.writeFileSync(
    path.join(eventsDir, 'broken-flat.md'),
    `---\n${brokenFrontmatter('Broken Flat')}---\n\nbody\n`,
  );

  const goodDir = path.join(eventsDir, 'good-dir');
  fs.mkdirSync(goodDir, { recursive: true });
  fs.writeFileSync(
    path.join(goodDir, 'index.md'),
    '---\nname: Good Dir\nstart_date: "2026-07-01"\n---\n\nAnother fine ride.\n',
  );

  const brokenDir = path.join(eventsDir, 'broken-dir');
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(
    path.join(brokenDir, 'index.md'),
    `---\n${brokenFrontmatter('Broken Dir')}---\n\nbody\n`,
  );

  // Valid frontmatter, unparseable media.yml — the event survives, media doesn't.
  const badMediaDir = path.join(eventsDir, 'bad-media');
  fs.mkdirSync(badMediaDir, { recursive: true });
  fs.writeFileSync(
    path.join(badMediaDir, 'index.md'),
    '---\nname: Bad Media\nstart_date: "2026-08-01"\n---\n\nRide with broken media.\n',
  );
  fs.writeFileSync(path.join(badMediaDir, 'media.yml'), '- key: photo-1\n- [unclosed\n');

  const mod = await import('../../src/loaders/admin-events');
  loadAdminEventData = mod.loadAdminEventData;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadAdminEventData with malformed content', () => {
  it('skips unparseable events instead of throwing', async () => {
    const { events } = await loadAdminEventData();
    const names = events.map(e => e.name).sort();
    expect(names).toEqual(['Bad Media', 'Good Dir', 'Good Flat', 'Unquoted Date']);
  });

  it('keeps an event whose media.yml is unparseable, with no media', async () => {
    const { events } = await loadAdminEventData();
    const badMedia = events.find(e => e.name === 'Bad Media');
    expect(badMedia).toBeDefined();
    expect(badMedia!.mediaCount).toBe(0);
  });

  it('still hashes the raw media.yml bytes so conflict detection stays honest', async () => {
    const { details } = await loadAdminEventData();
    const detail = details['2026/bad-media'];
    expect(detail).toBeDefined();
    // Hash covers index.md + media.yml; dropping the unparseable media from the
    // hash would make the next save look unchanged when it isn't.
    const { computeEventContentHash } = await import('../../src/lib/models/event-model.server');
    const eventsDir = path.join(tmpDir, 'testcity', 'events', '2026', 'bad-media');
    const expected = computeEventContentHash(
      fs.readFileSync(path.join(eventsDir, 'index.md'), 'utf-8'),
      fs.readFileSync(path.join(eventsDir, 'media.yml'), 'utf-8'),
    );
    expect(detail.contentHash).toBe(expected);
  });
});
