import { describe, it, expect } from 'vitest';
import type { SaveHandlers, CurrentFiles } from '../src/lib/content-save';

// Test the handler interface pattern without importing the full pipeline
// (which requires env, git, db connections)
describe('SaveHandlers interface', () => {
  // A minimal handler implementation for testing
  const testHandlers: SaveHandlers<{ body: string; contentHash?: string }> = {
    parseRequest: (body: unknown) => body as { body: string; contentHash?: string },
    resolveContentId: (params) => params.slug!,
    validateSlug: (slug) => slug.length < 2 ? 'Too short' : null,
    getFilePaths: (slug) => ({ primary: `test/${slug}.md` }),
    computeContentHash: (files) => `hash-${files.primaryFile?.sha || 'none'}`,
    buildFreshData: (id, files) => JSON.stringify({ id, content: files.primaryFile?.content }),
    async buildFileChanges(update, id, files) {
      return {
        files: [{ path: `test/${id}.md`, content: update.body }],
        deletePaths: [],
        isNew: !files.primaryFile,
      };
    },
    buildCommitMessage: (_update, id, isNew) => isNew ? `Create ${id}` : `Update ${id}`,
    buildCacheData: (update, id) => JSON.stringify({ id, body: update.body }),
    buildGitHubUrl: (id, branch) => `https://github.com/test/repo/blob/${branch}/test/${id}.md`,
  };

  it('parseRequest returns the body', () => {
    const result = testHandlers.parseRequest({ body: 'hello', contentHash: 'abc' });
    expect(result).toEqual({ body: 'hello', contentHash: 'abc' });
  });

  it('resolveContentId extracts slug from params', () => {
    expect(testHandlers.resolveContentId({ slug: 'my-route' }, { body: '' })).toBe('my-route');
  });

  it('validateSlug rejects short slugs', () => {
    expect(testHandlers.validateSlug!('a')).toBe('Too short');
    expect(testHandlers.validateSlug!('ab')).toBeNull();
  });

  it('getFilePaths returns the correct paths', () => {
    expect(testHandlers.getFilePaths('my-route')).toEqual({
      primary: 'test/my-route.md',
    });
  });

  it('computeContentHash uses file sha', () => {
    const files: CurrentFiles = {
      primaryFile: { content: 'test', sha: '123' },
    };
    expect(testHandlers.computeContentHash(files)).toBe('hash-123');
  });

  it('buildFileChanges detects new content', async () => {
    const result = await testHandlers.buildFileChanges(
      { body: 'new content' },
      'new-slug',
      { primaryFile: null },
      {} as any,
    );
    expect(result.isNew).toBe(true);
    expect(result.files).toHaveLength(1);
  });

  it('buildFileChanges detects existing content', async () => {
    const result = await testHandlers.buildFileChanges(
      { body: 'updated' },
      'existing-slug',
      { primaryFile: { content: 'old', sha: 'abc' } },
      {} as any,
    );
    expect(result.isNew).toBe(false);
  });

  it('buildCommitMessage varies by isNew', () => {
    const files: CurrentFiles = { primaryFile: null };
    expect(testHandlers.buildCommitMessage({ body: '' }, 'test', true, files)).toBe('Create test');
    expect(testHandlers.buildCommitMessage({ body: '' }, 'test', false, files)).toBe('Update test');
  });

  it('buildGitHubUrl constructs correct URL', () => {
    expect(testHandlers.buildGitHubUrl('my-route', 'main'))
      .toBe('https://github.com/test/repo/blob/main/test/my-route.md');
  });
});
