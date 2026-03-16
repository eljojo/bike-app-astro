import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env before importing
vi.mock('../src/lib/env/env.service', () => ({
  env: {
    ENVIRONMENT: 'staging',
    GITHUB_TOKEN: 'test',
    GIT_OWNER: 'test',
    GIT_DATA_REPO: 'test',
    GIT_BRANCH: 'main',
  },
}));

// __APP_BRANCH__ is a compile-time global — define it for tests
vi.stubGlobal('__APP_BRANCH__', 'solid-refactor');

import { appendSystemTrailers } from '../src/lib/git/commit';
import { env } from '../src/lib/env/env.service';

describe('appendSystemTrailers', () => {
  it('appends App-Branch on staging with non-main branch', () => {
    const result = appendSystemTrailers('Update route');
    expect(result).toBe('Update route\nApp-Branch: solid-refactor');
  });

  it('does not duplicate App-Branch if already present', () => {
    const result = appendSystemTrailers('Update route\nApp-Branch: solid-refactor');
    expect(result).toBe('Update route\nApp-Branch: solid-refactor');
  });

  it('preserves existing message content', () => {
    const msg = 'Update Aylmer\n\nChanges: ottawa/routes/aylmer\nCo-Authored-By: jose <jose@example.com>';
    const result = appendSystemTrailers(msg);
    expect(result).toContain(msg);
    expect(result).toContain('App-Branch: solid-refactor');
  });
});

describe('appendSystemTrailers — non-staging', () => {
  beforeEach(() => {
    env.ENVIRONMENT = 'production';
  });
  afterEach(() => {
    env.ENVIRONMENT = 'staging';
  });

  it('does not append App-Branch in production', () => {
    const result = appendSystemTrailers('Update route');
    expect(result).toBe('Update route');
  });
});

describe('appendSystemTrailers — main branch', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_BRANCH__', 'main');
  });
  afterEach(() => {
    vi.stubGlobal('__APP_BRANCH__', 'solid-refactor');
  });

  it('does not append App-Branch when branch is main', () => {
    const result = appendSystemTrailers('Update route');
    expect(result).toBe('Update route');
  });
});
