import { describe, it, expect } from 'vitest';
import { resolveBranch, buildBranchName, isDirectCommit } from '../src/lib/draft-branch';

describe('buildBranchName', () => {
  it('builds branch name for routes', () => {
    expect(buildBranchName('cyclist-7f3a', 'routes', 'rideau-canal'))
      .toBe('drafts/cyclist-7f3a/routes/rideau-canal');
  });

  it('builds branch name for events', () => {
    expect(buildBranchName('cyclist-7f3a', 'events', '2026/bike-fest'))
      .toBe('drafts/cyclist-7f3a/events/2026/bike-fest');
  });
});

describe('isDirectCommit', () => {
  it('returns true for admin in normal mode', () => {
    const user = { id: '1', email: 'a@b.com', displayName: 'Admin', role: 'admin' as const };
    expect(isDirectCommit(user, false)).toBe(true);
  });

  it('returns false for admin in editor mode', () => {
    const user = { id: '1', email: 'a@b.com', displayName: 'Admin', role: 'admin' as const };
    expect(isDirectCommit(user, true)).toBe(false);
  });

  it('returns true for editor in normal mode', () => {
    const user = { id: '1', email: 'a@b.com', displayName: 'cyclist-ab12', role: 'editor' as const };
    expect(isDirectCommit(user, false)).toBe(true);
  });

  it('returns false for editor in editor mode', () => {
    const user = { id: '1', email: 'a@b.com', displayName: 'cyclist-ab12', role: 'editor' as const };
    expect(isDirectCommit(user, true)).toBe(false);
  });

  it('returns false for guest', () => {
    const user = { id: '1', email: null, displayName: 'cyclist-ff00', role: 'guest' as const };
    expect(isDirectCommit(user, false)).toBe(false);
  });
});

describe('resolveBranch', () => {
  it('returns main branch for admin in normal mode', () => {
    const user = { id: '1', email: 'a@b.com', displayName: 'Admin', role: 'admin' as const };
    expect(resolveBranch(user, false, 'main', 'routes', 'rideau-canal')).toBe('main');
  });

  it('returns draft branch for admin in editor mode', () => {
    const user = { id: '1', email: 'a@b.com', displayName: 'Admin', role: 'admin' as const };
    expect(resolveBranch(user, true, 'main', 'routes', 'rideau-canal'))
      .toBe('drafts/Admin/routes/rideau-canal');
  });

  it('returns main branch for editor in normal mode', () => {
    const user = { id: '1', email: 'a@b.com', displayName: 'cyclist-ab12', role: 'editor' as const };
    expect(resolveBranch(user, false, 'main', 'routes', 'rideau-canal')).toBe('main');
  });

  it('returns draft branch for editor in editor mode', () => {
    const user = { id: '1', email: 'a@b.com', displayName: 'cyclist-ab12', role: 'editor' as const };
    expect(resolveBranch(user, true, 'main', 'routes', 'rideau-canal'))
      .toBe('drafts/cyclist-ab12/routes/rideau-canal');
  });

  it('returns draft branch for guest', () => {
    const user = { id: '1', email: null, displayName: 'cyclist-ff00', role: 'guest' as const };
    expect(resolveBranch(user, false, 'main', 'events', '2026/bike-fest'))
      .toBe('drafts/cyclist-ff00/events/2026/bike-fest');
  });
});
