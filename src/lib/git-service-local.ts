/**
 * LocalGitService — Git operations on the local bike-routes checkout.
 *
 * Replaces GitHub REST API for local development. Uses simple-git
 * for commit operations and fs for file reads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import simpleGit from 'simple-git';
import type { FileChange, CommitAuthor } from './git-service';

export class LocalGitService {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  async readFile(filePath: string): Promise<{ content: string; sha: string } | null> {
    const fullPath = path.join(this.repoPath, filePath);
    if (!fs.existsSync(fullPath)) return null;

    const content = fs.readFileSync(fullPath, 'utf-8');
    // Compute git blob SHA (same algorithm GitHub uses)
    const sha = createHash('sha1')
      .update(`blob ${Buffer.byteLength(content)}\0${content}`)
      .digest('hex');

    return { content, sha };
  }

  async listDirectory(dirPath: string): Promise<Array<{ name: string; type: string; path: string }>> {
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

    const formattedMessage = `${message}\n\nvia whereto-bike`;
    await git.commit(formattedMessage, undefined, {
      '--author': `${author.name} <${author.email}>`,
    });

    const log = await git.log({ maxCount: 1 });
    return log.latest?.hash || '';
  }

  async triggerRebuild(): Promise<void> {
    // No-op for local development
  }

  async getRef(_branch: string): Promise<string | null> {
    const git = simpleGit(this.repoPath);
    const log = await git.log({ maxCount: 1 });
    return log.latest?.hash || null;
  }

  async updateRef(_branch: string, _sha: string, _force?: boolean): Promise<void> {
    // No-op for local development
  }

  async createRef(_branch: string, _sha: string): Promise<void> {
    // No-op for local development
  }
}
