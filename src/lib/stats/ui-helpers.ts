import type { TimeRange } from './types';

export const REACTION_LABELS: Record<string, string> = {
  star: 'Starred',
  ridden: 'Ridden it',
  'thumbs-up': 'Thumbs up',
  attended: 'Attended',
};

export const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '3mo', label: 'Last 3 months' },
  { value: '1yr', label: 'Last year' },
  { value: 'all', label: 'All time' },
];

export function formatNumber(n: number | string): string {
  if (typeof n === 'string') return n;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function liveUrl(contentType: string, contentSlug: string): string {
  switch (contentType) {
    case 'route': return `/routes/${contentSlug}`;
    case 'event': return `/events/${contentSlug}`;
    case 'organizer': return `/communities/${contentSlug}`;
    case 'bike-path': return `/bike-paths/${contentSlug}`;
    default: return '#';
  }
}

export function adminUrl(contentType: string, contentSlug: string): string {
  switch (contentType) {
    case 'route': return `/admin/routes/${contentSlug}`;
    case 'event': return `/admin/events/${contentSlug}`;
    case 'organizer': return `/admin/communities/${contentSlug}`;
    case 'bike-path': return `/admin/bike-paths/${contentSlug}`;
    default: return '#';
  }
}
