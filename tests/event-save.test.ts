import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CITY } from '../src/lib/config/config';

// Mock the JSON-fetching content loader (replaces virtual module mocks)
vi.mock('../src/lib/content/load-admin-content.server', () => ({
  fetchSharedKeysData: vi.fn().mockResolvedValue({}),
}));

// Mock fetch for admin events data endpoint
const _originalFetch = globalThis.fetch;
globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
  const pathname = typeof url === 'string' ? new URL(url).pathname : url.pathname;
  if (pathname === '/admin/data/events.json') {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        events: [
          { id: '2099/bike-fest', organizer: 'bike-club', start_date: '2099-06-01' },
          { id: '2099/hill-climb', organizer: 'bike-club', start_date: '2099-07-01' },
          { id: '2099/solo-event', organizer: 'solo-org', start_date: '2099-08-01' },
        ],
        organizers: [],
      }),
    });
  }
  return _originalFetch(url as any);
}) as any;
vi.mock('../src/lib/env/env.service', () => ({ env: { GIT_BRANCH: 'main', GITHUB_TOKEN: 'test', GIT_OWNER: 'o', GIT_DATA_REPO: 'r' } }));
vi.mock('../src/lib/git/git-factory', () => ({ createGitService: () => ({}) }));
vi.mock('../src/lib/get-db', () => ({ db: () => ({}) }));
const mockExtractFrontmatterField = vi.fn().mockReturnValue(undefined);
const mockParkOrphanedMedia = vi.fn().mockReturnValue(null);
const mockUpdateMediaRegistryCache = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/media/media-parking.server', () => ({
  extractFrontmatterField: (...args: unknown[]) => mockExtractFrontmatterField(...args),
  parkOrphanedMedia: (...args: unknown[]) => mockParkOrphanedMedia(...args),
  updateMediaRegistryCache: (...args: unknown[]) => mockUpdateMediaRegistryCache(...args),
}));

import { isPastEvent, eventHandlers } from '../src/views/api/event-save';

describe('isPastEvent', () => {
  it('returns true for past dates', () => {
    expect(isPastEvent('2024-06-01')).toBe(true);
  });

  it('returns false for future dates', () => {
    expect(isPastEvent('2099-06-01')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPastEvent(undefined)).toBe(false);
  });

  it('today is NOT past (uses strict less-than)', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(isPastEvent(today)).toBe(false);
  });
});

describe('eventHandlers.buildCommitMessage', () => {
  it('new event includes title and Changes trailer', () => {
    const update = { frontmatter: { name: 'Bike Fest' }, body: '' };
    const msg = eventHandlers.buildCommitMessage(update, '2099/bike-fest', true, { primaryFile: null });
    expect(msg).toBe(`Create Bike Fest\n\nChanges: ${CITY}/events/2099/bike-fest`);
  });

  it('update event includes title and Changes trailer', () => {
    const update = { frontmatter: { name: 'Bike Fest' }, body: '' };
    const msg = eventHandlers.buildCommitMessage(update, '2099/bike-fest', false, { primaryFile: null });
    expect(msg).toBe(`Update Bike Fest\n\nChanges: ${CITY}/events/2099/bike-fest`);
  });

  it('falls back to eventId when name missing', () => {
    const update = { frontmatter: {}, body: '' };
    const msg = eventHandlers.buildCommitMessage(update, '2099/bike-fest', false, { primaryFile: null });
    expect(msg).toBe(`Update 2099/bike-fest\n\nChanges: ${CITY}/events/2099/bike-fest`);
  });
});

describe('eventHandlers.resolveContentId', () => {
  it('returns param id for existing events', () => {
    const update = { frontmatter: { name: 'Test' }, body: '' };
    expect(eventHandlers.resolveContentId({ id: '2099/bike-fest' }, update)).toBe('2099/bike-fest');
  });

  it('derives year/slug from start_date and name for new events', () => {
    const update = { frontmatter: { name: 'Summer Ride', start_date: '2099-07-15' }, body: '' };
    expect(eventHandlers.resolveContentId({ id: 'new' }, update)).toBe('2099/summer-ride');
  });

  it('uses explicit slug when provided for new events', () => {
    const update = { frontmatter: { name: 'Summer Ride', start_date: '2099-07-15' }, body: '', slug: 'my-custom-slug' };
    expect(eventHandlers.resolveContentId({ id: 'new' }, update)).toBe('2099/my-custom-slug');
  });

  it('falls back to current year when start_date missing', () => {
    const update = { frontmatter: { name: 'No Date Event' }, body: '' };
    const result = eventHandlers.resolveContentId({ id: 'new' }, update);
    const currentYear = new Date().getFullYear().toString();
    expect(result).toBe(`${currentYear}/no-date-event`);
  });
});

