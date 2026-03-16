import { describe, it, expect, vi } from 'vitest';
import { CITY } from '../src/lib/config/config';

// --- Mocks ---

vi.mock('../src/lib/env/env.service', () => ({
  env: {
    GITHUB_TOKEN: 'test-token',
    GIT_OWNER: 'test-owner',
    GIT_DATA_REPO: 'test-repo',
  },
}));

// eslint-disable-next-line bike-app/no-hardcoded-city-locale -- mock definition
vi.mock('../src/lib/config/config', () => ({ CITY: 'ottawa' }));

// slug module is not mocked — uses real slugify/validateSlug (pure functions)

vi.mock('../src/lib/content/file-serializers', () => ({
  serializeMdFile: (fm: Record<string, unknown>, body: string) =>
    `---\n${JSON.stringify(fm)}\n---\n${body}`,
  serializeYamlFile: (data: unknown[]) => JSON.stringify(data),
}));

vi.mock('../src/lib/media/media-merge', () => ({
  mergeMedia: (incoming: unknown[], _existing: unknown[]) => incoming,
}));

vi.mock('../src/lib/gpx/parse', () => ({
  parseGpx: () => ({ points: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }] }),
}));

vi.mock('../src/lib/git/git-gpx', () => ({
  commitGpxFile: (opts: Record<string, unknown>) =>
    Promise.resolve({ path: opts.path, content: opts.content }),
}));

vi.mock('../src/lib/models/ride-model', async () => {
  const { z } = await import('astro/zod');
  return {
    computeRideContentHashFromFiles: () => 'ride-hash-123',
    buildFreshRideData: (_slug: string) => '{}',
    rideVariantSchema: z.object({
      gpx: z.string(),
      label: z.string().optional(),
    }),
  };
});

vi.mock('../src/lib/models/content-model', async () => {
  const { z } = await import('astro/zod');
  return {
    baseMediaItemSchema: z.object({
      key: z.string(),
      type: z.enum(['photo', 'video']).optional(),
      caption: z.string().optional(),
      cover: z.boolean().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      title: z.string().optional(),
      handle: z.string().optional(),
      duration: z.string().optional(),
      orientation: z.string().optional(),
    }),
  };
});

