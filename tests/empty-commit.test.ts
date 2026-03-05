// tests/empty-commit.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CommitAuthor } from '../src/lib/git-service';

const TEST_AUTHOR: CommitAuthor = { name: 'Test', email: 'test@example.com' };

describe('GitService empty commit prevention', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writeSingleFile skips commit when content is identical', async () => {
    const { GitService } = await import('../src/lib/git-service');

    const existingContent = '# Hello\n\nWorld\n';
    const calls: Array<{ url: string; method: string }> = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      const method = opts?.method || 'GET';
      calls.push({ url, method });

      if (method === 'PUT') {
        throw new Error('PUT should not be called for identical content');
      }

      // GET for readFile (Contents API)
      if (url.includes('/contents/')) {
        return new Response(JSON.stringify({
          content: Buffer.from(existingContent).toString('base64'),
          sha: 'existing-blob-sha',
        }), { status: 200 });
      }

      // GET for getRef
      if (url.includes('/git/ref/')) {
        return new Response(JSON.stringify({
          object: { sha: 'head-commit-sha' },
        }), { status: 200 });
      }

      return new Response('{}', { status: 200 });
    }));

    const git = new GitService({ token: 'test', owner: 'o', repo: 'r', branch: 'main' });
    const sha = await git.writeFiles(
      [{ path: 'test.md', content: existingContent }],
      'Update test',
      TEST_AUTHOR,
    );

    expect(sha).toBe('head-commit-sha');
    // Should NOT have made a PUT request
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
  });

  it('writeSingleFile proceeds when content differs', async () => {
    const { GitService } = await import('../src/lib/git-service');
    const calls: Array<{ url: string; method: string }> = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      const method = opts?.method || 'GET';
      calls.push({ url, method });

      // GET for readFile
      if (url.includes('/contents/') && method === 'GET') {
        return new Response(JSON.stringify({
          content: Buffer.from('old content').toString('base64'),
          sha: 'existing-blob-sha',
        }), { status: 200 });
      }

      // PUT for writeSingleFile
      if (method === 'PUT') {
        return new Response(JSON.stringify({
          commit: { sha: 'new-commit-sha' },
        }), { status: 200 });
      }

      return new Response('{}', { status: 200 });
    }));

    const git = new GitService({ token: 'test', owner: 'o', repo: 'r', branch: 'main' });
    const sha = await git.writeFiles(
      [{ path: 'test.md', content: 'new content' }],
      'Update test',
      TEST_AUTHOR,
    );

    expect(sha).toBe('new-commit-sha');
    expect(calls.some(c => c.method === 'PUT')).toBe(true);
  });
});

describe('GitService tree comparison for multi-file', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writeMultipleFiles skips commit when tree SHA matches base', async () => {
    const { GitService } = await import('../src/lib/git-service');
    const calls: Array<{ url: string; method: string }> = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      const method = opts?.method || 'GET';
      calls.push({ url, method });

      // GET ref
      if (url.includes('/git/ref/') && method === 'GET') {
        return new Response(JSON.stringify({
          object: { sha: 'base-commit-sha' },
        }), { status: 200 });
      }

      // GET commit
      if (url.includes('/git/commits/base-commit-sha') && method === 'GET') {
        return new Response(JSON.stringify({
          tree: { sha: 'same-tree-sha' },
        }), { status: 200 });
      }

      // POST blob
      if (url.includes('/git/blobs') && method === 'POST') {
        return new Response(JSON.stringify({
          sha: 'blob-sha',
        }), { status: 201 });
      }

      // POST tree — returns same sha as base tree
      if (url.includes('/git/trees') && method === 'POST') {
        return new Response(JSON.stringify({
          sha: 'same-tree-sha', // Same as base = no changes
        }), { status: 201 });
      }

      // POST commit — should NOT be reached
      if (url.includes('/git/commits') && method === 'POST') {
        throw new Error('Should not create commit for identical tree');
      }

      return new Response('{}', { status: 200 });
    }));

    const git = new GitService({ token: 'test', owner: 'o', repo: 'r', branch: 'main' });
    // Force multi-file path by passing deletePaths
    const sha = await git.writeFiles(
      [{ path: 'a.md', content: 'same' }],
      'Update',
      TEST_AUTHOR,
      ['delete-me.md'],
    );

    expect(sha).toBe('base-commit-sha');
  });
});

describe('LocalGitService empty commit prevention', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('writeFiles returns HEAD sha when nothing is staged', async () => {
    const mockCommit = vi.fn();
    const mockGit = {
      branch: vi.fn().mockResolvedValue({ current: 'main' }),
      checkout: vi.fn(),
      add: vi.fn(),
      diff: vi.fn().mockResolvedValue(''),  // empty = nothing staged
      log: vi.fn().mockResolvedValue({ latest: { hash: 'head-sha' } }),
      commit: mockCommit,
    };

    vi.doMock('simple-git', () => ({
      default: () => mockGit,
    }));

    vi.doMock('node:fs', () => ({
      default: {
        existsSync: () => true,
        writeFileSync: () => {},
        mkdirSync: () => '',
        readdirSync: () => [],
        readFileSync: () => '',
        unlinkSync: () => {},
      },
      existsSync: () => true,
      writeFileSync: () => {},
      mkdirSync: () => '',
      readdirSync: () => [],
      readFileSync: () => '',
      unlinkSync: () => {},
    }));

    const { LocalGitService } = await import('../src/lib/git-service-local');
    const git = new LocalGitService('/tmp/fake-repo');
    const sha = await git.writeFiles(
      [{ path: 'test.md', content: 'same content' }],
      'Update test',
      TEST_AUTHOR,
    );

    expect(sha).toBe('head-sha');
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