describe('eventHandlers.validateSlug', () => {
  it('rejects missing slug part', () => {
    expect(eventHandlers.validateSlug!('2099/')).not.toBeNull();
  });

  it('rejects too-short slug', () => {
    expect(eventHandlers.validateSlug!('2099/a')).not.toBeNull();
  });

  it('accepts valid event id', () => {
    expect(eventHandlers.validateSlug!('2099/bike-fest')).toBeNull();
  });
});

describe('eventHandlers.parseRequest', () => {
  it('accepts a valid event update', () => {
    const body = {
      frontmatter: { name: 'Test', start_date: '2099-06-01' },
      body: 'Description',
    };
    const parsed = eventHandlers.parseRequest(body);
    expect(parsed.frontmatter.name).toBe('Test');
    expect(parsed.body).toBe('Description');
  });

  it('rejects missing body', () => {
    expect(() => eventHandlers.parseRequest({ frontmatter: { name: 'Test' } })).toThrow();
  });

  it('accepts optional organizer', () => {
    const body = {
      frontmatter: { name: 'Test' },
      body: '',
      organizer: { slug: 'bike-club', name: 'Bike Club', website: 'https://example.com' },
    };
    const parsed = eventHandlers.parseRequest(body);
    expect(parsed.organizer?.slug).toBe('bike-club');
  });
});

describe('eventHandlers.checkExistence', () => {
  it('returns 409 when flat file exists', async () => {
    const mockGit = {
      readFile: vi.fn()
        .mockImplementation((path: string) => {
          if (path.endsWith('.md') && !path.includes('/index.md')) {
            return { content: '---\nname: Existing\n---', sha: 'sha1' };
          }
          return null;
        }),
    };
    const result = await eventHandlers.checkExistence!(mockGit as any, '2099/bike-fest');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(409);
  });

  it('returns 409 when directory file exists', async () => {
    const mockGit = {
      readFile: vi.fn()
        .mockImplementation((path: string) => {
          if (path.includes('/index.md')) {
            return { content: '---\nname: Existing\n---', sha: 'sha1' };
          }
          return null;
        }),
    };
    const result = await eventHandlers.checkExistence!(mockGit as any, '2099/new-event');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(409);
  });

  it('returns null when neither format exists', async () => {
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await eventHandlers.checkExistence!(mockGit as any, '2099/new-event');
    expect(result).toBeNull();
  });
});

describe('eventHandlers.buildFileChanges', () => {
  it('creates directory-based event when media is present', async () => {
    const update = {
      frontmatter: { name: 'Media Event', start_date: '2099-06-01' },
      body: 'Description',
      media: [{ key: 'photo1' }],
    };
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await eventHandlers.buildFileChanges(
      update, '2099/media-event', { primaryFile: null }, mockGit as any,
    );
    expect(result.isNew).toBe(true);
    // Should have index.md and media.yml
    const paths = result.files.map(f => f.path);
    expect(paths).toContain(`${CITY}/events/2099/media-event/index.md`);
    expect(paths).toContain(`${CITY}/events/2099/media-event/media.yml`);
  });

  it('creates flat event when no media', async () => {
    const update = {
      frontmatter: { name: 'Simple Event', start_date: '2099-06-01' },
      body: 'Description',
    };
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await eventHandlers.buildFileChanges(
      update, '2099/simple-event', { primaryFile: null }, mockGit as any,
    );
    expect(result.isNew).toBe(true);
    const paths = result.files.map(f => f.path);
    // No media → flat format (slug.md, not slug/index.md)
    expect(paths).toContain(`${CITY}/events/2099/simple-event.md`);
  });

  it('includes poster dimensions in serialized frontmatter', async () => {
    const update = {
      frontmatter: {
        name: 'Poster Event',
        start_date: '2099-06-01',
        poster_key: 'posters/abc.jpg',
        poster_content_type: 'image/jpeg',
        poster_width: 1200,
        poster_height: 1800,
      },
      body: 'Description',
    };
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await eventHandlers.buildFileChanges(
      update, '2099/poster-event', { primaryFile: null }, mockGit as any,
    );
    const mdFile = result.files.find(f => f.path.endsWith('.md'));
    expect(mdFile).toBeDefined();
    expect(mdFile!.content).toContain('poster_width: 1200');
    expect(mdFile!.content).toContain('poster_height: 1800');
  });

  it('deletes flat file when migrating to directory on media addition', async () => {
    const update = {
      frontmatter: { name: 'Upgrading Event' },
      body: 'Description',
      media: [{ key: 'photo1' }],
    };
    // primaryFile is null (no index.md), but flat .md exists in auxiliaryFiles
    // → resolveEffectivePrimary finds it, so isNew=false, wasDirectory=false
    const currentFiles = {
      primaryFile: null,
      auxiliaryFiles: {
        [`${CITY}/events/2099/upgrading.md`]: {
          content: '---\nname: Upgrading Event\n---\nOld description',
          sha: 'sha-flat',
        },
      },
    };
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await eventHandlers.buildFileChanges(
      update, '2099/upgrading', currentFiles, mockGit as any,
    );
    const paths = result.files.map(f => f.path);
    // Should create directory format files
    expect(paths).toContain(`${CITY}/events/2099/upgrading/index.md`);
    expect(paths).toContain(`${CITY}/events/2099/upgrading/media.yml`);
    // Should delete the old flat file
    expect(result.deletePaths).toContain(`${CITY}/events/2099/upgrading.md`);
  });
});

