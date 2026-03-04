/**
 * GitService — GitHub REST API integration for committing changes
 * to the data repo.
 *
 * Uses native fetch with Bearer token auth. No external dependencies.
 */

const GITHUB_API = 'https://api.github.com';

export interface GitServiceConfig {
  token: string;
  owner: string;  // 'eljojo'
  repo: string;   // 'bike-routes'
  branch?: string; // defaults to 'main'
}

export interface FileChange {
  path: string;
  content: string;
}

export interface CommitAuthor {
  name: string;
  email: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: { name: string; email: string };
  date: string;
}

/** Shared interface for both GitHub and local git service implementations. */
export interface IGitService {
  readFile(path: string): Promise<{ content: string; sha: string } | null>;
  listDirectory(path: string): Promise<Array<{ name: string; type: string; path: string }>>;
  writeFiles(files: FileChange[], message: string, author: CommitAuthor, deletePaths?: string[]): Promise<string>;
  listCommits(opts?: { path?: string; perPage?: number; page?: number }): Promise<CommitInfo[]>;
  getFileAtCommit(commitSha: string, path: string): Promise<{ content: string } | null>;
  getRef(branch: string): Promise<string | null>;
  updateRef(branch: string, sha: string, force?: boolean): Promise<void>;
  createRef(branch: string, sha: string): Promise<void>;
  deleteRef(branch: string): Promise<void>;
  createPullRequest(head: string, base: string, title: string, body: string): Promise<number | null>;
  closePullRequest(prNumber: number): Promise<void>;
}

interface GitHubContentItem {
  name: string;
  type: string;
  path: string;
}

const COMMITTER = {
  name: 'bike-bot',
  email: 'bike-bot@eljojo.bike',
};

export class GitService implements IGitService {
  private branch: string;

  constructor(private config: GitServiceConfig) {
    this.branch = config.branch || 'main';
  }

