import { useState, useEffect } from 'preact/hooks';
import { useHydrated } from '../../lib/hooks';

interface OverlookedItem {
  slug: string;
  name: string;
  hint?: string;
  editUrl: string;
}

interface SidebarStatsData {
  mostViewed: Array<{ slug: string; pageviews: number }>;
  mostStarred: Array<{ slug: string; stars: number }>;
  trending: Array<{ slug: string; changePercent: number }>;
  overlooked: Array<{ slug: string }>;
  stillVisiting: Array<{ slug: string; pageviews: number }>;
}

interface Props {
  contentType: string;
  /** Content completeness items — merged into "Overlooked" with stats-driven ones */
  incomplete: OverlookedItem[];
  /** Slug → display name map, server-computed */
  nameMap: Record<string, string>;
  /** Admin URL prefix for edit links, e.g. "/admin/routes" */
  editPrefix: string;
  labels: {
    mostViewed: string;
    mostStarred: string;
    trending: string;
    overlooked: string;
    stillVisiting?: string;
  };
  /** Past event slugs — used to filter "still visiting" API data (events only).
   *  Passed as string[] because Astro serializes Preact props via JSON (Set is lost). */
  pastEventSlugs?: string[];
}

export default function AdminListSidebar({
  contentType, incomplete, nameMap, editPrefix, labels, pastEventSlugs,
}: Props) {
  const rootRef = useHydrated<HTMLElement>();
  const [stats, setStats] = useState<SidebarStatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/stats/sidebar?type=${encodeURIComponent(contentType)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) { setStats(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contentType]);

  const resolveName = (slug: string) => nameMap[slug] || slug;
  const editUrl = (slug: string) => `${editPrefix}/${slug}`;

  // Merge stats-driven overlooked with content completeness items
  const overlookedItems = (() => {
    const seen = new Set(incomplete.map(i => i.slug));
    const statsOverlooked: OverlookedItem[] = (stats?.overlooked || [])
      .filter(s => !seen.has(s.slug))
      .map(s => ({
        slug: s.slug, name: resolveName(s.slug), editUrl: editUrl(s.slug),
      }));
    return [...incomplete, ...statsOverlooked].slice(0, 5);
  })();

  return (
    <aside class="admin-sidebar" ref={rootRef}>
      {loading && <p class="admin-sidebar-loading">Loading stats...</p>}

      {stats?.mostViewed && stats.mostViewed.length > 0 && (
        <div class="admin-sidebar-section">
          <h4 class="admin-sidebar-heading">{labels.mostViewed}</h4>
          <div class="admin-sidebar-list">
            {stats.mostViewed.map(item => (
              <div class="admin-sidebar-item" key={item.slug}>
                <a href={editUrl(item.slug)}>{resolveName(item.slug)}</a>
                <span class="admin-sidebar-value">{item.pageviews.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats?.mostStarred && stats.mostStarred.length > 0 && (
        <div class="admin-sidebar-section">
          <h4 class="admin-sidebar-heading">{labels.mostStarred}</h4>
          <div class="admin-sidebar-list">
            {stats.mostStarred.map(item => (
              <div class="admin-sidebar-item" key={item.slug}>
                <a href={editUrl(item.slug)}>{resolveName(item.slug)}</a>
                <span class="admin-sidebar-value">{item.stars} ★</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats?.trending && stats.trending.length > 0 && (
        <div class="admin-sidebar-section">
          <h4 class="admin-sidebar-heading">{labels.trending}</h4>
          <div class="admin-sidebar-list">
            {stats.trending.map(item => (
              <div class="admin-sidebar-item" key={item.slug}>
                <a href={editUrl(item.slug)}>{resolveName(item.slug)}</a>
                <span class="admin-sidebar-trending">↑ {item.changePercent}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Events-only: still drawing visitors */}
      {stats?.stillVisiting && stats.stillVisiting.length > 0 && labels.stillVisiting && pastEventSlugs && (
        <div class="admin-sidebar-section">
          <h4 class="admin-sidebar-heading">{labels.stillVisiting}</h4>
          <div class="admin-sidebar-list">
            {stats.stillVisiting
              .filter(item => pastEventSlugs.includes(item.slug))
              .map(item => (
                <div class="admin-sidebar-item" key={item.slug}>
                  <a href={editUrl(item.slug)}>{resolveName(item.slug)}</a>
                  <span class="admin-sidebar-value">{item.pageviews.toLocaleString()}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {overlookedItems.length > 0 && (
        <div class="admin-sidebar-section">
          <h4 class="admin-sidebar-heading">{labels.overlooked}</h4>
          <div class="admin-sidebar-list">
            {overlookedItems.map(item => (
              <div class="admin-sidebar-item" key={item.slug}>
                <div>
                  <a href={item.editUrl}>{item.name}</a>
                  {item.hint && <span class="admin-sidebar-hint">{item.hint}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
