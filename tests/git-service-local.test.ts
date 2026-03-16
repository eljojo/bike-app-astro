import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { CITY } from '../src/lib/config/config';

const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
const GIT_BRANCH = process.env.GIT_BRANCH || 'main';

describe('LocalGitService', () => {
  it('reads a file from the data repo', async () => {
    const { LocalGitService } = await import('../src/lib/git/git.adapter-local');
    const git = new LocalGitService(CONTENT_DIR, GIT_BRANCH);

    const result = await git.readFile(`${CITY}/routes/carp/index.md`);
    expect(result).not.toBeNull();
    expect(result!.content).toContain('---');
    expect(typeof result!.sha).toBe('string');
  });

  it('returns null for non-existent file', async () => {
    const { LocalGitService } = await import('../src/lib/git/git.adapter-local');
    const git = new LocalGitService(CONTENT_DIR, GIT_BRANCH);

    const result = await git.readFile(`${CITY}/routes/nonexistent/index.md`);
    expect(result).toBeNull();
  });

  it('lists directory contents', async () => {
    const { LocalGitService } = await import('../src/lib/git/git.adapter-local');
    const git = new LocalGitService(CONTENT_DIR, GIT_BRANCH);

    const items = await git.listDirectory(`${CITY}/routes`);
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('name');
    expect(items[0]).toHaveProperty('type');
    expect(items[0]).toHaveProperty('path');
  });
});
