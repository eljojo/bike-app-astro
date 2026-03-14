import { describe, it, expect } from 'vitest';
import { authorize, can, type Action } from '../src/lib/authorize';

function mockLocals(user: any) {
  return { user } as any;
}

const base = { email: null, emailInCommits: false, analyticsOptOut: false } as const;
const admin = { ...base, id: '1', username: 'admin', role: 'admin' as const, bannedAt: null };
const editor = { ...base, id: '2', username: 'editor', role: 'editor' as const, bannedAt: null };
const guest = { ...base, id: '3', username: 'guest', role: 'guest' as const, bannedAt: null };
const banned = { ...base, id: '4', username: 'bad', role: 'editor' as const, bannedAt: '2026-01-01' };

describe('authorize', () => {
  it('returns 401 Response when user is null', () => {
    const result = authorize(mockLocals(null), 'view-history');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns 403 Response when user is banned', () => {
    const result = authorize(mockLocals(banned), 'view-history');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it('returns user for actions any role can do', () => {
    expect(authorize(mockLocals(guest), 'view-history')).toEqual(guest);
    expect(authorize(mockLocals(editor), 'edit-content')).toEqual(editor);
    expect(authorize(mockLocals(admin), 'upload-media')).toEqual(admin);
  });

  it('returns 403 for admin-only actions by non-admins', () => {
    const actions: Action[] = ['revert-commit', 'manage-users', 'delete-media', 'sync-staging', 'strava-connect'];
    for (const action of actions) {
      expect(authorize(mockLocals(editor), action)).toBeInstanceOf(Response);
      expect(authorize(mockLocals(guest), action)).toBeInstanceOf(Response);
      expect(authorize(mockLocals(admin), action)).not.toBeInstanceOf(Response);
    }
  });

  it('returns 403 for set-status by non-admins', () => {
    expect(authorize(mockLocals(editor), 'set-status')).toBeInstanceOf(Response);
    expect(authorize(mockLocals(admin), 'set-status')).not.toBeInstanceOf(Response);
  });

  it('returns 403 for edit-past-event by non-admins', () => {
    expect(authorize(mockLocals(editor), 'edit-past-event')).toBeInstanceOf(Response);
    expect(authorize(mockLocals(admin), 'edit-past-event')).not.toBeInstanceOf(Response);
  });

  it('returns 403 for edit-slug by guests', () => {
    expect(authorize(mockLocals(guest), 'edit-slug')).toBeInstanceOf(Response);
    expect(authorize(mockLocals(editor), 'edit-slug')).not.toBeInstanceOf(Response);
    expect(authorize(mockLocals(admin), 'edit-slug')).not.toBeInstanceOf(Response);
  });
});

describe('can', () => {
  it('returns boolean for policy checks', () => {
    expect(can(admin, 'set-status')).toBe(true);
    expect(can(editor, 'set-status')).toBe(false);
    expect(can(guest, 'edit-slug')).toBe(false);
    expect(can(editor, 'edit-slug')).toBe(true);
  });

  it('returns false for null user', () => {
    expect(can(null, 'view-history')).toBe(false);
  });
});
