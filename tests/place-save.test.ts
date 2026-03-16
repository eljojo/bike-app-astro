import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock virtual module and env dependencies
vi.mock('virtual:bike-app/admin-places', () => ({ default: [] }));
vi.mock('virtual:bike-app/photo-shared-keys', () => ({ default: {} }));
vi.mock('../src/lib/env/env.service', () => ({ env: { GIT_BRANCH: 'main', GITHUB_TOKEN: 'test', GIT_OWNER: 'o', GIT_DATA_REPO: 'r' } }));
vi.mock('../src/lib/git/git-factory', () => ({ createGitService: () => ({}) }));
vi.mock('../src/lib/get-db', () => ({ db: () => ({}) }));
const mockParkOrphanedPhoto = vi.fn().mockReturnValue(null);
const mockUpdatePhotoRegistryCache = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/media/photo-parking', () => ({
  extractFrontmatterField: (_content: string, field: string) => {
    // Real-ish frontmatter extraction for tests
    const match = _content.match(new RegExp(`${field}: (\\S+)`));
    return match?.[1];
  },
  parkOrphanedPhoto: (...args: unknown[]) => mockParkOrphanedPhoto(...args),
  updatePhotoRegistryCache: (...args: unknown[]) => mockUpdatePhotoRegistryCache(...args),
}));

import { CITY } from '../src/lib/config/config';
import { placeHandlers } from '../src/views/api/place-save';

describe('placeHandlers.parseRequest', () => {
  it('validates a valid place update', () => {
    const update = placeHandlers.parseRequest({
      frontmatter: { name: 'Test Place', category: 'cafe', lat: 45.0, lng: -75.0 },
      contentHash: 'abc123',
    });
    expect(update.frontmatter.name).toBe('Test Place');
  });

  it('rejects missing frontmatter', () => {
    expect(() => placeHandlers.parseRequest({})).toThrow();
  });
});

describe('placeHandlers.resolveContentId', () => {
  it('returns the id param for existing places', () => {
    const update = { frontmatter: { name: 'Test', category: 'cafe', lat: 45, lng: -75 } };
    const id = placeHandlers.resolveContentId({ id: 'test-place' }, update);
    expect(id).toBe('test-place');
  });

  it('generates slug from name for new places', () => {
    const update = { frontmatter: { name: 'My New Place', category: 'cafe', lat: 45, lng: -75 } };
    const id = placeHandlers.resolveContentId({ id: 'new' }, update);
    expect(id).toBe('my-new-place');
  });
});

describe('placeHandlers.getFilePaths', () => {
  it('returns the correct path for a place', () => {
    const paths = placeHandlers.getFilePaths('test-place');
    expect(paths.primary).toBe(`${CITY}/places/test-place.md`);
  });
});

describe('placeHandlers.buildCommitMessage', () => {
  it('new place includes title and Changes trailer', () => {
    const update = { frontmatter: { name: 'Test Cafe', category: 'cafe', lat: 45, lng: -75 } };
    const msg = placeHandlers.buildCommitMessage(update, 'test-cafe', true, { primaryFile: null });
    expect(msg).toBe(`Create Test Cafe\n\nChanges: ${CITY}/places/test-cafe`);
  });

  it('update place includes title and Changes trailer', () => {
    const update = { frontmatter: { name: 'Test Cafe', category: 'cafe', lat: 45, lng: -75 } };
    const msg = placeHandlers.buildCommitMessage(update, 'test-cafe', false, { primaryFile: null });
    expect(msg).toBe(`Update Test Cafe\n\nChanges: ${CITY}/places/test-cafe`);
  });
});

describe('placeHandlers.validateSlug', () => {
  it('rejects empty slug', () => {
    expect(placeHandlers.validateSlug!('')).not.toBeNull();
  });

  it('rejects single-char slug', () => {
    expect(placeHandlers.validateSlug!('a')).not.toBeNull();
  });

  it('accepts valid slug', () => {
    expect(placeHandlers.validateSlug!('good-cafe')).toBeNull();
  });
});

describe('placeHandlers.checkExistence', () => {
  it('returns 409 when place file exists', async () => {
    const mockGit = {
      readFile: vi.fn().mockResolvedValue({ content: '---\nname: Existing\n---', sha: 'sha1' }),
    };
    const result = await placeHandlers.checkExistence!(mockGit as any, 'existing-place');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(409);
  });

  it('returns null when place does not exist', async () => {
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await placeHandlers.checkExistence!(mockGit as any, 'new-place');
    expect(result).toBeNull();
  });
});

