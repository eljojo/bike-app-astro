import { getCollection } from 'astro:content';
import { getCityConfig } from '../lib/config/city-config';
import { getInstanceFeatures } from '../lib/config/instance-features';
import { loadRouteData } from '../lib/route-data';
import { difficultyLabel } from '../lib/difficulty';
import { routeShape } from '../lib/route-insights';
import { findNearbyPlaces } from '../lib/geo/proximity';
import { isPublished } from '../lib/content/content-filters';
import { parseLocalDate, formatDateRange } from '../lib/date-utils';
import { paths } from '../lib/paths';

export function stripEmoji(text: string): string {
  return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?/gu, '').replace(/\s{2,}/g, ' ').trim();
}

/** Primary surface type from route tags */
export function surfaceType(tags: string[]): string {
  if (tags.includes('bike path')) return 'bike path';
  if (tags.includes('gravel')) return 'gravel';
  if (tags.includes('road')) return 'road';
  if (tags.includes('single track')) return 'single track';
  return 'mixed surface';
}

/** Human-friendly tags, excluding surface types already shown */
export function humanTags(tags: string[]): string[] {
  const surfaceTags = new Set(['bike path', 'gravel', 'road', 'single track']);
  return tags.filter(t => !surfaceTags.has(t));
}

/** Capitalize and de-hyphenate a category slug: "ice-cream" -> "Ice cream" */
export function formatCategory(cat: string): string {
  return cat.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

export interface RouteFacts {
  name: string;
  slug: string;
  url: string;
  distance_km: number;
  surface: string;
  shape: string | null;
  elevation_gain_m: number;
  difficulty: string;
  tags: string[];
  tagline: string;
  body: string;
  gpxDownloadPath: string | null;
  nearbyPlaceNames: string[];
}

export interface EventFacts {
  name: string;
  date: string;
  location: string;
  distances: string;
  body: string;
}

export async function loadRouteFacts(): Promise<RouteFacts[]> {
  const config = getCityConfig();
  const { routes, placeData, routeDifficultyScores, allScores } = await loadRouteData();

  const published = routes.filter(isPublished)
    .sort((a, b) => a.data.name.localeCompare(b.data.name));

  return published.map(route => {
    const gpx = route.data.variants[0]?.gpx;
    const track = gpx ? route.data.gpxTracks[gpx] : null;

    const shape = track ? routeShape(track.points, track.distance_m) : null;
    const elevationGain = track?.elevation_gain_m ?? 0;

    const scores = routeDifficultyScores.get(route.id);
    const difficulty = scores?.length
      ? difficultyLabel(scores[0], allScores)
      : 'average';

    const nearby = track
      ? findNearbyPlaces(track.points, placeData).slice(0, 5)
      : [];
    const nearbyPlaceNames = nearby.map(p =>
      `${p.name} (${formatCategory(p.category)})`
    );

    // paths.routeGpx appends .gpx, but variant gpx field already includes it
    const variantName = gpx ? gpx.replace(/\.gpx$/, '') : null;
    const gpxDownloadPath = variantName ? paths.routeGpx(route.id, variantName) : null;

    return {
      name: stripEmoji(route.data.name),
      slug: route.id,
      url: `${config.url}${paths.route(route.id)}`,
      distance_km: route.data.distance_km,
      surface: surfaceType(route.data.tags),
      shape,
      elevation_gain_m: elevationGain,
      difficulty,
      tags: humanTags(route.data.tags),
      tagline: stripEmoji(route.data.tagline || ''),
      body: route.body || '',
      gpxDownloadPath,
      nearbyPlaceNames,
    };
  });
}

export async function loadUpcomingEvents(): Promise<EventFacts[]> {
  const features = getInstanceFeatures();
  if (!features.hasEvents) return [];

  const events = await getCollection('events');
  const now = new Date();

  const upcoming = events
    .filter(e => parseLocalDate(e.data.end_date || e.data.start_date) >= now)
    .sort((a, b) =>
      parseLocalDate(a.data.start_date).getTime() - parseLocalDate(b.data.start_date).getTime()
    );

  return upcoming.map(e => ({
    name: e.data.name,
    date: formatDateRange(e.data.start_date, e.data.end_date),
    location: e.data.location || '',
    distances: e.data.distances || '',
    body: e.body || '',
  }));
}