vi.mock('../src/lib/media/photo-parking', () => ({
  updatePhotoRegistryCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('virtual:bike-app/photo-shared-keys', () => ({
  default: {},
}));

const mockMergeFrontmatter = vi.fn((_isNew: boolean, _existing: string | null, fm: Record<string, unknown>) => fm);
const mockLoadExistingMedia = vi.fn().mockReturnValue([]);
const mockComputeMediaKeyDiff = vi.fn().mockReturnValue({ addedKeys: [], removedKeys: [] });
vi.mock('../src/lib/content/save-helpers', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    buildMediaKeyChanges: () => [],
    computeMediaKeyDiff: (a: unknown[], b: unknown[]) => mockComputeMediaKeyDiff(a, b),
    buildCommitTrailer: (path: string) => `\n\nFile: ${path}`,
    mergeFrontmatter: (a: boolean, b: string | null, c: Record<string, unknown>) => mockMergeFrontmatter(a, b, c),
    loadExistingMedia: (a: unknown) => mockLoadExistingMedia(a),
    afterCommitMediaCleanup: vi.fn().mockResolvedValue(undefined),
  };
});

const mockEnrichMediaFromVideoJobs = vi.fn((_media: unknown[], _db?: unknown) =>
  Promise.resolve({ enrichedMedia: _media, consumedKeys: [] }) as Promise<{ enrichedMedia: unknown[]; consumedKeys: string[] }>);
vi.mock('../src/lib/media/video-enrichment', () => ({
  enrichMediaFromVideoJobs: (a: unknown[], b: unknown) => mockEnrichMediaFromVideoJobs(a, b),
  deleteConsumedVideoJobs: vi.fn().mockResolvedValue(undefined),
}));

const mockVideoKeyForGit = vi.fn((key: string) => key);
vi.mock('../src/lib/media/video-service', () => ({
  // Real videoKeyForGit returns bare key when VIDEO_PREFIX === CITY (default ottawa config)
  videoKeyForGit: (key: string) => mockVideoKeyForGit(key),
  bareVideoKey: (key: string) => key.includes('/') ? key.split('/').pop()! : key,
}));

vi.mock('../src/lib/get-db', () => ({
  db: () => ({}),
}));

vi.mock('../src/lib/redirects', () => ({
  buildRedirectFileChange: () =>
    Promise.resolve({ path: '_redirects/test', content: 'redirect' }),
}));

vi.mock('../src/lib/content/content-save', () => ({
  saveContent: vi.fn(),
}));

const { createRideHandlers } = await import('../src/views/api/ride-save');

describe('ride-save handlers', () => {
  describe('parseRequest', () => {
    it('parses valid ride update and captures gpxRelativePath', () => {
      const handlers = createRideHandlers();
      const body = {
        frontmatter: { name: 'Morning Ride' },
        body: 'Great ride today',
        gpxRelativePath: '2026/03/15-morning-ride.gpx',
      };
      const result = handlers.parseRequest(body);
      expect(result.frontmatter.name).toBe('Morning Ride');
      expect(result.body).toBe('Great ride today');
    });

    it('derives gpxRelativePath from ride_date + variant GPX filename for new rides', () => {
      const handlers = createRideHandlers();
      const body = {
        frontmatter: { name: 'Sunset Loop', ride_date: '2026-03-15' },
        body: '',
        variants: [{ gpx: 'sunset-loop.gpx', gpxContent: '<gpx/>', isNew: true }],
      };
      handlers.parseRequest(body);
      // After parseRequest, getFilePaths should work (gpxRelPath was derived)
      const filePaths = handlers.getFilePaths('anything');
      expect(filePaths.primary).toContain(`${CITY}/rides/2026/03/15-sunset-loop.md`);
    });

    it('strips full date prefix from GPX filename (Strava import)', () => {
      const handlers = createRideHandlers();
      const body = {
        frontmatter: { name: 'Strava Ride', ride_date: '2026-07-04' },
        body: '',
        variants: [{ gpx: '2026-07-04-river-trail.gpx', gpxContent: '<gpx/>', isNew: true }],
      };
      handlers.parseRequest(body);
      const filePaths = handlers.getFilePaths('anything');
      // Should normalize to DD-name format: 04-river-trail
      expect(filePaths.primary).toContain('04-river-trail.md');
    });

    it('includes tour slug in derived path', () => {
      const handlers = createRideHandlers();
      const body = {
        frontmatter: { name: 'Day 1', ride_date: '2026-06-10', tour_slug: 'euro-trip' },
        body: '',
        variants: [{ gpx: 'day-1.gpx', gpxContent: '<gpx/>', isNew: true }],
      };
      handlers.parseRequest(body);
      const filePaths = handlers.getFilePaths('anything');
      expect(filePaths.primary).toContain('euro-trip');
      expect(filePaths.primary).toContain('10-day-1.md');
    });
  });

  describe('resolveContentId', () => {
    it('returns param slug for existing rides', () => {
      const handlers = createRideHandlers();
      const result = handlers.resolveContentId(
        { slug: '2026-03-15-morning-ride' } as any,
        { frontmatter: { name: 'Morning Ride' }, body: '' } as any,
      );
      expect(result).toBe('2026-03-15-morning-ride');
    });

    it('generates date-prefixed slug for new standalone rides', () => {
      const handlers = createRideHandlers();
      const result = handlers.resolveContentId(
        { slug: 'new' } as any,
        { frontmatter: { name: 'Morning Ride', ride_date: '2026-03-15' }, body: '' } as any,
      );
      expect(result).toBe('2026-03-15-morning-ride');
    });

    it('generates name-only slug for new tour rides', () => {
      const handlers = createRideHandlers();
      const result = handlers.resolveContentId(
        { slug: 'new' } as any,
        { frontmatter: { name: 'Day One', ride_date: '2026-06-10', tour_slug: 'euro-trip' }, body: '' } as any,
      );
      expect(result).toBe('day-one');
    });
  });

  describe('validateSlug', () => {
    it('returns null for valid slug', () => {
      const handlers = createRideHandlers();
      expect(handlers.validateSlug('2026-03-15-morning-ride')).toBeNull();
    });

    it('returns error for empty slug', () => {
      const handlers = createRideHandlers();
      expect(handlers.validateSlug('')).toBeTruthy();
    });
  });

  describe('getFilePaths', () => {
    it('throws when gpxRelPath is not set', () => {
      const handlers = createRideHandlers();
      expect(() => handlers.getFilePaths('test')).toThrow('gpxRelativePath is required');
    });

    it('returns sidecar as primary, gpx and media as auxiliary', () => {
      const handlers = createRideHandlers();
      handlers.parseRequest({
        frontmatter: { name: 'Test' },
        body: '',
        gpxRelativePath: '2026/03/15-test.gpx',
      });
      const paths = handlers.getFilePaths('test');
      expect(paths.primary).toBe(`${CITY}/rides/2026/03/15-test.md`);
      expect(paths.auxiliary).toContain(`${CITY}/rides/2026/03/15-test.gpx`);
      expect(paths.auxiliary).toContain(`${CITY}/rides/2026/03/15-test-media.yml`);
    });
  });

  describe('buildCommitMessage', () => {
    it('returns create message for new ride', () => {
      const handlers = createRideHandlers();
      handlers.parseRequest({
        frontmatter: { name: 'River Trail' },
        body: '',
        gpxRelativePath: '2026/03/15-river-trail.gpx',
      });
      const msg = handlers.buildCommitMessage(
        { frontmatter: { name: 'River Trail' }, body: '' } as any,
        '2026-03-15-river-trail',
        true,
        {} as any,
      );
      expect(msg).toContain('Create ride River Trail');
    });

    it('returns update message for existing ride', () => {
      const handlers = createRideHandlers();
      handlers.parseRequest({
        frontmatter: { name: 'River Trail' },
        body: '',
        gpxRelativePath: '2026/03/15-river-trail.gpx',
      });
      const msg = handlers.buildCommitMessage(
        { frontmatter: { name: 'River Trail' }, body: '' } as any,
        '2026-03-15-river-trail',
        false,
        {} as any,
      );
      expect(msg).toContain('Update ride River Trail');
    });

    it('mentions media and GPX count in commit message', () => {
      const handlers = createRideHandlers();
      handlers.parseRequest({
        frontmatter: { name: 'Big Day' },
        body: '',
        gpxRelativePath: '2026/03/15-big-day.gpx',
      });
      const msg = handlers.buildCommitMessage(
        {
          frontmatter: { name: 'Big Day' },
          body: '',
          media: [{ key: 'photo.jpg', type: 'photo' }],
          variants: [
            { gpx: 'main.gpx', isNew: true, gpxContent: '<gpx/>' },
            { gpx: 'alt.gpx', isNew: true, gpxContent: '<gpx/>' },
          ],
        } as any,
        '2026-03-15-big-day',
        false,
        {} as any,
      );
      expect(msg).toContain('media');
      expect(msg).toContain('2 GPX');
    });
  });

  describe('checkExistence', () => {
    it('returns null when no existing sidecar', async () => {
      const handlers = createRideHandlers();
      handlers.parseRequest({
        frontmatter: { name: 'Test' },
        body: '',
        gpxRelativePath: '2026/03/15-test.gpx',
      });
      const git = { readFile: vi.fn().mockResolvedValue(null) } as any;
      const result = await handlers.checkExistence!(git, '2026-03-15-test');
      expect(result).toBeNull();
    });

    it('returns suffixed slug when sidecar exists', async () => {
      const handlers = createRideHandlers();
      handlers.parseRequest({
        frontmatter: { name: 'Test' },
        body: '',
        gpxRelativePath: '2026/03/15-test.gpx',
      });
      const git = {
        readFile: vi.fn()
          .mockResolvedValueOnce('exists')   // original path exists
          .mockResolvedValueOnce(null),       // -2 path is free
      } as any;
      const result = await handlers.checkExistence!(git, '2026-03-15-test');
      expect(result).toBe('2026-03-15-test-2');
    });

    it('returns 409 when all suffix slots are taken', async () => {
      const handlers = createRideHandlers();
      handlers.parseRequest({
        frontmatter: { name: 'Test' },
        body: '',
        gpxRelativePath: '2026/03/15-test.gpx',
      });
      const git = {
        readFile: vi.fn().mockResolvedValue('exists'), // all slots taken
      } as any;
      const result = await handlers.checkExistence!(git, '2026-03-15-test');
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(409);
    });
  });

  describe('buildFileChanges', () => {
    it('creates sidecar .md for new ride', async () => {
      const handlers = createRideHandlers();
      const update = handlers.parseRequest({
        frontmatter: { name: 'Morning Ride' },
        body: 'Great day',
        gpxRelativePath: '2026/03/15-morning-ride.gpx',
      });
      const mockGit = { readFile: vi.fn().mockResolvedValue(null) } as any;
      const result = await handlers.buildFileChanges(
        update, '2026-03-15-morning-ride', { primaryFile: null }, mockGit,
      );
      const paths = result.files.map((f: { path: string }) => f.path);
      expect(paths).toContain(`${CITY}/rides/2026/03/15-morning-ride.md`);
      expect(result.isNew).toBe(true);
    });

    it('creates media file when media is present', async () => {
      const handlers = createRideHandlers();
      const update = handlers.parseRequest({
        frontmatter: { name: 'Photo Ride' },
        body: '',
        gpxRelativePath: '2026/03/15-photo-ride.gpx',
        media: [{ key: 'abc123', type: 'photo' }],
      });
      const mockGit = { readFile: vi.fn().mockResolvedValue(null) } as any;
      const result = await handlers.buildFileChanges(
        update, '2026-03-15-photo-ride', { primaryFile: null }, mockGit,
      );
      const paths = result.files.map((f: { path: string }) => f.path);
      expect(paths).toContain(`${CITY}/rides/2026/03/15-photo-ride-media.yml`);
    });

    it('commits GPX file for new variant', async () => {
      const handlers = createRideHandlers();
      const update = handlers.parseRequest({
        frontmatter: { name: 'GPX Ride', ride_date: '2026-03-15' },
        body: '',
        gpxRelativePath: '2026/03/15-gpx-ride.gpx',
        variants: [{ gpx: '15-gpx-ride.gpx', isNew: true, gpxContent: '<gpx><trk></trk></gpx>' }],
      });
      const mockGit = { readFile: vi.fn().mockResolvedValue(null) } as any;
      const result = await handlers.buildFileChanges(
        update, '2026-03-15-gpx-ride', { primaryFile: null }, mockGit,
      );
      const paths = result.files.map((f: { path: string }) => f.path);
      expect(paths.some((p: string) => p.endsWith('.gpx'))).toBe(true);
    });

    it('deletes old files and creates redirect on slug rename', async () => {
      const handlers = createRideHandlers();
      const update = handlers.parseRequest({
        frontmatter: { name: 'Renamed Ride' },
        body: '',
        gpxRelativePath: '2026/03/15-old-name.gpx',
        newSlug: '2026-03-15-new-name',
      });
      const existingFile = { content: '---\nname: Old\n---\n', sha: 'sha-old' };
      const mockGit = { readFile: vi.fn().mockResolvedValue(null) } as any;
      const result = await handlers.buildFileChanges(
        update, '2026-03-15-old-name', { primaryFile: existingFile }, mockGit,
      );
      // Old files should be in deletePaths
      expect(result.deletePaths).toContain(`${CITY}/rides/2026/03/15-old-name.md`);
      expect(result.deletePaths).toContain(`${CITY}/rides/2026/03/15-old-name.gpx`);
      // Redirect file should be generated
      const paths = result.files.map((f: { path: string }) => f.path);
      expect(paths.some((p: string) => p.includes('_redirects'))).toBe(true);
    });

    it('calls mergeFrontmatter with isNew=false and existing content for updates', async () => {
      mockMergeFrontmatter.mockClear();
      const handlers = createRideHandlers();
      const existingContent = '---\nname: Old Name\nstrava_id: "123"\n---\nOld body';
      const update = handlers.parseRequest({
        frontmatter: { name: 'Updated Name' },
        body: 'New body',
        gpxRelativePath: '2026/03/15-ride.gpx',
      });
      const mockGit = { readFile: vi.fn().mockResolvedValue(null) } as any;
      await handlers.buildFileChanges(
        update, '2026-03-15-ride',
        { primaryFile: { content: existingContent, sha: 'sha-1' } },
        mockGit,
      );
      expect(mockMergeFrontmatter).toHaveBeenCalledWith(
        false, // isNew
        existingContent, // existing content passed through for frontmatter extraction
        expect.objectContaining({ name: 'Updated Name' }),
      );
    });

    it('calls mergeFrontmatter with isNew=true and null for new rides', async () => {
      mockMergeFrontmatter.mockClear();
      const handlers = createRideHandlers();
      const update = handlers.parseRequest({
        frontmatter: { name: 'New Ride' },
        body: '',
        gpxRelativePath: '2026/03/15-new.gpx',
      });
      const mockGit = { readFile: vi.fn().mockResolvedValue(null) } as any;
      await handlers.buildFileChanges(
        update, '2026-03-15-new', { primaryFile: null }, mockGit,
      );
      expect(mockMergeFrontmatter).toHaveBeenCalledWith(
        true, // isNew
        null, // no existing content
        expect.objectContaining({ name: 'New Ride' }),
      );
    });

    it('passes media through enrichMediaFromVideoJobs and computeMediaKeyDiff', async () => {
      mockEnrichMediaFromVideoJobs.mockClear();
      mockComputeMediaKeyDiff.mockClear();
      mockLoadExistingMedia.mockClear();
      const existingMedia = [{ key: 'old-photo', type: 'photo' }];
      mockLoadExistingMedia.mockReturnValue(existingMedia);

      const handlers = createRideHandlers();
      const update = handlers.parseRequest({
        frontmatter: { name: 'Media Ride' },
        body: '',
        gpxRelativePath: '2026/03/15-media.gpx',
        media: [{ key: 'new-photo', type: 'photo' }],
      });
      const mockGit = { readFile: vi.fn().mockResolvedValue(null) } as any;
      await handlers.buildFileChanges(
        update, '2026-03-15-media', { primaryFile: null }, mockGit,
      );
      // enrichMediaFromVideoJobs receives the parsed media items and a database
      expect(mockEnrichMediaFromVideoJobs).toHaveBeenCalledWith(
        [expect.objectContaining({ key: 'new-photo' })],
        expect.anything(), // database
      );
      // computeMediaKeyDiff receives existing vs annotated media
      expect(mockComputeMediaKeyDiff).toHaveBeenCalledWith(
        existingMedia,
        expect.arrayContaining([expect.objectContaining({ key: 'new-photo' })]),
      );
    });

    it('annotates only consumed video keys with videoKeyForGit', async () => {
      mockVideoKeyForGit.mockClear();
      // enrichMediaFromVideoJobs marks 'new-video' as consumed
      mockEnrichMediaFromVideoJobs.mockResolvedValueOnce({
        enrichedMedia: [
          { key: 'existing-video', type: 'video' },
          { key: 'new-video', type: 'video' },
        ],
        consumedKeys: ['new-video'], // only this one was just transcoded
      });

      const handlers = createRideHandlers();
      const update = handlers.parseRequest({
        frontmatter: { name: 'Video Ride' },
        body: '',
        gpxRelativePath: '2026/03/15-video.gpx',
        media: [
          { key: 'existing-video', type: 'video' },
          { key: 'new-video', type: 'video' },
        ],
      });
      const mockGit = { readFile: vi.fn().mockResolvedValue(null) } as any;
      await handlers.buildFileChanges(
        update, '2026-03-15-video', { primaryFile: null }, mockGit,
      );
      // videoKeyForGit should only be called for the consumed key
      expect(mockVideoKeyForGit).toHaveBeenCalledWith('new-video');
      expect(mockVideoKeyForGit).not.toHaveBeenCalledWith('existing-video');
    });

    it('deletes media file when all media items are removed', async () => {
      mockLoadExistingMedia.mockReturnValue([{ key: 'old-photo', type: 'photo' }]);

      const handlers = createRideHandlers();
      const update = handlers.parseRequest({
        frontmatter: { name: 'Cleared Ride' },
        body: '',
        gpxRelativePath: '2026/03/15-cleared.gpx',
        media: [], // empty — all media removed
      });
      const mockGit = { readFile: vi.fn().mockResolvedValue(null) } as any;
      const result = await handlers.buildFileChanges(
        update, '2026-03-15-cleared',
        { primaryFile: { content: '---\nname: Cleared\n---\n', sha: 'sha1' } },
        mockGit,
      );
      // Media file should be deleted when existing media was present but all removed
      expect(result.deletePaths).toContain(`${CITY}/rides/2026/03/15-cleared-media.yml`);
    });

    it('tracks addedMediaKeys and removedMediaKeys from computeMediaKeyDiff', async () => {
      mockComputeMediaKeyDiff.mockReturnValueOnce({
        addedKeys: ['added-key'],
        removedKeys: ['removed-key'],
      });

      const handlers = createRideHandlers();
      const update = handlers.parseRequest({
        frontmatter: { name: 'Diff Ride' },
        body: '',
        gpxRelativePath: '2026/03/15-diff.gpx',
        media: [{ key: 'added-key', type: 'photo' }],
      });
      const mockGit = { readFile: vi.fn().mockResolvedValue(null) } as any;
      const result = await handlers.buildFileChanges(
        update, '2026-03-15-diff', { primaryFile: null }, mockGit,
      );
      expect(result.addedMediaKeys).toEqual(['added-key']);
      expect(result.removedMediaKeys).toEqual(['removed-key']);
    });
  });
});
