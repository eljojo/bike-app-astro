/**
 * LocalGitService — Git operations on the local bike-routes checkout.
 *
 * Replaces GitHub REST API for local development. Uses simple-git
 * for commit operations and fs for file reads.
 *
 * Write operations are serialized via a module-level mutex to prevent
 * git index.lock contention when multiple requests commit concurrently
 * (e.g. parallel E2E tests hitting the same Astro server).
 */
import fs from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';
import type { FileChange, CommitAuthor, IGitService, CommitInfo } from './git-service';
import { computeBlobSha } from './git-utils';

/**
 * Module-level mutex for git write operations. New LocalGitService instances
 * are created per-request, but they all operate on the same repo, so the
 * lock must live at module scope.
 */
let gitWriteLock: Promise<void> = Promise.resolve();

function acquireGitLock(): Promise<() => void> {
  let release: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const ready = gitWriteLock;
  gitWriteLock = next;
  return ready.then(() => release!);
}

export class LocalGitService implements IGitService {
  private repoPath: string;
  private branch: string;

  constructor(repoPath: string, branch?: string) {
    this.repoPath = repoPath;
    this.branch = branch || 'main';
  }

  private async ensureBranch(): Promise<void> {
    const git = simpleGit(this.repoPath);
    const current = (await git.branch()).current;
    if (current !== this.branch) {
      await git.checkout(this.branch);
    }
  }

  async readFile(filePath: string): Promise<{ content: string; sha: string } | null> {
    await this.ensureBranch();
    const fullPath = path.join(this.repoPath, filePath);
    if (!fs.existsSync(fullPath)) return null;

    const content = fs.readFileSync(fullPath, 'utf-8');
    const sha = computeBlobSha(content);

    return { content, sha };
  }

  async listDirectory(dirPath: string): Promise<Array<{ name: string; type: string; path: string }>> {
    await this.ensureBranch();
    const fullPath = path.join(this.repoPath, dirPath);
    if (!fs.existsSync(fullPath)) return [];

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : 'file',
      path: path.join(dirPath, entry.name),
    }));
  }

  async writeFiles(
    files: FileChange[],
    message: string,
    author: CommitAuthor,
    deletePaths?: string[],
  ): Promise<string> {
    const release = await acquireGitLock();
    try {
      return await this._writeFilesLocked(files, message, author, deletePaths);
    } finally {
      release();
    }
  }

  private async _writeFilesLocked(
    files: FileChange[],
    message: string,
    author: CommitAuthor,
    deletePaths?: string[],
  ): Promise<string> {
    await this.ensureBranch();
    if (files.length === 0 && (!deletePaths || deletePaths.length === 0)) {
      throw new Error('No files to commit');
    }

    // Delete files first
    if (deletePaths && deletePaths.length > 0) {
      const git = simpleGit(this.repoPath);
      for (const delPath of deletePaths) {
        const fullPath = path.join(this.repoPath, delPath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          await git.rm(delPath);
        }
      }
    }

    for (const file of files) {
      const fullPath = path.join(this.repoPath, file.path);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, file.content, 'utf-8');
    }

    const git = simpleGit(this.repoPath);
    if (files.length > 0) await git.add(files.map((f) => f.path));

    // Check for staged changes before committing
    const diff = await git.diff(['--cached', '--name-only']);
    if (!diff.trim()) {
      // Nothing staged — return current HEAD
      const log = await git.log({ maxCount: 1 });
      return log.latest?.hash || '';
    }

    await git.commit(message, undefined, {
      '--author': `${author.name} <${author.email}>`,
    });

    const log = await git.log({ maxCount: 1 });
    return log.latest?.hash || '';
  }

  async listCommits(opts: { path?: string; perPage?: number; page?: number } = {}): Promise<CommitInfo[]> {
    const git = simpleGit(this.repoPath);
    const logOpts: any = { maxCount: opts.perPage || 20 };
    if (opts.path) logOpts.file = opts.path;

    const log = await git.log(logOpts);
    return log.all.map(entry => ({
      sha: entry.hash,
      message: entry.message,
      author: { name: entry.author_name, email: entry.author_email },
      date: entry.date,
    }));
  }

  async getFileAtCommit(commitSha: string, filePath: string): Promise<{ content: string } | null> {
    const git = simpleGit(this.repoPath);
    try {
      const content = await git.show([`${commitSha}:${filePath}`]);
      return { content };
    } catch {
      return null;
    }
  }

  async getCommitDiff(commitSha: string, filePath?: string): Promise<string | null> {
    const git = simpleGit(this.repoPath);
    try {
      // For root commits (no parent), diff against empty tree
      let args: string[];
      try {
        await git.raw(['rev-parse', commitSha + '^']);
        args = [commitSha + '^', commitSha];
      } catch {
        const emptyTree = '4b825dc642cb6eb9a060e54bf899d15363d7aa16';
        args = [emptyTree, commitSha];
      }
      if (filePath) args.push('--', filePath);
      const result = await git.diff(args);
      return result || null;
    } catch {
      return null;
    }
  }

  async getCommitFiles(commitSha: string): Promise<string[]> {
    const git = simpleGit(this.repoPath);
    try {
      const result = await git.diff([`${commitSha}^`, commitSha, '--name-only']);
      return result.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async getRef(branch: string): Promise<string | null> {
    const git = simpleGit(this.repoPath);
    try {
      const result = await git.revparse([branch]);
      return result.trim() || null;
    } catch {
      return null;
    }
  }

  async updateRef(_branch: string, _sha: string, _force?: boolean): Promise<void> {
    // No-op for local development
  }

  async createRef(branch: string, sha: string): Promise<void> {
    const git = simpleGit(this.repoPath);
    await git.branch([branch, sha]);
  }

  async deleteRef(branch: string): Promise<void> {
    const git = simpleGit(this.repoPath);
    try {
      await git.branch(['-D', branch]);
    } catch {
      // Branch doesn't exist, that's fine
    }
  }

  async createPullRequest(_head: string, _base: string, _title: string, _body: string): Promise<number | null> {
    return null;
  }

  async closePullRequest(_prNumber: number): Promise<void> {}
}
