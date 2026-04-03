import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/content/load-admin-content.server', () => ({
  fetchSharedKeysData: vi.fn().mockResolvedValue({}),
}));
vi.mock('../src/lib/env/env.service', () => ({ env: { GIT_BRANCH: 'main', GITHUB_TOKEN: 'test', GIT_OWNER: 'o', GIT_DATA_REPO: 'r' } }));
vi.mock('../src/lib/git/git-factory', () => ({ createGitService: () => ({}) }));
vi.mock('../src/lib/get-db', () => ({ db: () => ({}) }));
const mockParkOrphanedMedia = vi.fn().mockReturnValue(null);
const mockUpdateMediaRegistryCache = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/media/media-parking.server', () => ({
  extractFrontmatterField: (_content: string, field: string) => {
    const match = _content.match(new RegExp(`${field}: (\\S+)`));
    return match?.[1];
  },
  parkOrphanedMedia: (...args: unknown[]) => mockParkOrphanedMedia(...args),
  updateMediaRegistryCache: (...args: unknown[]) => mockUpdateMediaRegistryCache(...args),
}));

import { CITY } from '../src/lib/config/config';
import { createOrganizerHandlers, type OrganizerUpdate } from '../src/views/api/organizer-save';
const organizerHandlers = createOrganizerHandlers();

function makeUpdate(overrides: Partial<OrganizerUpdate['frontmatter']> = {}): OrganizerUpdate {
  return {
    frontmatter: { name: 'Test Organizer', ...overrides },
    body: 'An organizer description.',
  };
}

describe('organizerHandlers.parseRequest', () => {
  it('validates a valid organizer update', () => {
    const update = organizerHandlers.parseRequest({
      frontmatter: { name: 'Test Org' },
      body: 'Hello',
    });
    expect(update.frontmatter.name).toBe('Test Org');
  });

  it('accepts social links', () => {
    const update = organizerHandlers.parseRequest({
      frontmatter: {
        name: 'Test Org',
        social_links: [{ platform: 'instagram', url: 'https://instagram.com/test' }],
      },
    });
    expect(update.frontmatter.social_links).toHaveLength(1);
    expect(update.frontmatter.social_links![0].platform).toBe('instagram');
  });

  it('rejects missing frontmatter', () => {
    expect(() => organizerHandlers.parseRequest({})).toThrow();
  });

  it('rejects missing name', () => {
    expect(() => organizerHandlers.parseRequest({ frontmatter: {} })).toThrow();
  });

  it('accepts photo fields', () => {
    const update = organizerHandlers.parseRequest({
      frontmatter: {
        name: 'Test',
        photo_key: 'abc123',
        photo_width: 800,
        photo_height: 600,
      },
    });
    expect(update.frontmatter.photo_key).toBe('abc123');
    expect(update.frontmatter.photo_width).toBe(800);
  });

  it('accepts hidden flag', () => {
    const update = organizerHandlers.parseRequest({
      frontmatter: { name: 'Test', hidden: true },
    });
    expect(update.frontmatter.hidden).toBe(true);
  });
});

describe('organizerHandlers.resolveContentId', () => {
  it('returns slug param for existing organizer', () => {
    const id = organizerHandlers.resolveContentId({ slug: 'test-org' }, makeUpdate());
    expect(id).toBe('test-org');
  });

  it('generates slug from name for new organizer', () => {
    const id = organizerHandlers.resolveContentId(
      { slug: 'new' },
      makeUpdate({ name: 'My Great Club' }),
    );
    expect(id).toBe('my-great-club');
  });
});

describe('organizerHandlers.validateSlug', () => {
  it('rejects empty slug', () => {
    expect(organizerHandlers.validateSlug!('')).not.toBeNull();
  });

  it('rejects single-char slug', () => {
    expect(organizerHandlers.validateSlug!('a')).not.toBeNull();
  });

  it('accepts valid slug', () => {
    expect(organizerHandlers.validateSlug!('good-club')).toBeNull();
  });
});

describe('organizerHandlers.getFilePaths', () => {
  it('returns correct path', () => {
    const paths = organizerHandlers.getFilePaths('test-org');
    expect(paths.primary).toBe(`${CITY}/organizers/test-org.md`);
  });
});

describe('organizerHandlers.checkExistence', () => {
  it('returns 409 when organizer file exists', async () => {
    const mockGit = {
      readFile: vi.fn().mockResolvedValue({ content: '---\nname: Existing\n---', sha: 'sha1' }),
    };
    const result = await organizerHandlers.checkExistence!(mockGit as any, 'existing-org');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(409);
  });

  it('returns null when organizer does not exist', async () => {
    const mockGit = { readFile: vi.fn().mockResolvedValue(null) };
    const result = await organizerHandlers.checkExistence!(mockGit as any, 'new-org');
    expect(result).toBeNull();
  });
});

