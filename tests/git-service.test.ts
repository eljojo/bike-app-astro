import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GitService,
  decodeBase64Content,
  encodeBase64Content,
  formatCommitMessage,
  COMMITTER,
} from '../src/lib/git-service';
import type { FileChange, CommitAuthor } from '../src/lib/git-service';

const TEST_CONFIG = {
  token: 'ghp_test_token_123',
  owner: 'eljojo',
  repo: 'bike-routes',
};

const TEST_AUTHOR: CommitAuthor = {
  name: 'Jane Cyclist',
  email: 'jane@example.com',
};

function mockFetch(responses: Array<{ status: number; body?: unknown }>): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  return vi.fn(async () => {
    const response = responses[callIndex++] || { status: 500, body: { message: 'Unexpected call' } };
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.status === 200 ? 'OK' : response.status === 201 ? 'Created' : response.status === 204 ? 'No Content' : response.status === 404 ? 'Not Found' : 'Error',
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    };
  });
}

describe('formatCommitMessage', () => {
  it('appends "via whereto-bike" suffix', () => {
    const msg = formatCommitMessage('Update route info');
    expect(msg).toBe('Update route info\n\nvia whereto-bike');
  });

  it('works with multiline messages', () => {
    const msg = formatCommitMessage('Fix typo\n\nCorrected the description');
    expect(msg).toBe('Fix typo\n\nCorrected the description\n\nvia whereto-bike');
  });
});

describe('COMMITTER', () => {
  it('is always bike-bot', () => {
    expect(COMMITTER.name).toBe('bike-bot');
    expect(COMMITTER.email).toBe('bike-bot@eljojo.bike');
  });
});

describe('decodeBase64Content', () => {
  it('decodes base64 content', () => {
    const encoded = btoa('Hello, world!');
    expect(decodeBase64Content(encoded)).toBe('Hello, world!');
  });

  it('handles base64 with embedded newlines (GitHub format)', () => {
    // GitHub API returns base64 with newlines every 60 chars
    const original = 'This is a longer string that will produce base64 with newlines when split.';
    const encoded = btoa(original);
    const withNewlines = encoded.match(/.{1,20}/g)!.join('\n');
    expect(decodeBase64Content(withNewlines)).toBe(original);
  });

  it('decodes markdown content correctly', () => {
    const markdown = '# Route Title\n\nA nice bike route.\n';
    const encoded = btoa(markdown);
    expect(decodeBase64Content(encoded)).toBe(markdown);
  });
});

describe('encodeBase64Content', () => {
  it('encodes content to base64', () => {
    const content = 'Hello, world!';
    expect(encodeBase64Content(content)).toBe(btoa(content));
  });

  it('round-trips with decodeBase64Content', () => {
    const asciiOriginal = '# Test Route\n\nA description.\n';
    expect(decodeBase64Content(encodeBase64Content(asciiOriginal))).toBe(asciiOriginal);
  });

  it('round-trips Unicode content (French accents)', () => {
    const unicode = '# Test\n\nSome content with special chars: é, ñ, à, ç, ü';
    expect(decodeBase64Content(encodeBase64Content(unicode))).toBe(unicode);
  });
});