describe('eventHandlers.afterCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates photo registry with poster key change', async () => {
    const result = {
      files: [],
      deletePaths: [],
      isNew: false,
      oldPosterKey: 'old-photo-key',
      newPosterKey: 'new-photo-key',
      eventSlug: '2099/bike-fest',
      mergedParked: undefined,
      addedMediaKeys: [],
      removedMediaKeys: [],
    };
    const mockDb = {};
    await eventHandlers.afterCommit!(result as any, mockDb as any);
    expect(mockUpdateMediaRegistryCache).toHaveBeenCalledWith(
      expect.objectContaining({
        database: mockDb,
        keyChanges: expect.arrayContaining([
          expect.objectContaining({ key: 'old-photo-key', action: 'remove' }),
          expect.objectContaining({ key: 'new-photo-key', action: 'add' }),
        ]),
      }),
    );
  });

  it('includes media key changes in registry update', async () => {
    const result = {
      files: [],
      deletePaths: [],
      isNew: false,
      oldPosterKey: undefined,
      newPosterKey: undefined,
      eventSlug: '2099/bike-fest',
      mergedParked: undefined,
      addedMediaKeys: ['added-photo'],
      removedMediaKeys: ['removed-photo'],
    };
    await eventHandlers.afterCommit!(result as any, {} as any);
    expect(mockUpdateMediaRegistryCache).toHaveBeenCalledWith(
      expect.objectContaining({
        keyChanges: expect.arrayContaining([
          expect.objectContaining({ key: 'added-photo', action: 'add' }),
          expect.objectContaining({ key: 'removed-photo', action: 'remove' }),
        ]),
      }),
    );
  });

  it('passes mergedParked to photo registry', async () => {
    const mergedParked = [{ key: 'parked-photo', from: { type: 'event', slug: '2099/old' } }];
    const result = {
      files: [],
      deletePaths: [],
      isNew: false,
      oldPosterKey: undefined,
      newPosterKey: undefined,
      eventSlug: '2099/bike-fest',
      mergedParked,
      addedMediaKeys: [],
      removedMediaKeys: [],
    };
    await eventHandlers.afterCommit!(result as any, {} as any);
    expect(mockUpdateMediaRegistryCache).toHaveBeenCalledWith(
      expect.objectContaining({ mergedParked }),
    );
  });

  it('does nothing when no key changes and no parked photos', async () => {
    const result = {
      files: [],
      deletePaths: [],
      isNew: true,
      oldPosterKey: undefined,
      newPosterKey: undefined,
      eventSlug: '2099/bike-fest',
      mergedParked: undefined,
      addedMediaKeys: [],
      removedMediaKeys: [],
    };
    await eventHandlers.afterCommit!(result as any, {} as any);
    expect(mockUpdateMediaRegistryCache).toHaveBeenCalledWith(
      expect.objectContaining({ keyChanges: [] }),
    );
  });
});
