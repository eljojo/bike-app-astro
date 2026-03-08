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

  it('excludes authors not matched to any DB user', () => {
    const authorMap = new Map([
      ['stranger@example.com', { name: 'Stranger', count: 5 }],
    ]);
    const usersData = [
      { id: 'uid-other', username: 'someone', email: 'other@example.com' },
    ];
    const result = resolveContributors(authorMap, usersData);
    expect(result).toHaveLength(0);
  });

  it('excludes app-format emails when userId not found in DB', () => {
    const authorMap = new Map([
      ['ghost+unknown-id@whereto.bike', { name: 'ghost', count: 3 }],
    ]);
    const usersData = [
      { id: 'uid-other', username: 'someone', email: 'other@example.com' },
    ];
    const result = resolveContributors(authorMap, usersData);
    expect(result).toHaveLength(0);
  });

  it('includes regular email authors when their email matches a DB user', () => {
    const authorMap = new Map([
      ['jose@example.com', { name: 'José Real Name', count: 5 }],
    ]);
    const usersData = [
      { id: 'uid-jose', username: 'jojo', email: 'jose@example.com' },
    ];
    const result = resolveContributors(authorMap, usersData);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('jojo');
  });

  it('never uses git author name — always uses DB username', () => {
    const authorMap = new Map([
      ['jose@example.com', { name: 'José Albornoz Full Legal Name', count: 5 }],
    ]);
    const usersData = [
      { id: 'uid-jose', username: 'jojo', email: 'jose@example.com' },
    ];
    const result = resolveContributors(authorMap, usersData);
    expect(result[0].username).not.toBe('José Albornoz Full Legal Name');
    expect(result[0].username).toBe('jojo');
  });

  it('sorts by commit count descending', () => {
    const authorMap = new Map([
      ['a+uid1@whereto.bike', { name: 'a', count: 1 }],
      ['b+uid2@whereto.bike', { name: 'b', count: 10 }],
    ]);
    const usersData = [
      { id: 'uid1', username: 'userA', email: 'a@x.com' },
      { id: 'uid2', username: 'userB', email: 'b@x.com' },
    ];
    const result = resolveContributors(authorMap, usersData);
    expect(result[0].username).toBe('userB');
    expect(result[1].username).toBe('userA');
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

  it('falls back to git author names when no users data', () => {
    const authorMap = new Map([
      ['alice@example.com', { name: 'Alice', count: 5 }],
      ['bob@example.com', { name: 'Bob', count: 3 }],
    ]);
    const result = resolveContributors(authorMap, []);
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe('Alice');
    expect(result[1].username).toBe('Bob');
  });

  it('extracts username from app commit email when no DB', () => {
    const authorMap = new Map([
      ['coolbiker+abc123@whereto.bike', { name: 'coolbiker', count: 2 }],
    ]);
    const result = resolveContributors(authorMap, []);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('coolbiker');
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
