/* eslint-disable bike-app/no-hardcoded-city-locale -- tests multi-city path parsing with explicit city args */
import { describe, it, expect } from 'vitest';
import { buildAuthorEmail, parseAuthorEmail, buildResourcePathRegex, parseContentPath, extractChangesPath } from '../src/lib/git/commit-author';

describe('buildAuthorEmail', () => {
  it('doesnt use custom email even if provided', () => {
    expect(buildAuthorEmail({ username: 'jane', id: 'abc123', email: 'jane@example.com' }))
      .toBe('jane+abc123@whereto.bike');
  });

  it('builds username+id@whereto.bike when no custom email', () => {
    expect(buildAuthorEmail({ username: 'jane', id: 'abc123' }))
      .toBe('jane+abc123@whereto.bike');
  });

  it('handles null email', () => {
    expect(buildAuthorEmail({ username: 'jane', id: 'abc123', email: null }))
      .toBe('jane+abc123@whereto.bike');
  });
});

describe('parseAuthorEmail', () => {
  it('parses new format with userId', () => {
    expect(parseAuthorEmail('jane+abc123@whereto.bike'))
      .toEqual({ username: 'jane', userId: 'abc123' });
  });

  it('parses old format with username only', () => {
    expect(parseAuthorEmail('jane@whereto.bike'))
      .toEqual({ username: 'jane' });
  });

  it('returns null for non-whereto emails', () => {
    expect(parseAuthorEmail('jane@example.com')).toBeNull();
  });
});

describe('buildResourcePathRegex', () => {
  it('matches route paths', () => {
    const re = buildResourcePathRegex('ottawa');
    const match = 'Update for ottawa/routes/pink-aylmer'.match(re);
    expect(match?.[0]).toBe('ottawa/routes/pink-aylmer');
  });

  it('matches event paths with year subdirectory', () => {
    const re = buildResourcePathRegex('ottawa');
    const match = 'Create ottawa/events/2099/bike-fest'.match(re);
    expect(match?.[0]).toBe('ottawa/events/2099/bike-fest');
  });

  it('matches other content types', () => {
    const re = buildResourcePathRegex('ottawa');
    expect('Update ottawa/guides/getting-started'.match(re)?.[0]).toBe('ottawa/guides/getting-started');
    expect('Update ottawa/places/my-cafe'.match(re)?.[0]).toBe('ottawa/places/my-cafe');
  });

  it('uses the provided city name', () => {
    const re = buildResourcePathRegex('montreal');
    expect('Update montreal/routes/lachine'.match(re)?.[0]).toBe('montreal/routes/lachine');
    expect('Update ottawa/routes/pink-aylmer'.match(re)).toBeNull();
  });
});

describe('parseContentPath', () => {
  it('parses route paths with /index.md', () => {
    expect(parseContentPath('ottawa', 'ottawa/routes/pink-aylmer/index.md'))
      .toEqual({ contentType: 'routes', contentSlug: 'pink-aylmer' });
  });

  it('parses event paths with year subdirectory', () => {
    expect(parseContentPath('ottawa', 'ottawa/events/2099/bike-fest.md'))
      .toEqual({ contentType: 'events', contentSlug: '2099/bike-fest' });
  });

  it('parses paths without file extensions', () => {
    expect(parseContentPath('ottawa', 'ottawa/guides/getting-started'))
      .toEqual({ contentType: 'guides', contentSlug: 'getting-started' });
  });

  it('returns null for unrecognized paths', () => {
    expect(parseContentPath('ottawa', 'unrelated/path/file.txt')).toBeNull();
  });

  it('uses the provided city name', () => {
    expect(parseContentPath('montreal', 'montreal/routes/lachine/index.md'))
      .toEqual({ contentType: 'routes', contentSlug: 'lachine' });
    expect(parseContentPath('montreal', 'ottawa/routes/pink-aylmer/index.md')).toBeNull();
  });

  it('extension stripping is load-bearing (regex rejects dots)', () => {
    // Without extension stripping, the regex [\w/-]+ would not match .md or .yml
    const re = buildResourcePathRegex('ottawa');
    expect('ottawa/routes/pink-aylmer/index.md'.match(re)?.[0])
      .toBe('ottawa/routes/pink-aylmer/index');  // stops at dot
  });
});

describe('extractChangesPath', () => {
  it('extracts path from Changes trailer', () => {
    expect(extractChangesPath('Update Aylmer\n\nChanges: ottawa/routes/aylmer'))
      .toBe('ottawa/routes/aylmer');
  });

  it('extracts path when Signed-off-by follows', () => {
    expect(extractChangesPath('Update Aylmer\n\nChanges: ottawa/routes/aylmer\nSigned-off-by: jane <jane@example.com>'))
      .toBe('ottawa/routes/aylmer');
  });

  it('returns null when no Changes trailer', () => {
    expect(extractChangesPath('Update ottawa/routes/aylmer')).toBeNull();
  });

  it('extracts event paths', () => {
    expect(extractChangesPath('Create Bike Fest\n\nChanges: ottawa/events/2099/bike-fest'))
      .toBe('ottawa/events/2099/bike-fest');
  });
});
