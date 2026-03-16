import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must be before imports) ---

const mockJobRow = {
  key: 'abc12345',
  status: 'ready',
  contentKind: 'route',
  contentSlug: 'riverside-path',
  title: 'Morning ride',
  width: 1920,
  height: 1080,
  duration: 'PT2M15S',
  orientation: 'landscape',
  lat: null,
  lng: null,
  capturedAt: null,
};

let findJobResult: typeof mockJobRow | null = mockJobRow;
let findCacheResult: { data: string; githubSha?: string } | null = null;

const mockWriteFiles = vi.fn().mockResolvedValue('sha-new');
const mockReadFile = vi.fn();

vi.mock('../../../src/lib/get-db', () => ({
  db: () => ({
    select: () => ({
      from: (table: { key?: string }) => ({
        where: () => ({
          get: () => {
            // videoJobs table returns job row, contentEdits returns cache
            if (table && 'contentKind' in (table as Record<string, unknown>)) {
              return findJobResult;
            }
            return findCacheResult;
          },
        }),
      }),
    }),
    delete: () => ({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}));

vi.mock('../../../src/db/schema', () => ({
  videoJobs: { key: 'key', contentKind: 'contentKind' },
  contentEdits: { city: 'city', contentType: 'contentType', contentSlug: 'contentSlug' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...args: unknown[]) => args,
  inArray: (col: unknown, vals: unknown) => ({ col, vals }),
}));

vi.mock('../../../src/lib/env/env.service', () => ({
  env: {
    GIT_BRANCH: 'main',
    GITHUB_TOKEN: 'test-token',
    GIT_OWNER: 'test-owner',
    GIT_DATA_REPO: 'test-repo',
  },
}));

vi.mock('../../../src/lib/git/git-factory', () => ({
  createGitService: () => ({
    readFile: mockReadFile,
    writeFiles: mockWriteFiles,
  }),
}));

vi.mock('../../../src/lib/content/cache', () => ({
  upsertContentCache: vi.fn(),
}));

vi.mock('../../../src/lib/git/git-utils', () => ({
  computeBlobSha: (content: string) => `sha-${content.length}`,
}));

vi.mock('../../../src/lib/media/video-service', () => ({
  bareVideoKey: (k: string) => k.includes('/') ? k.split('/').pop()! : k,
}));

vi.mock('../../../src/lib/ride-paths', () => ({
  rideFilePathsFromRelPath: (relPath: string, city: string) => ({
    sidecar: `${city}/rides/${relPath.replace('.gpx', '.md')}`,
    gpx: `${city}/rides/${relPath}`,
    media: `${city}/rides/${relPath.replace('.gpx', '-media.yml')}`,
  }),
  deriveGpxRelativePath: (date: string, gpx: string) => `2026/03/${gpx}`,
}));

vi.mock('../../../src/lib/models/ride-model', () => ({
  rideDetailFromCache: (data: string) => JSON.parse(data),
}));

import { persistVideoMetadataToGit } from '../../../src/lib/media/video-completion.webhook';

describe('persistVideoMetadataToGit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findJobResult = { ...mockJobRow };
    findCacheResult = null;
    mockReadFile.mockReset();
    mockWriteFiles.mockReset().mockResolvedValue('sha-new');
  });

  it('returns not persisted when job not found', async () => {
    findJobResult = null;
    const result = await persistVideoMetadataToGit('abc12345');
    expect(result.persisted).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('returns not persisted when job is not ready', async () => {
    findJobResult = { ...mockJobRow, status: 'transcoding' };
    const result = await persistVideoMetadataToGit('abc12345');
    expect(result.persisted).toBe(false);
    expect(result.reason).toContain('not ready');
  });

  it('returns not persisted when media file not in git', async () => {
    mockReadFile.mockResolvedValue(null);
    const result = await persistVideoMetadataToGit('abc12345');
    expect(result.persisted).toBe(false);
    expect(result.reason).toContain('not found in git');
  });

  it('returns not persisted when video key not in media.yml', async () => {
    mockReadFile.mockResolvedValue({
      content: '- key: other-video\n  type: video\n',
      sha: 'sha-old',
    });
    const result = await persistVideoMetadataToGit('abc12345');
    expect(result.persisted).toBe(false);
    expect(result.reason).toContain('not found in media.yml');
  });

  it('commits enriched metadata to git when video found in media.yml', async () => {
    mockReadFile.mockResolvedValue({
      content: '- key: abc12345\n  type: video\n  title: Morning ride\n',
      sha: 'sha-old',
    });
    const result = await persistVideoMetadataToGit('abc12345');
    expect(result.persisted).toBe(true);
    expect(mockWriteFiles).toHaveBeenCalledOnce();
    const [files, message] = mockWriteFiles.mock.calls[0];
    expect(files[0].path).toContain('media.yml');
    expect(message).toContain('video metadata');
  });

  it('throws on malformed media.yml (caller catches)', async () => {
    mockReadFile.mockResolvedValue({
      content: 'not: valid: yaml: [[[',
      sha: 'sha-old',
    });
    await expect(persistVideoMetadataToGit('abc12345')).rejects.toThrow();
  });

  it('matches annotated keys using bareVideoKey', async () => {
    // media.yml has annotated key with prefix, but job key is bare
    mockReadFile.mockResolvedValue({
      content: '- key: ottawa/abc12345\n  type: video\n',
      sha: 'sha-old',
    });
    const result = await persistVideoMetadataToGit('abc12345');
    expect(result.persisted).toBe(true);
    expect(mockWriteFiles).toHaveBeenCalledOnce();
  });
});
