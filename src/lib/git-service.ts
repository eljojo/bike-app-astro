/**
 * GitService — GitHub REST API integration for committing changes
 * to the data repo (eljojo/bike-routes).
 *
 * Uses native fetch with Bearer token auth. No external dependencies.
 */

const GITHUB_API = 'https://api.github.com';

export interface GitServiceConfig {
  token: string;
  owner: string;  // 'eljojo'
  repo: string;   // 'bike-routes'
}

export interface FileChange {
  path: string;
  content: string;
}

export interface CommitAuthor {
  name: string;
  email: string;
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

function formatCommitMessage(message: string): string {
  return `${message}\n\nvia whereto-bike`;
}

export class GitService {
  constructor(private config: GitServiceConfig) {}

  /**
   * Read a file from the repo. Returns content + sha, or null if not found.
   */
  async readFile(path: string): Promise<{ content: string; sha: string } | null> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/contents/${path}`
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
      `/repos/${this.config.owner}/${this.config.repo}/contents/${path}`
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data: GitHubContentItem[] = await response.json();
    return data.map(({ name, type, path }) => ({ name, type, path }));
  }

  /**
   * Commit one or more files. Uses Contents API for single files,
   * Git Trees API for multi-file atomic commits.
   */
  async writeFiles(
    files: FileChange[],
    message: string,
    author: CommitAuthor
  ): Promise<string> {
    if (files.length === 0) {
      throw new Error('No files to commit');
    }

    const formattedMessage = formatCommitMessage(message);

    if (files.length === 1) {
      return this.writeSingleFile(files[0], formattedMessage, author);
    }

    return this.writeMultipleFiles(files, formattedMessage, author);
  }

  /**
   * Trigger site rebuild via repository_dispatch.
   */
  async triggerRebuild(): Promise<void> {
    const response = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/dispatches`,
      {
        method: 'POST',
        body: JSON.stringify({ event_type: 'data-updated' }),
      }
    );

    if (!response.ok) {
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
   * 1. Get current commit SHA from refs/heads/main
   * 2. Create a blob for each file
   * 3. Create a tree with all blobs
   * 4. Create a commit pointing to the tree
   * 5. Update refs/heads/main to the new commit
   */
  private async writeMultipleFiles(
    files: FileChange[],
    message: string,
    author: CommitAuthor
  ): Promise<string> {
    // 1. Get current commit SHA
    const refResponse = await this.githubFetch(
      `/repos/${this.config.owner}/${this.config.repo}/git/ref/heads/main`
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
      `/repos/${this.config.owner}/${this.config.repo}/git/refs/heads/main`,
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
        ...options?.headers,
      },
    });
  }
}

/**
 * Decode base64-encoded file content from GitHub API.
 * GitHub returns content with newlines inserted, so strip those first.
 */
export function decodeBase64Content(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, '');
  return atob(cleaned);
}

/**
 * Encode file content to base64 for GitHub API.
 */
export function encodeBase64Content(content: string): string {
  return btoa(content);
}

/**
 * Exported for testing.
 */
export { formatCommitMessage, COMMITTER };
