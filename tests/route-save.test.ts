import { describe, it, expect, vi } from 'vitest';

// Mock env module that route-save.ts imports
vi.mock('../src/lib/env', () => ({ env: { GITHUB_TOKEN: 'test', GIT_BRANCH: 'main' } }));

import yaml from 'js-yaml';
import type { CurrentFiles } from '../src/lib/content-save';

const { routeHandlers } = await import('../src/views/api/route-save');

function makeCurrentFiles(mediaEntries?: Record<string, unknown>[]): CurrentFiles {
  const files: CurrentFiles = {
    primaryFile: { content: '---\nname: Test\n---\nBody', sha: 'sha1' },
    auxiliaryFiles: {},
  };
  if (mediaEntries) {
    files.auxiliaryFiles!['ottawa/routes/test/media.yml'] = {
      content: yaml.dump(mediaEntries),
      sha: 'sha2',
    };
  }
  return files;
}

describe('routeHandlers.buildCommitMessage', () => {
  it('same media count as existing → no "media" in commit message', () => {
    const existing = [
      { type: 'photo', key: 'p1' },
      { type: 'photo', key: 'p2' },
    ];
    const update = {
      frontmatter: { name: 'Test' },
      body: 'body',
      media: [{ key: 'p1' }, { key: 'p2' }],
    };
    const msg = routeHandlers.buildCommitMessage(update, 'test', false, makeCurrentFiles(existing));
    expect(msg).not.toContain('media');
  });

  it('added 3 media to route with 5 existing → "3 media" in message', () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({ type: 'photo', key: `p${i}` }));
    const update = {
      frontmatter: { name: 'Test' },
      body: 'body',
      media: Array.from({ length: 8 }, (_, i) => ({ key: `p${i}` })),
    };
    const msg = routeHandlers.buildCommitMessage(update, 'test', false, makeCurrentFiles(existing));
    expect(msg).toContain('3 media');
  });

  it('first save with media (no existing media.yml) → all items count as new', () => {
    const update = {
      frontmatter: { name: 'Test' },
      body: 'body',
      media: [{ key: 'p1' }, { key: 'p2' }],
    };
    const msg = routeHandlers.buildCommitMessage(update, 'test', false, makeCurrentFiles());
    expect(msg).toContain('2 media');
  });

  it('frontmatter-only save (no media) → no "media" mention', () => {
    const update = {
      frontmatter: { name: 'Updated Name' },
      body: 'body',
      media: undefined as any,
    };
    const msg = routeHandlers.buildCommitMessage(update, 'test', false, makeCurrentFiles());
    expect(msg).not.toContain('media');
    expect(msg).toContain('Update');
  });

  it('new route → "Create" message', () => {
    const update = {
      frontmatter: { name: 'New' },
      body: 'body',
      media: [{ key: 'p1' }],
    };
    const msg = routeHandlers.buildCommitMessage(update, 'new-route', true, makeCurrentFiles());
    expect(msg).toBe('Create ottawa/routes/new-route');
  });
});

describe('routeHandlers.validateSlug', () => {
  it('rejects single character', () => {
    expect(routeHandlers.validateSlug!('a')).toMatch(/must start and end/);
  });

  it('rejects leading hyphen', () => {
    expect(routeHandlers.validateSlug!('-foo')).toMatch(/must start and end/);
  });

  it('rejects trailing hyphen', () => {
    expect(routeHandlers.validateSlug!('foo-')).toMatch(/must start and end/);
  });

  it('rejects uppercase', () => {
    expect(routeHandlers.validateSlug!('FooBar')).toMatch(/must start and end/);
  });

  it('accepts valid slug', () => {
    expect(routeHandlers.validateSlug!('pink-aylmer')).toBeNull();
  });

  it('accepts two-char slug', () => {
    expect(routeHandlers.validateSlug!('ab')).toBeNull();
  });
});

describe('routeHandlers.parseRequest', () => {
  it('accepts valid route update', () => {
    const body = {
      frontmatter: { name: 'Test', tagline: 'A route', tags: ['urban'], status: 'published' },
      body: 'Route description',
      media: [{ key: 'abc123' }],
    };
    expect(() => routeHandlers.parseRequest(body)).not.toThrow();
  });

  it('rejects unknown frontmatter keys', () => {
    const body = {
      frontmatter: { name: 'Test', unknown_field: 'bad' },
      body: 'body',
      media: [],
    };
    expect(() => routeHandlers.parseRequest(body)).toThrow();
  });

  it('rejects missing body', () => {
    const body = {
      frontmatter: { name: 'Test' },
      media: [],
    };
    expect(() => routeHandlers.parseRequest(body)).toThrow();
  });

  it('rejects non-string body', () => {
    const body = {
      frontmatter: { name: 'Test' },
      body: 123,
      media: [],
    };
    expect(() => routeHandlers.parseRequest(body)).toThrow();
  });
});

describe('routeHandlers.buildFileChanges', () => {
  it('handles existing routes without crashing when parsing current frontmatter', async () => {
    const update = {
      frontmatter: { name: 'Updated Name' },
      body: 'Updated body',
      media: undefined,
      variants: undefined,
    };

    const currentFiles: CurrentFiles = {
      primaryFile: {
        content: '---\nname: Original\nstatus: published\n---\n\nOriginal body',
        sha: 'abc123',
      },
      auxiliaryFiles: {},
    };

    const result = await routeHandlers.buildFileChanges(update, 'test', currentFiles, {} as any);
    expect(result.isNew).toBe(false);
    expect(result.files.some((f) => f.path.endsWith('/index.md'))).toBe(true);
  });
});