describe('placeHandlers.buildFileChanges', () => {
  it('strips empty optional fields from frontmatter', async () => {
    const update = {
      frontmatter: {
        name: 'Test Cafe',
        category: 'cafe',
        lat: 45.42,
        lng: -75.69,
        address: '',    // empty → should be omitted
        website: '',    // empty → should be omitted
        phone: '',      // empty → should be omitted
      },
    };
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await placeHandlers.buildFileChanges(
      update, 'test-cafe', { primaryFile: null }, mockGit as any,
    );
    expect(result.isNew).toBe(true);
    const content = result.files[0].content;
    expect(content).toContain('name: Test Cafe');
    expect(content).toContain('category: cafe');
    expect(content).not.toContain('address');
    expect(content).not.toContain('website');
    expect(content).not.toContain('phone');
  });

  it('includes optional fields when present', async () => {
    const update = {
      frontmatter: {
        name: 'Test Cafe',
        category: 'cafe',
        lat: 45.42,
        lng: -75.69,
        address: '123 Main St',
        website: 'https://cafe.example.com',
        photo_key: 'abc123',
      },
    };
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await placeHandlers.buildFileChanges(
      update, 'test-cafe', { primaryFile: null }, mockGit as any,
    );
    const content = result.files[0].content;
    expect(content).toContain('address: 123 Main St');
    expect(content).toContain('website: https://cafe.example.com');
    expect(content).toContain('photo_key: abc123');
  });

  it('omits status when published (default)', async () => {
    const update = {
      frontmatter: {
        name: 'Test',
        category: 'cafe',
        lat: 45,
        lng: -75,
        status: 'published',
      },
    };
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await placeHandlers.buildFileChanges(
      update, 'test', { primaryFile: null }, mockGit as any,
    );
    const content = result.files[0].content;
    expect(content).not.toContain('status');
  });

  it('includes status when draft', async () => {
    const update = {
      frontmatter: {
        name: 'Test',
        category: 'cafe',
        lat: 45,
        lng: -75,
        status: 'draft',
      },
    };
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await placeHandlers.buildFileChanges(
      update, 'test', { primaryFile: null }, mockGit as any,
    );
    const content = result.files[0].content;
    expect(content).toContain('status: draft');
  });

  it('includes name_fr when present', async () => {
    const update = {
      frontmatter: {
        name: 'Test Cafe',
        name_fr: 'Café Test',
        category: 'cafe',
        lat: 45,
        lng: -75,
      },
    };
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await placeHandlers.buildFileChanges(
      update, 'test', { primaryFile: null }, mockGit as any,
    );
    const content = result.files[0].content;
    expect(content).toContain('name_fr: Café Test');
  });
});

describe('placeHandlers.afterCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates photo registry when photo_key changes', async () => {
    const result = {
      files: [],
      deletePaths: [],
      isNew: false,
      oldPhotoKey: 'old-key',
      newPhotoKey: 'new-key',
      placeSlug: 'test-cafe',
      mergedParked: undefined,
    };
    const mockDb = {};
    await placeHandlers.afterCommit!(result as any, mockDb as any);
    expect(mockUpdatePhotoRegistryCache).toHaveBeenCalledWith(
      expect.objectContaining({
        database: mockDb,
        keyChanges: expect.arrayContaining([
          expect.objectContaining({ key: 'old-key', action: 'remove', usage: expect.objectContaining({ type: 'place', slug: 'test-cafe' }) }),
          expect.objectContaining({ key: 'new-key', action: 'add', usage: expect.objectContaining({ type: 'place', slug: 'test-cafe' }) }),
        ]),
      }),
    );
  });

  it('sends empty changes when photo_key is unchanged', async () => {
    const result = {
      files: [],
      deletePaths: [],
      isNew: false,
      oldPhotoKey: 'same-key',
      newPhotoKey: 'same-key',
      placeSlug: 'test-cafe',
      mergedParked: undefined,
    };
    await placeHandlers.afterCommit!(result as any, {} as any);
    expect(mockUpdatePhotoRegistryCache).toHaveBeenCalledWith(
      expect.objectContaining({ keyChanges: [] }),
    );
  });

  it('passes mergedParked from orphan parking to registry', async () => {
    const mergedParked = [{ key: 'orphan-photo', from: { type: 'place', slug: 'old-cafe' } }];
    const result = {
      files: [],
      deletePaths: [],
      isNew: false,
      oldPhotoKey: undefined,
      newPhotoKey: undefined,
      placeSlug: 'test-cafe',
      mergedParked,
    };
    await placeHandlers.afterCommit!(result as any, {} as any);
    expect(mockUpdatePhotoRegistryCache).toHaveBeenCalledWith(
      expect.objectContaining({ mergedParked }),
    );
  });
});