describe('organizerHandlers.buildCommitMessage', () => {
  it('new organizer message includes title and trailer', () => {
    const msg = organizerHandlers.buildCommitMessage(makeUpdate(), 'test-org', true, { primaryFile: null });
    expect(msg).toBe(`Create Test Organizer\n\nChanges: ${CITY}/organizers/test-org`);
  });

  it('update organizer message includes title and trailer', () => {
    const msg = organizerHandlers.buildCommitMessage(makeUpdate(), 'test-org', false, { primaryFile: null });
    expect(msg).toBe(`Update Test Organizer\n\nChanges: ${CITY}/organizers/test-org`);
  });

  it('uses slug as fallback when name is empty', () => {
    const msg = organizerHandlers.buildCommitMessage(makeUpdate({ name: '' }), 'test-org', false, { primaryFile: null });
    expect(msg).toContain('test-org');
  });
});

describe('organizerHandlers.buildFileChanges', () => {
  const mockGit = { readFile: vi.fn().mockResolvedValue(null) };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates markdown file with frontmatter and body', async () => {
    const result = await organizerHandlers.buildFileChanges(
      makeUpdate(), 'test-org', { primaryFile: null }, mockGit as any,
    );
    expect(result.isNew).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe(`${CITY}/organizers/test-org.md`);
    const content = result.files[0].content;
    expect(content).toContain('name: Test Organizer');
    expect(content).toContain('An organizer description.');
  });

  it('strips empty optional fields', async () => {
    const update = makeUpdate({ tagline: '', tags: [] });
    const result = await organizerHandlers.buildFileChanges(
      update, 'test-org', { primaryFile: null }, mockGit as any,
    );
    const content = result.files[0].content;
    expect(content).not.toContain('tagline');
    expect(content).not.toContain('tags');
  });

  it('includes photo fields when present', async () => {
    const update = makeUpdate({
      photo_key: 'abc123',
      photo_width: 800,
      photo_height: 600,
      photo_content_type: 'image/jpeg',
    });
    const result = await organizerHandlers.buildFileChanges(
      update, 'test-org', { primaryFile: null }, mockGit as any,
    );
    const content = result.files[0].content;
    expect(content).toContain('photo_key: abc123');
    expect(content).toContain('photo_width: 800');
  });

  it('includes hidden flag', async () => {
    const update = makeUpdate({ hidden: true });
    const result = await organizerHandlers.buildFileChanges(
      update, 'test-org', { primaryFile: null }, mockGit as any,
    );
    const content = result.files[0].content;
    expect(content).toContain('hidden: true');
  });

  it('normalizes social links', async () => {
    const update = makeUpdate({
      social_links: [{ platform: 'instagram', url: 'https://instagram.com/testclub' }],
    });
    const result = await organizerHandlers.buildFileChanges(
      update, 'test-org', { primaryFile: null }, mockGit as any,
    );
    const content = result.files[0].content;
    expect(content).toContain('social_links');
    expect(content).toContain('instagram');
  });

  it('merges with existing frontmatter on update', async () => {
    const existing = {
      content: '---\nname: Old Name\ncreated_at: 2024-01-01\nacp_code: "1234"\n---\nOld body',
      sha: 'sha1',
    };
    const update = makeUpdate({ name: 'New Name' });
    const result = await organizerHandlers.buildFileChanges(
      update, 'test-org', { primaryFile: existing }, mockGit as any,
    );
    const content = result.files[0].content;
    // Updated field
    expect(content).toContain('name: New Name');
    // Preserved field the editor doesn't manage
    expect(content).toContain('created_at');
    expect(content).toContain('acp_code');
  });
});

describe('organizerHandlers.afterCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates photo registry when photo_key changes', async () => {
    const result = {
      files: [], deletePaths: [], isNew: false,
      oldPhotoKey: 'old-key', newPhotoKey: 'new-key',
      organizerSlug: 'test-org', mergedParked: undefined,
    };
    await organizerHandlers.afterCommit!(result as any, {} as any);
    expect(mockUpdateMediaRegistryCache).toHaveBeenCalledWith(
      expect.objectContaining({
        keyChanges: expect.arrayContaining([
          expect.objectContaining({ key: 'old-key', action: 'remove' }),
          expect.objectContaining({ key: 'new-key', action: 'add' }),
        ]),
      }),
    );
  });

  it('sends empty changes when photo_key unchanged', async () => {
    const result = {
      files: [], deletePaths: [], isNew: false,
      oldPhotoKey: 'same-key', newPhotoKey: 'same-key',
      organizerSlug: 'test-org', mergedParked: undefined,
    };
    await organizerHandlers.afterCommit!(result as any, {} as any);
    expect(mockUpdateMediaRegistryCache).toHaveBeenCalledWith(
      expect.objectContaining({ keyChanges: [] }),
    );
  });
});