describe('GitService', () => {
  let service: GitService;

  beforeEach(() => {
    service = new GitService(TEST_CONFIG);
  });

  describe('readFile', () => {
    it('returns decoded content and sha for existing files', async () => {
      const fileContent = '# My Route\n\nA great route.\n';
      const fetchMock = mockFetch([
        {
          status: 200,
          body: {
            content: btoa(fileContent),
            sha: 'abc123sha',
          },
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.readFile('ottawa/routes/my-route/index.md');

      expect(result).not.toBeNull();
      expect(result!.content).toBe(fileContent);
      expect(result!.sha).toBe('abc123sha');

      // Verify correct API call
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.github.com/repos/eljojo/bike-routes/contents/ottawa/routes/my-route/index.md');
      expect(options.headers['Authorization']).toBe('Bearer ghp_test_token_123');
      expect(options.headers['X-GitHub-Api-Version']).toBe('2022-11-28');

      vi.unstubAllGlobals();
    });

    it('returns null for non-existent files (404)', async () => {
      const fetchMock = mockFetch([{ status: 404 }]);
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.readFile('ottawa/routes/nonexistent/index.md');
      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it('throws on API errors (non-404)', async () => {
      const fetchMock = mockFetch([{ status: 500 }]);
      vi.stubGlobal('fetch', fetchMock);

      await expect(service.readFile('some/path')).rejects.toThrow('GitHub API error: 500');

      vi.unstubAllGlobals();
    });
  });

  describe('listDirectory', () => {
    it('returns directory entries', async () => {
      const fetchMock = mockFetch([
        {
          status: 200,
          body: [
            { name: 'index.md', type: 'file', path: 'ottawa/routes/my-route/index.md', sha: 'a1' },
            { name: 'media.yml', type: 'file', path: 'ottawa/routes/my-route/media.yml', sha: 'a2' },
            { name: 'tracks', type: 'dir', path: 'ottawa/routes/my-route/tracks', sha: 'a3' },
          ],
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);

      const entries = await service.listDirectory('ottawa/routes/my-route');

      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({ name: 'index.md', type: 'file', path: 'ottawa/routes/my-route/index.md' });
      expect(entries[2]).toEqual({ name: 'tracks', type: 'dir', path: 'ottawa/routes/my-route/tracks' });

      // Should not leak extra fields like sha
      expect(entries[0]).not.toHaveProperty('sha');

      vi.unstubAllGlobals();
    });

    it('throws on API errors', async () => {
      const fetchMock = mockFetch([{ status: 403 }]);
      vi.stubGlobal('fetch', fetchMock);

      await expect(service.listDirectory('some/path')).rejects.toThrow('GitHub API error: 403');

      vi.unstubAllGlobals();
    });
  });

  describe('writeFiles — single file', () => {
    it('creates a new file using Contents API', async () => {
      const fetchMock = mockFetch([
        // readFile check (404 = new file)
        { status: 404 },
        // PUT contents
        {
          status: 201,
          body: { commit: { sha: 'newcommitsha123' } },
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);

      const sha = await service.writeFiles(
        [{ path: 'ottawa/routes/new-route/index.md', content: '# New Route\n' }],
        'Add new route',
        TEST_AUTHOR
      );

      expect(sha).toBe('newcommitsha123');

      // Verify the PUT request
      const putCall = fetchMock.mock.calls[1];
      const putBody = JSON.parse(putCall[1].body);
      expect(putBody.message).toBe('Add new route\n\nvia whereto-bike');
      expect(putBody.author.name).toBe('Jane Cyclist');
      expect(putBody.author.email).toBe('jane@example.com');
      expect(putBody.committer.name).toBe('bike-bot');
      expect(putBody.committer.email).toBe('bike-bot@eljojo.bike');
      expect(putBody.content).toBe(btoa('# New Route\n'));
      // New file — no sha in body
      expect(putBody.sha).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('updates an existing file with its sha', async () => {
      const fetchMock = mockFetch([
        // readFile check — file exists
        {
          status: 200,
          body: { content: btoa('old content'), sha: 'existingsha456' },
        },
        // PUT contents
        {
          status: 200,
          body: { commit: { sha: 'updatedcommitsha' } },
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);

      const sha = await service.writeFiles(
        [{ path: 'ottawa/routes/existing/index.md', content: 'updated content' }],
        'Update route',
        TEST_AUTHOR
      );

      expect(sha).toBe('updatedcommitsha');

      // Verify sha is included for existing file
      const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(putBody.sha).toBe('existingsha456');

      vi.unstubAllGlobals();
    });
  });

  describe('writeFiles — multiple files', () => {
    it('uses Git Trees API for atomic multi-file commits', async () => {
      const files: FileChange[] = [
        { path: 'ottawa/routes/route-a/index.md', content: '# Route A\n' },
        { path: 'ottawa/routes/route-a/media.yml', content: 'photos: []\n' },
      ];

      const fetchMock = mockFetch([
        // 1. GET ref
        { status: 200, body: { object: { sha: 'basecommitsha' } } },
        // 2. GET commit (for base tree)
        { status: 200, body: { tree: { sha: 'basetreesha' } } },
        // 3. Create blob for file 1
        { status: 201, body: { sha: 'blob1sha' } },
        // 4. Create blob for file 2
        { status: 201, body: { sha: 'blob2sha' } },
        // 5. Create tree
        { status: 201, body: { sha: 'newtreesha' } },
        // 6. Create commit
        { status: 201, body: { sha: 'newcommitsha789' } },
        // 7. Update ref
        { status: 200, body: { object: { sha: 'newcommitsha789' } } },
      ]);
      vi.stubGlobal('fetch', fetchMock);

      const sha = await service.writeFiles(files, 'Add route with media', TEST_AUTHOR);

      expect(sha).toBe('newcommitsha789');

      // Verify ref lookup
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.github.com/repos/eljojo/bike-routes/git/ref/heads/main'
      );

      // Verify commit lookup for base tree
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://api.github.com/repos/eljojo/bike-routes/git/commits/basecommitsha'
      );

      // Verify blob creation (calls 2 and 3, may be in any order due to Promise.all)
      const blobCalls = [fetchMock.mock.calls[2], fetchMock.mock.calls[3]];
      for (const call of blobCalls) {
        expect(call[0]).toBe('https://api.github.com/repos/eljojo/bike-routes/git/blobs');
        expect(call[1].method).toBe('POST');
      }
      const blobBodies = blobCalls.map(c => JSON.parse(c[1].body));
      const blobContents = blobBodies.map(b => b.content).sort();
      expect(blobContents).toContain('# Route A\n');
      expect(blobContents).toContain('photos: []\n');
      // All blobs use utf-8 encoding
      expect(blobBodies.every((b: { encoding: string }) => b.encoding === 'utf-8')).toBe(true);

      // Verify tree creation
      const treeCall = fetchMock.mock.calls[4];
      expect(treeCall[0]).toBe('https://api.github.com/repos/eljojo/bike-routes/git/trees');
      const treeBody = JSON.parse(treeCall[1].body);
      expect(treeBody.base_tree).toBe('basetreesha');
      expect(treeBody.tree).toHaveLength(2);
      expect(treeBody.tree[0].mode).toBe('100644');
      expect(treeBody.tree[0].type).toBe('blob');

      // Verify commit creation
      const commitCall = fetchMock.mock.calls[5];
      const commitBody = JSON.parse(commitCall[1].body);
      expect(commitBody.message).toBe('Add route with media\n\nvia whereto-bike');
      expect(commitBody.tree).toBe('newtreesha');
      expect(commitBody.parents).toEqual(['basecommitsha']);
      expect(commitBody.author.name).toBe('Jane Cyclist');
      expect(commitBody.author.email).toBe('jane@example.com');
      expect(commitBody.committer.name).toBe('bike-bot');
      expect(commitBody.committer.email).toBe('bike-bot@eljojo.bike');

      // Verify ref update
      const refUpdateCall = fetchMock.mock.calls[6];
      expect(refUpdateCall[0]).toBe(
        'https://api.github.com/repos/eljojo/bike-routes/git/refs/heads/main'
      );
      expect(refUpdateCall[1].method).toBe('PATCH');
      const refBody = JSON.parse(refUpdateCall[1].body);
      expect(refBody.sha).toBe('newcommitsha789');

      vi.unstubAllGlobals();
    });

    it('throws when ref lookup fails', async () => {
      const fetchMock = mockFetch([
        { status: 404, body: { message: 'Not Found' } },
      ]);
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        service.writeFiles(
          [
            { path: 'a.md', content: 'a' },
            { path: 'b.md', content: 'b' },
          ],
          'test',
          TEST_AUTHOR
        )
      ).rejects.toThrow('Failed to get ref');

      vi.unstubAllGlobals();
    });
  });

  describe('writeFiles — edge cases', () => {
    it('throws when files array is empty', async () => {
      await expect(service.writeFiles([], 'Empty commit', TEST_AUTHOR)).rejects.toThrow(
        'No files to commit'
      );
    });
  });

  describe('triggerRebuild', () => {
    it('sends repository_dispatch event', async () => {
      const fetchMock = mockFetch([{ status: 204 }]);
      vi.stubGlobal('fetch', fetchMock);

      await service.triggerRebuild();

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.github.com/repos/eljojo/bike-app-astro/dispatches');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.event_type).toBe('data-updated');

      vi.unstubAllGlobals();
    });

    it('throws on API errors', async () => {
      const fetchMock = mockFetch([{ status: 403 }]);
      vi.stubGlobal('fetch', fetchMock);

      await expect(service.triggerRebuild()).rejects.toThrow('GitHub API error: 403');

      vi.unstubAllGlobals();
    });
  });

  describe('githubFetch headers', () => {
    it('includes auth and version headers on every request', async () => {
      const fetchMock = mockFetch([{ status: 200, body: [] }]);
      vi.stubGlobal('fetch', fetchMock);

      await service.listDirectory('test');

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer ghp_test_token_123');
      expect(options.headers['Accept']).toBe('application/vnd.github+json');
      expect(options.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
      expect(options.headers['Content-Type']).toBe('application/json');

      vi.unstubAllGlobals();
    });
  });
});
