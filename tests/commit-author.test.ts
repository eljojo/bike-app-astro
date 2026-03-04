import { describe, it, expect } from 'vitest';
import { buildAuthorEmail, parseAuthorEmail, buildResourcePathRegex } from '../src/lib/commit-author';

describe('buildAuthorEmail', () => {
  it('uses custom email when provided', () => {
    expect(buildAuthorEmail({ username: 'jane', id: 'abc123', email: 'jane@example.com' }))
      .toBe('jane@example.com');
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
    const match = 'Create ottawa/events/2026/bike-fest'.match(re);
    expect(match?.[0]).toBe('ottawa/events/2026/bike-fest');
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
