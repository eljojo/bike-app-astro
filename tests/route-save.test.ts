import { describe, it, expect, vi } from 'vitest';
import { CITY } from '../src/lib/config';

// Mock env module that route-save.ts imports
vi.mock('../src/lib/env/env.service', () => ({ env: { GITHUB_TOKEN: 'test', GIT_BRANCH: 'main' } }));

import yaml from 'js-yaml';
import type { CurrentFiles } from '../src/lib/content-save';

const { routeHandlers } = await import('../src/views/api/route-save');

function makeCurrentFiles(mediaEntries?: Record<string, unknown>[]): CurrentFiles {
  const files: CurrentFiles = {
    primaryFile: { content: '---\nname: Test\n---\nBody', sha: 'sha1' },
    auxiliaryFiles: {},
  };
  if (mediaEntries) {
    files.auxiliaryFiles![`${CITY}/routes/test/media.yml`] = {
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
    expect(msg).toContain('Update Test');
    expect(msg).toContain(`\n\nChanges: ${CITY}/routes/test`);
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
    expect(msg).toContain('for Test');
    expect(msg).toContain(`\n\nChanges: ${CITY}/routes/test`);
  });

  it('first save with media (no existing media.yml) → all items count as new', () => {
    const update = {
      frontmatter: { name: 'Test' },
      body: 'body',
      media: [{ key: 'p1' }, { key: 'p2' }],
    };
    const msg = routeHandlers.buildCommitMessage(update, 'test', false, makeCurrentFiles());
    expect(msg).toContain('2 media');
    expect(msg).toContain('for Test');
    expect(msg).toContain(`\n\nChanges: ${CITY}/routes/test`);
  });

  it('frontmatter-only save (no media) → no "media" mention', () => {
    const update = {
      frontmatter: { name: 'Updated Name' },
      body: 'body',
      media: undefined as any,
    };
    const msg = routeHandlers.buildCommitMessage(update, 'test', false, makeCurrentFiles());
    expect(msg).not.toContain('media');
    expect(msg).toContain('Update Updated Name');
    expect(msg).toContain(`\n\nChanges: ${CITY}/routes/test`);
  });

  it('new route → "Create" message', () => {
    const update = {
      frontmatter: { name: 'New Route' },
      body: 'body',
      media: [{ key: 'p1' }],
    };
    const msg = routeHandlers.buildCommitMessage(update, 'new-route', true, makeCurrentFiles());
    expect(msg).toBe(`Create New Route\n\nChanges: ${CITY}/routes/new-route`);
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

  it('rejects empty variants array', () => {
    const body = {
      frontmatter: { name: 'Test' },
      body: 'body',
      media: [],
      variants: [],
    };
    expect(() => routeHandlers.parseRequest(body)).toThrow();
  });

  it('accepts variants with at least one entry', () => {
    const body = {
      frontmatter: { name: 'Test' },
      body: 'body',
      media: [],
      variants: [{ name: 'Main', gpx: 'main.gpx' }],
    };
    expect(() => routeHandlers.parseRequest(body)).not.toThrow();
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
  it('preserves existing slug field in translation files', async () => {
    const update = {
      frontmatter: { name: 'Lake Leamy' },
      body: 'English body',
      translations: {
        fr: { name: 'Boucle vers le lac Leamy', tagline: 'au bord de l\'eau', body: 'Corps français' },
      },
    };

    const currentFiles: CurrentFiles = {
      primaryFile: {
        content: '---\nname: Lake Leamy\n---\n\nEnglish body',
        sha: 'abc123',
      },
      auxiliaryFiles: {
        [`${CITY}/routes/lake-leamy/index.fr.md`]: {
          content: '---\nslug: boucle-lac-leamy\nname: Boucle vers le lac Leamy\ntagline: au bord de l\'eau\n---\n\nCorps français',
          sha: 'sha-fr',
        },
      },
    };

    const git = { readFile: async () => null } as any;
    const result = await routeHandlers.buildFileChanges(update, 'lake-leamy', currentFiles, git);
    const frFile = result.files.find(f => f.path.endsWith('index.fr.md'));
    expect(frFile).toBeDefined();
    expect(frFile!.content).toContain('slug: boucle-lac-leamy');
  });

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

    const git = { readFile: async () => null } as any;
    const result = await routeHandlers.buildFileChanges(update, 'test', currentFiles, git);
    expect(result.isNew).toBe(false);
    expect(result.files.some((f) => f.path.endsWith('/index.md'))).toBe(true);
  });
});
