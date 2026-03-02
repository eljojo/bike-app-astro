import { describe, it, expect } from 'vitest';
import { users, credentials, sessions, inviteCodes, routeEdits } from '../src/db/schema';
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

  it('invite_codes table has expected columns', () => {
    expect(getTableName(inviteCodes)).toBe('invite_codes');
    const cols = getTableColumns(inviteCodes);
    expect(Object.keys(cols)).toEqual(['id', 'code', 'createdBy', 'usedBy', 'expiresAt', 'createdAt']);
  });

  it('users role defaults to editor', () => {
    const cols = getTableColumns(users);
    expect(cols.role.hasDefault).toBe(true);
  });

  it('credentials counter defaults to 0', () => {
    const cols = getTableColumns(credentials);
    expect(cols.counter.hasDefault).toBe(true);
  });

  it('route_edits table has expected columns', () => {
    expect(getTableName(routeEdits)).toBe('route_edits');
    const cols = getTableColumns(routeEdits);
    expect(Object.keys(cols)).toEqual(['slug', 'data', 'githubSha', 'updatedAt']);
  });

  it('route_edits slug is primary key', () => {
    const cols = getTableColumns(routeEdits);
    expect(cols.slug.primary).toBe(true);
  });
});
