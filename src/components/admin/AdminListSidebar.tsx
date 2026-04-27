import type { ComponentChildren } from 'preact';
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
  trending: Array<{ slug: string; changePercent: number; diff: number }>;
  overlooked: Array<{ slug: string }>;
  stillVisiting: Array<{ slug: string; pageviews: number }>;
  popularTags: Array<{ tag: string; visitors: number }>;
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
    popularTags?: string;
  };
  /** Past event slugs — used to filter "still visiting" API data (events only).
   *  Passed as string[] because Astro serializes Preact props via JSON (Set is lost). */
  pastEventSlugs?: string[];
  /**
   * Page-supplied content rendered above the stats sections — typically a
   * <Suggestions client:idle ... /> or any future widget. The sidebar treats
   * this as opaque markup and does not introspect it.
   */
  children?: ComponentChildren;
}

export default function AdminListSidebar({
  contentType, incomplete, nameMap, editPrefix, labels, pastEventSlugs, children,
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
      {children}

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
                <span class="admin-sidebar-trending">
                  {item.changePercent <= 200
                    ? `↑ ${item.changePercent}%`
                    : `+${item.diff} views`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Events-only: still drawing visitors (filter to past events, hide if empty) */}
      {(() => {
        if (!stats?.stillVisiting || !labels.stillVisiting || !pastEventSlugs) return null;
        const filtered = stats.stillVisiting.filter(item => pastEventSlugs.includes(item.slug));
        if (filtered.length === 0) return null;
        return (
          <div class="admin-sidebar-section">
            <h4 class="admin-sidebar-heading">{labels.stillVisiting}</h4>
            <div class="admin-sidebar-list">
              {filtered.map(item => (
                <div class="admin-sidebar-item" key={item.slug}>
                  <a href={editUrl(item.slug)}>{resolveName(item.slug)}</a>
                  <span class="admin-sidebar-value">{item.pageviews.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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

      {/* Routes-only: popular tag filters */}
      {stats?.popularTags && stats.popularTags.length > 0 && labels.popularTags && (
        <div class="admin-sidebar-section">
          <h4 class="admin-sidebar-heading">{labels.popularTags}</h4>
          <div class="admin-sidebar-list">
            {stats.popularTags.map(item => (
              <div class="admin-sidebar-item" key={item.tag}>
                <span>{item.tag}</span>
                <span class="admin-sidebar-value">{item.visitors}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
