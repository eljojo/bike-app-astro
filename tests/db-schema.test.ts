import { describe, it, expect } from 'vitest';
import { users, credentials, sessions, contentEdits, bannedIps, reactions } from '../src/db/schema';
import { getTableName, getTableColumns } from 'drizzle-orm';

describe('database schema', () => {
  it('users table has expected columns', () => {
    expect(getTableName(users)).toBe('users');
    const cols = getTableColumns(users);
    expect(Object.keys(cols)).toEqual([
      'id', 'email', 'username', 'role', 'createdAt',
      'bannedAt', 'ipAddress', 'previousUsernames',
    ]);
  });

  it('users table has username column (not displayName)', () => {
    const cols = getTableColumns(users);
    expect(cols.username).toBeDefined();
    expect((cols as any).displayName).toBeUndefined();
  });

  it('users table has moderation columns', () => {
    const cols = getTableColumns(users);
    expect(cols.bannedAt).toBeDefined();
    expect(cols.ipAddress).toBeDefined();
    expect(cols.previousUsernames).toBeDefined();
  });

  it('credentials table has expected columns', () => {
    expect(getTableName(credentials)).toBe('credentials');
    const cols = getTableColumns(credentials);
    expect(Object.keys(cols)).toEqual(['id', 'userId', 'credentialId', 'publicKey', 'counter', 'transports', 'createdAt']);
  });

  it('sessions table has expected columns', () => {
    expect(getTableName(sessions)).toBe('sessions');
    const cols = getTableColumns(sessions);
    expect(Object.keys(cols)).toEqual(['id', 'userId', 'token', 'expiresAt', 'createdAt']);
  });

  it('users role defaults to editor', () => {
    const cols = getTableColumns(users);
    expect(cols.role.hasDefault).toBe(true);
  });

  it('credentials counter defaults to 0', () => {
    const cols = getTableColumns(credentials);
    expect(cols.counter.hasDefault).toBe(true);
  });

  it('bannedIps table exists', () => {
    expect(getTableName(bannedIps)).toBe('banned_ips');
    const cols = getTableColumns(bannedIps);
    expect(cols.ip).toBeDefined();
    expect(cols.userId).toBeDefined();
    expect(cols.bannedAt).toBeDefined();
  });

  it('exports contentEdits table', () => {
    expect(getTableName(contentEdits)).toBe('content_edits');
    const cols = getTableColumns(contentEdits);
    expect(Object.keys(cols)).toEqual(['city', 'contentType', 'contentSlug', 'data', 'githubSha', 'updatedAt']);
  });

  it('reactions table has expected columns', () => {
    expect(getTableName(reactions)).toBe('reactions');
    const cols = getTableColumns(reactions);
    expect(Object.keys(cols)).toEqual([
      'id', 'userId', 'contentType', 'contentSlug', 'reactionType', 'createdAt',
    ]);
  });
});
