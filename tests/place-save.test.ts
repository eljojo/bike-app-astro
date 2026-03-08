import { describe, it, expect, vi } from 'vitest';

// Mock virtual module and env dependencies
vi.mock('virtual:bike-app/admin-places', () => ({ default: [] }));
vi.mock('../src/lib/env', () => ({ env: { GIT_BRANCH: 'main', GITHUB_TOKEN: 'test' } }));
vi.mock('../src/lib/git-factory', () => ({ createGitService: () => ({}) }));
vi.mock('../src/lib/get-db', () => ({ db: () => ({}) }));

import { CITY } from '../src/lib/config';
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
