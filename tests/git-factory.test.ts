import { describe, it, expect, afterEach } from 'vitest';
import { createGitService } from '../src/lib/git-factory';
import { GitService } from '../src/lib/git-service';
import { LocalGitService } from '../src/lib/git-service-local';

describe('createGitService', () => {
  const originalRuntime = process.env.RUNTIME;

  afterEach(() => {
    if (originalRuntime === undefined) {
      delete process.env.RUNTIME;
    } else {
      process.env.RUNTIME = originalRuntime;
    }
  });

  it('returns LocalGitService when RUNTIME=local', () => {
    process.env.RUNTIME = 'local';
    const git = createGitService({ token: '', owner: '', repo: '', branch: 'main' });
    expect(git).toBeInstanceOf(LocalGitService);
  });

  it('returns GitService when RUNTIME is not set', () => {
    delete process.env.RUNTIME;
    const git = createGitService({ token: 'fake', owner: 'test', repo: 'test' });
    expect(git).toBeInstanceOf(GitService);
  });

  it('returns GitService when RUNTIME is production', () => {
    process.env.RUNTIME = 'production';
    const git = createGitService({ token: 'fake', owner: 'test', repo: 'test' });
    expect(git).toBeInstanceOf(GitService);
  });
});
