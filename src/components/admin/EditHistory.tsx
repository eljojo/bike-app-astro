import { useState, useEffect } from 'preact/hooks';

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
}

export default function EditHistory({ contentPath }: Props) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  async function handleRevert(sha: string) {
    if (!confirm('Revert this commit? This will restore the previous version.')) return;

    setActionLoading(sha);
    try {
      // Extract contentType and contentId from contentPath
      const match = contentPath?.match(/ottawa\/(routes|events)\/(.+)/);
      if (!match) return;
      const contentType = match[1];
      const contentId = match[2].replace(/\/index\.md$/, '').replace(/\.md$/, '');

      const res = await fetch('/api/admin/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitSha: sha, contentType, contentId }),
      });
      if (res.ok) {
        fetchCommits(1);
      }
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

  return (
    <div class="edit-history">
      <h3>Edit History</h3>
      {commits.length === 0 && !loading && <p class="muted">No commits found.</p>}
      <div class="commit-list">
        {commits.map(c => (
          <div key={c.sha} class="commit-item">
            <div class="commit-info">
              <span class="commit-message">{c.message}</span>
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
              {contentPath && (
                <button
                  type="button"
                  class="btn-small"
                  onClick={() => handleRevert(c.sha)}
                  disabled={actionLoading === c.sha}
                >
                  {actionLoading === c.sha ? '...' : 'Revert'}
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
        ))}
      </div>
      {loading && <p class="muted">Loading...</p>}
      {hasMore && !loading && commits.length > 0 && (
        <button type="button" class="btn-secondary" onClick={loadMore}>Load more</button>
      )}
    </div>
  );
}