  /**
   * Read a file from the repo. Returns content + sha, or null if not found.
   */
  async readFile(path: string): Promise<{ content: string; sha: string } | null> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${this.branch}`
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = decodeBase64Content(data.content);
    return { content, sha: data.sha };
  }

  /**
   * List directory contents.
   */
  async listDirectory(path: string): Promise<Array<{ name: string; type: string; path: string }>> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${this.branch}`
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data: GitHubContentItem[] = await response.json();
    return data.map(({ name, type, path }) => ({ name, type, path }));
  }

  /**
   * Commit one or more files, optionally deleting others.
   * Uses Contents API for single-file writes (no deletions),
   * Git Trees API for multi-file atomic commits (or any deletions).
   */
  async writeFiles(
    files: FileChange[],
    message: string,
    author: CommitAuthor,
    deletePaths?: string[]
  ): Promise<string> {
    if (files.length === 0 && (!deletePaths || deletePaths.length === 0)) {
      throw new Error('No files to commit');
    }

    // Deletions require the Trees API (multi-file path)
    if (files.length === 1 && (!deletePaths || deletePaths.length === 0)) {
      return this.writeSingleFile(files[0], message, author);
    }

    return this.writeMultipleFiles(files, message, author, deletePaths);
  }

  async listCommits(opts: { path?: string; perPage?: number; page?: number } = {}): Promise<CommitInfo[]> {
    const params = new URLSearchParams({ sha: this.branch });
    if (opts.path) params.set('path', opts.path);
    if (opts.perPage) params.set('per_page', String(opts.perPage));
    if (opts.page) params.set('page', String(opts.page));

    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/commits?${params}`
    );
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

    const data = await response.json();
    return data.map((c: any) => ({
      sha: c.sha,
      message: c.commit.message,
      author: {
        name: c.commit.author.name,
        email: c.commit.author.email,
      },
      date: c.commit.author.date,
    }));
  }

  async getFileAtCommit(commitSha: string, path: string): Promise<{ content: string } | null> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${commitSha}`
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

    const data = await response.json();
    return { content: decodeBase64Content(data.content) };
  }

  /**
   * Get the commit SHA that a branch ref points to.
   * Returns null if the branch doesn't exist (404).
   */
  async getRef(branch: string): Promise<string | null> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/git/ref/heads/${branch}`
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${response.statusText} — ${body}`);
    }

    const data = await response.json();
    return data.object.sha;
  }

  /**
   * Force-update a branch ref to point to a new commit SHA.
   */
  async updateRef(branch: string, sha: string, force = false): Promise<void> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/git/refs/heads/${branch}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ sha, force }),
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Create a new branch ref pointing to a commit SHA.
   */
  async createRef(branch: string, sha: string): Promise<void> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/git/refs`,
      {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Create a pull request. Returns the PR number.
   */
  async createPullRequest(head: string, base: string, title: string, body: string): Promise<number | null> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({ title, body, head, base }),
      }
    );
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${response.statusText} — ${errorData}`);
    }
    const data = await response.json();
    return data.number;
  }

  /**
   * Close a pull request.
   */
  async closePullRequest(prNumber: number): Promise<void> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
      }
    );
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Delete a branch ref. Ignores 422 (already deleted).
   */
  async deleteRef(branch: string): Promise<void> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/git/refs/heads/${branch}`,
      { method: 'DELETE' }
    );
    if (!response.ok && response.status !== 422) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Single-file commit using the Contents API (simpler path).
   */
  private async writeSingleFile(
    file: FileChange,
    message: string,
    author: CommitAuthor
  ): Promise<string> {
    // Check if file exists to get its SHA (needed for updates)
    const existing = await this.readFile(file.path);

    const body: Record<string, unknown> = {
      message,
      content: encodeBase64Content(file.content),
      committer: COMMITTER,
      author: { name: author.name, email: author.email },
      branch: this.branch,
    };

    if (existing) {
      body.sha = existing.sha;
    }

    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/contents/${file.path}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${response.statusText} — ${errorData}`);
    }

    const data = await response.json();
    return data.commit.sha;
  }

  /**
   * Multi-file atomic commit using the Git Trees API.
   *
   * Steps:
   * 1. Get current commit SHA from refs/heads/{branch}
   * 2. Create a blob for each file
   * 3. Create a tree with all blobs
   * 4. Create a commit pointing to the tree
   * 5. Update refs/heads/{branch} to the new commit
   */
  private async writeMultipleFiles(
    files: FileChange[],
    message: string,
    author: CommitAuthor,
    deletePaths?: string[]
  ): Promise<string> {
    // 1. Get current commit SHA
    const refResponse = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/git/ref/heads/${this.branch}`
    );
    if (!refResponse.ok) {
      throw new Error(`Failed to get ref: ${refResponse.status} ${refResponse.statusText}`);
    }
    const refData = await refResponse.json();
    const baseCommitSha: string = refData.object.sha;

    // 2. Get the base tree SHA from the commit
    const commitResponse = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/git/commits/${baseCommitSha}`
    );
    if (!commitResponse.ok) {
      throw new Error(`Failed to get commit: ${commitResponse.status} ${commitResponse.statusText}`);
    }
    const commitData = await commitResponse.json();
    const baseTreeSha: string = commitData.tree.sha;

    // 3. Create blobs for each file
    const treeItems = await Promise.all(
      files.map(async (file) => {
        const blobResponse = await this.githubFetch(
          `/repos/${this.config.owner}/${this.config.repo}/git/blobs`,
          {
            method: 'POST',
            body: JSON.stringify({
              content: file.content,
              encoding: 'utf-8',
            }),
          }
        );
        if (!blobResponse.ok) {
          throw new Error(`Failed to create blob: ${blobResponse.status} ${blobResponse.statusText}`);
        }
        const blobData = await blobResponse.json();
        return {
          path: file.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blobData.sha as string,
        };
      })
    );

    // 3b. Add deletion entries (sha: null removes the file from the tree)
    if (deletePaths && deletePaths.length > 0) {
      for (const delPath of deletePaths) {
        treeItems.push({
          path: delPath,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: null as unknown as string,
        });
      }
    }

    // 4. Create tree
    const treeResponse = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/git/trees`,
      {
        method: 'POST',
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems,
        }),
      }
    );
    if (!treeResponse.ok) {
      throw new Error(`Failed to create tree: ${treeResponse.status} ${treeResponse.statusText}`);
    }
    const treeData = await treeResponse.json();

    // 5. Create commit
    const newCommitResponse = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/git/commits`,
      {
        method: 'POST',
        body: JSON.stringify({
          message,
          tree: treeData.sha,
          parents: [baseCommitSha],
          author: { name: author.name, email: author.email },
          committer: COMMITTER,
        }),
      }
    );
    if (!newCommitResponse.ok) {
      throw new Error(`Failed to create commit: ${newCommitResponse.status} ${newCommitResponse.statusText}`);
    }
    const newCommitData = await newCommitResponse.json();
    const newCommitSha: string = newCommitData.sha;

    // 6. Update ref to point to new commit
    const updateRefResponse = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/git/refs/heads/${this.branch}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ sha: newCommitSha }),
      }
    );
    if (!updateRefResponse.ok) {
      throw new Error(`Failed to update ref: ${updateRefResponse.status} ${updateRefResponse.statusText}`);
    }

    return newCommitSha;
  }

  /**
   * Make an authenticated GitHub API request.
   */
  private async githubFetch(endpoint: string, options?: RequestInit): Promise<Response> {
    const url = endpoint.startsWith('https://')
      ? endpoint
      : `${GITHUB_API}${endpoint}`;

    return fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'whereto-bike',
        ...options?.headers,
      },
    });
  }
}

/**
 * Decode base64-encoded file content from GitHub API.
 * GitHub returns content with newlines inserted, so strip those first.
 * Handles UTF-8 content (e.g. French accents: é, à, ç).
 */
export function decodeBase64Content(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, '');
  const binary = atob(cleaned);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Encode file content to base64 for GitHub API.
 * Handles UTF-8 content (e.g. French accents: é, à, ç).
 */
export function encodeBase64Content(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Exported for testing.
 */
export { COMMITTER };
