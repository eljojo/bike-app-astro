import { describe, it, expect } from 'vitest';
import { groupCommitsByAuthor, resolveContributors } from '../scripts/build-contributors';

describe('groupCommitsByAuthor', () => {
  it('groups commits by email', () => {
    const lines = [
      'abc123', 'alice+uid1@whereto.bike', 'alice',
      'def456', 'alice+uid1@whereto.bike', 'alice',
      'ghi789', 'bob+uid2@whereto.bike', 'bob',
    ];
    const result = groupCommitsByAuthor(lines);
    expect(result.get('alice+uid1@whereto.bike')).toEqual({ name: 'alice', count: 2 });
    expect(result.get('bob+uid2@whereto.bike')).toEqual({ name: 'bob', count: 1 });
  });

  it('handles regular email addresses', () => {
    const lines = [
      'abc123', 'jose@example.com', 'José',
    ];
    const result = groupCommitsByAuthor(lines);
    expect(result.get('jose@example.com')).toEqual({ name: 'José', count: 1 });
  });

  it('handles empty input', () => {
    const result = groupCommitsByAuthor([]);
    expect(result.size).toBe(0);
  });
});

describe('resolveContributors', () => {
  it('resolves app users by userId and uses their real email for gravatar', () => {
    const authorMap = new Map([
      ['alice+uid1@whereto.bike', { name: 'alice', count: 3 }],
    ]);
    const usersData = [
      { id: 'uid1', username: 'alice', email: 'alice@real.com' },
    ];
    const result = resolveContributors(authorMap, usersData);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('alice');
    expect(result[0].gravatarHash).toBeTruthy();
    expect(result[0]).not.toHaveProperty('email');
  });

  it('uses commit email for non-app authors', () => {
    const lines = new Map([
      ['jose@example.com', { name: 'José', count: 5 }],
    ]);
    const result = resolveContributors(lines, []);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('José');
    expect(result[0].gravatarHash).toBeTruthy();
  });

  it('sorts by commit count descending', () => {
    const authorMap = new Map([
      ['a@x.com', { name: 'A', count: 1 }],
      ['b@x.com', { name: 'B', count: 10 }],
    ]);
    const result = resolveContributors(authorMap, []);
    expect(result[0].username).toBe('B');
    expect(result[1].username).toBe('A');
  });

  it('excludes banned users', () => {
    const authorMap = new Map([
      ['alice+uid1@whereto.bike', { name: 'alice', count: 3 }],
    ]);
    const usersData = [
      { id: 'uid1', username: 'alice', email: 'alice@real.com', bannedAt: '2026-01-01' },
    ];
    const result = resolveContributors(authorMap, usersData);
    expect(result).toHaveLength(0);
  });

  it('merges app user commits with their manual email commits', () => {
    const authorMap = new Map([
      ['alice+uid1@whereto.bike', { name: 'alice', count: 3 }],
      ['alice@real.com', { name: 'Alice', count: 2 }],
    ]);
    const usersData = [
      { id: 'uid1', username: 'alice', email: 'alice@real.com' },
    ];
    const result = resolveContributors(authorMap, usersData);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('alice');
  });

  it('output shape has only username and gravatarHash', () => {
    const authorMap = new Map([
      ['test+id1@whereto.bike', { name: 'test', count: 1 }],
    ]);
    const usersData = [
      { id: 'id1', username: 'testuser', email: 'test@email.com' },
    ];
    const result = resolveContributors(authorMap, usersData);
    expect(Object.keys(result[0]).sort()).toEqual(['gravatarHash', 'username']);
  });
});
