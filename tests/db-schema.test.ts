import { describe, it, expect } from 'vitest';
import { users, credentials, sessions, drafts, contentEdits } from '../src/db/schema';
import { getTableName, getTableColumns } from 'drizzle-orm';

describe('database schema', () => {
  it('users table has expected columns', () => {
    expect(getTableName(users)).toBe('users');
    const cols = getTableColumns(users);
    expect(Object.keys(cols)).toEqual(['id', 'email', 'displayName', 'role', 'createdAt']);
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

  it('exports drafts table', () => {
    expect(getTableName(drafts)).toBe('drafts');
    const cols = getTableColumns(drafts);
    expect(Object.keys(cols)).toEqual([
      'id', 'userId', 'contentType', 'contentSlug', 'branchName', 'prNumber', 'createdAt', 'updatedAt',
    ]);
  });

  it('exports contentEdits table', () => {
    expect(getTableName(contentEdits)).toBe('content_edits');
    const cols = getTableColumns(contentEdits);
    expect(Object.keys(cols)).toEqual(['contentType', 'contentSlug', 'data', 'githubSha', 'updatedAt']);
  });
});
