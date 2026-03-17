import { useState, useEffect, useMemo } from 'preact/hooks';
import { Fragment } from 'preact';
import { showToast } from '../../lib/toast';
import { extractChangesPath } from '../../lib/git/commit-author';
import { parseCommitMessage, formatDetail } from '../../lib/history-format';
import { buildImageUrl } from '../../lib/media/image-service';

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
  userRole?: string;
  cdnUrl?: string;
  coverKeys?: Record<string, string>;
  posterKeys?: Record<string, string>;
}

function groupByDay(commits: Commit[]): Map<string, Commit[]> {
  const groups = new Map<string, Commit[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const c of commits) {
    const d = new Date(c.date).toDateString();
    let label: string;
    if (d === today) label = 'Today';
    else if (d === yesterday) label = 'Yesterday';
    else label = new Date(c.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

    const existing = groups.get(label);
    if (existing) existing.push(c);
    else groups.set(label, [c]);
  }
  return groups;
}

export default function EditHistory({ contentPath, city, gitRepo, userRole, cdnUrl, coverKeys, posterKeys }: Props) {
  const isAdmin = userRole === 'admin';
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<Record<string, string>>({});
  const [diffLoading, setDiffLoading] = useState<string | null>(null);

  const resourcePathRegex = useMemo(
    () => new RegExp(`${city}/(?:routes|events|guides|places|organizers)/[\\w/-]+`),
    [city],
  );

  function resolveContentPath(commit: Commit): string | null {
    if (contentPath) {
      if (!contentPath.endsWith('.md')) return `${contentPath}/index.md`;
      return contentPath;
    }
    // Try Changes: trailer first (new format), fall back to regex on message (old format)
    const changesPath = extractChangesPath(commit.message);
    const resourcePath = changesPath || commit.message.match(resourcePathRegex)?.[0];
    if (!resourcePath) return null;
    const parts = resourcePath.split('/');
    const contentType = parts[1];
    if (contentType === 'routes') return `${resourcePath}/index.md`;
    return `${resourcePath}.md`;
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

  async function handleShowDiff(sha: string) {
    if (expandedDiff === sha) {
      setExpandedDiff(null);
      return;
    }

    if (diffContent[sha]) {
      setExpandedDiff(sha);
      return;
    }

    setDiffLoading(sha);
    try {
      const res = await fetch('/api/admin/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitSha: sha, contentPath }),
      });
      if (res.ok) {
        const data = await res.json();
        setDiffContent(prev => ({ ...prev, [sha]: data.diff }));
        setExpandedDiff(sha);
      }
    } finally {
      setDiffLoading(null);
    }
  }

  const dayGroups = useMemo(() => groupByDay(commits), [commits]);

  return (
    <div class="edit-history">
      {commits.length === 0 && !loading && <p class="muted">No commits found.</p>}

      {[...dayGroups.entries()].map(([day, dayCommits]) => (
        <Fragment key={day}>
          <h4 class="history-day-label">{day}</h4>
          <div class="commit-list">
            {dayCommits.map((c) => {
              const filePath = resolveContentPath(c);
              const parsed = city ? parseCommitMessage(c.message, city) : null;
              const isCurrentVersion = commits.indexOf(c) === 0;
              const thumb = parsed?.contentType === 'routes' && parsed.contentSlug && coverKeys?.[parsed.contentSlug]
                ? buildImageUrl(cdnUrl || '', coverKeys[parsed.contentSlug], { width: 48, height: 48, fit: 'cover' })
                : parsed?.contentType === 'events' && parsed.contentSlug && posterKeys?.[parsed.contentSlug]
                  ? buildImageUrl(cdnUrl || '', posterKeys[parsed.contentSlug], { width: 36, height: 48, fit: 'cover' })
                  : null;

              const username = c.resolvedUser?.username ?? c.author.name;
              const timeStr = new Date(c.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
              const detail = parsed ? formatDetail(parsed.detail) : '';
              const headline = parsed?.headline ?? c.message.split('\n')[0];
              const action = parsed?.action ?? 'updated';
              const editorUrl = parsed?.editorUrl ?? null;

              return (
                <Fragment key={c.sha}>
                  <div class="commit-item">
                    {thumb && <img src={thumb} alt="" class="commit-thumb" loading="lazy" />}
                    <div class="commit-info">
                      <span class="commit-headline">
                        <strong>{username}</strong>
                        {' '}{action}{' '}
                        {editorUrl
                          ? <a href={editorUrl}>{headline}</a>
                          : headline
                        }
                        {detail && ` \u2014 ${detail}`}
                      </span>
                      <span class="commit-meta-line">
                        {parsed?.contentType && (
                          <span class="commit-type-badge">{parsed.contentType.replace(/s$/, '')}</span>
                        )}
                        <time>{timeStr}</time>
                        {gitRepo && (
                          <a
                            class="commit-sha-link"
                            href={`https://github.com/${gitRepo}/commit/${c.sha}`}
                            target="_blank"
                            rel="noopener"
                          >
                            {c.sha.slice(0, 7)}
                          </a>
                        )}
                        {c.resolvedUser?.bannedAt && <span class="user-banned">[banned]</span>}
                      </span>
                    </div>
                    <div class="commit-actions">
                      <button
                        type="button"
                        class="btn-small btn-secondary"
                        onClick={() => handleShowDiff(c.sha)}
                        disabled={diffLoading === c.sha}
                      >
                        {diffLoading === c.sha ? '...' : expandedDiff === c.sha ? 'Hide diff' : 'Diff'}
                      </button>
                      {isAdmin && filePath && (
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
                      {isAdmin && c.resolvedUser && c.resolvedUser.role !== 'admin' && !c.resolvedUser.bannedAt && (
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
                  {expandedDiff === c.sha && diffContent[c.sha] && (
                    <div class="commit-diff-styled">
                      {diffContent[c.sha].split('\n').map((line, i) => (
                        <div key={i} class={
                          line.startsWith('+') && !line.startsWith('+++') ? 'diff-add'
                          : line.startsWith('-') && !line.startsWith('---') ? 'diff-remove'
                          : line.startsWith('@@') ? 'diff-hunk'
                          : 'diff-context'
                        }>{line}</div>
                      ))}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </Fragment>
      ))}

      {loading && <p class="muted">Loading...</p>}
      {hasMore && !loading && commits.length > 0 && (
        <button type="button" class="btn-secondary" onClick={loadMore}>Load more</button>
      )}
    </div>
  );
}
