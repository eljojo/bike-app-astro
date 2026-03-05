import { useState, useEffect, useMemo } from 'preact/hooks';
import { showToast } from '../../lib/toast';

interface CommitUser {
  id: string;
  username: string;
  role: string;
  bannedAt: string | null;
  wasGuest?: boolean;
}

interface Commit {
  sha: string;
  message: string;
  author: { name: string; email: string };
  date: string;
  resolvedUser: CommitUser | null;
}

interface Props {
  contentPath?: string;
  city?: string;
  gitRepo?: string;
}

export default function EditHistory({ contentPath, city = 'ottawa', gitRepo }: Props) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const resourcePathRegex = useMemo(
    () => new RegExp(`${city}/(?:routes|events|guides|places|organizers)/[\\w/-]+`),
    [city],
  );

  function resolveContentPath(commit: Commit): string | null {
    if (contentPath) return contentPath;
    const match = commit.message.match(resourcePathRegex);
    if (!match) return null;
    const parts = match[0].split('/');
    const contentType = parts[1];
    if (contentType === 'routes') return `${match[0]}/index.md`;
    return `${match[0]}.md`;
  }

  async function fetchCommits(pageNum: number, append = false) {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: contentPath, perPage: 20, page: pageNum }),
      });
      if (res.ok) {
        const data = await res.json();
        setCommits(prev => append ? [...prev, ...data.commits] : data.commits);
        setHasMore(data.commits.length === 20);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchCommits(1); }, [contentPath]);

  function loadMore() {
    const next = page + 1;
    setPage(next);
    fetchCommits(next, true);
  }

  async function handleRestore(sha: string, filePath: string) {
    if (!confirm('Restore this version? This will overwrite the current version with the content from this commit.')) return;

    setActionLoading(sha);
    try {
      const res = await fetch('/api/admin/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitSha: sha, contentPath: filePath }),
      });
      if (res.ok) {
        showToast('Version restored successfully');
        fetchCommits(1);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to restore version', 'error');
      }
    } catch {
      showToast('Failed to restore version', 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleBan(userId: string) {
    if (!confirm('Ban this user? They will be unable to save edits.')) return;

    setActionLoading(userId);
    try {
      await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ban', userId }),
      });
      fetchCommits(1);
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function extractResourceLabel(commit: Commit): string | null {
    if (contentPath) return null;
    const match = commit.message.match(resourcePathRegex);
    return match ? match[0] : null;
  }

  return (
    <div class="edit-history">
      <h3>Edit History</h3>
      {commits.length === 0 && !loading && <p class="muted">No commits found.</p>}
      <div class="commit-list">
        {commits.map((c, idx) => {
          const filePath = resolveContentPath(c);
          const resourceLabel = extractResourceLabel(c);
          const isCurrentVersion = idx === 0;
          return (
            <div key={c.sha} class="commit-item">
              <div class="commit-info">
                <span class="commit-message">{c.message}</span>
                {gitRepo && (
                  <a
                    class="commit-sha"
                    href={`https://github.com/${gitRepo}/commit/${c.sha}`}
                    target="_blank"
                    rel="noopener"
                  >
                    {c.sha.slice(0, 7)}
                  </a>
                )}
                {resourceLabel && (
                  <span class="commit-resource">{resourceLabel}</span>
                )}
                <span class="commit-meta">
                  {c.resolvedUser ? (
                    <span class={c.resolvedUser.bannedAt ? 'user-banned' : ''}>
                      {c.resolvedUser.username}
                      {c.resolvedUser.wasGuest && ' (former guest)'}
                      {c.resolvedUser.bannedAt && ' [banned]'}
                    </span>
                  ) : (
                    <span>{c.author.name}</span>
                  )}
                  {' · '}
                  <time>{formatDate(c.date)}</time>
                </span>
              </div>
              <div class="commit-actions">
                {filePath && (
                  <button
                    type="button"
                    class="btn-small"
                    onClick={() => handleRestore(c.sha, filePath)}
                    disabled={isCurrentVersion || actionLoading === c.sha}
                    title={isCurrentVersion ? 'This is the current version' : 'Restore this version'}
                  >
                    {actionLoading === c.sha ? '...' : 'Restore'}
                  </button>
                )}
                {c.resolvedUser && c.resolvedUser.role !== 'admin' && !c.resolvedUser.bannedAt && (
                  <button
                    type="button"
                    class="btn-small btn-danger"
                    onClick={() => handleBan(c.resolvedUser!.id)}
                    disabled={actionLoading === c.resolvedUser.id}
                  >
                    Ban
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {loading && <p class="muted">Loading...</p>}
      {hasMore && !loading && commits.length > 0 && (
        <button type="button" class="btn-secondary" onClick={loadMore}>Load more</button>
      )}
    </div>
  );
}
