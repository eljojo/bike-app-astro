/**
 * Generate a factual narrative summary for a content item's stats.
 * Pure function, browser-safe.
 *
 * States facts and provides context. Never interprets intent
 * or projects motivation onto visitors.
 */

interface NarrativeInput {
  contentType: 'route' | 'event' | 'organizer';
  totalPageviews: number;
  totalVisitors: number;
  entryVisitors: number;
  wallTimeHours: number;
  avgVisitDuration: number; // seconds
  mapConversionRate: number; // 0-1
  mapDurationS?: number; // avg seconds spent on the map page
  stars: number;
  totalReactions: number;
  gpxDownloads?: number;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s} seconds`;
  return s > 0 ? `${m}m ${s}s` : `${m} minutes`;
}

/**
 * Convert a 0–1 rate to a human-friendly fraction string.
 * Rounds to the nearest "nice" fraction for readability.
 */
import { humanFraction } from './types';

export function buildNarrative(input: NarrativeInput): string[] {
  const sentences: string[] = [];
  const {
    contentType, totalPageviews, totalVisitors, entryVisitors,
    wallTimeHours, avgVisitDuration, mapConversionRate, stars,
  } = input;

  if (totalPageviews === 0) return ['No analytics data for this period.'];

  const viewsPerVisitor = totalVisitors > 0 ? totalPageviews / totalVisitors : 0;
  const entryRate = totalVisitors > 0 ? entryVisitors / totalVisitors : 0;
  const wallTimePerVisitor = totalVisitors > 0 ? (wallTimeHours / totalVisitors) * 60 : 0; // minutes

  // 1. Reach and return rate
  if (viewsPerVisitor >= 2) {
    sentences.push(`${viewsPerVisitor.toFixed(1)} views per visitor — more views than visitors, so some people are returning.`);
  } else if (viewsPerVisitor >= 1.3) {
    sentences.push(`${viewsPerVisitor.toFixed(1)} views per visitor — a mix of new and returning visits.`);
  } else if (totalVisitors > 20) {
    sentences.push(`${viewsPerVisitor.toFixed(1)} views per visitor — almost all visits are from new people.`);
  }

  // 2. How people arrive
  if (entryRate > 0.5 && entryVisitors > 5) {
    sentences.push(`${humanFraction(entryRate)} visitors land here directly, likely from search or shared links.`);
  } else if (entryRate > 0.2 && entryVisitors > 5) {
    sentences.push(`${humanFraction(entryRate)} visitors arrive here from outside the site.`);
  } else if (entryRate < 0.05 && totalVisitors > 20) {
    sentences.push('Most visitors navigate here from other pages on the site rather than arriving directly.');
  }

  // 3. Map engagement (routes only)
  if (contentType === 'route') {
    if (mapConversionRate > 0.1) {
      sentences.push(`${humanFraction(mapConversionRate)} visitors open the map.`);
    } else if (totalPageviews > 50 && mapConversionRate < 0.05) {
      sentences.push('Less than 5% of visitors open the map.');
    }

    if (input.mapDurationS && input.mapDurationS > 90) {
      sentences.push(`Visitors who open the map spend an average of ${formatDuration(input.mapDurationS)} on it.`);
    }
  }

  // 4. Time spent
  if (wallTimePerVisitor > 3) {
    sentences.push(`Each visitor spends an average of ${formatDuration(wallTimePerVisitor * 60)} on this page.`);
  } else if (avgVisitDuration > 0 && avgVisitDuration < 15 && totalPageviews > 30) {
    sentences.push(`Average visit duration is ${formatDuration(avgVisitDuration)}.`);
  }

  // 5. GPX downloads (routes only)
  if (contentType === 'route' && input.gpxDownloads && input.gpxDownloads > 0) {
    const downloadRate = totalVisitors > 0 ? input.gpxDownloads / totalVisitors : 0;
    if (downloadRate > 0.1) {
      sentences.push(`${humanFraction(downloadRate)} visitors download the GPX file.`);
    } else if (input.gpxDownloads >= 3) {
      sentences.push(`${input.gpxDownloads} GPX downloads.`);
    }
  }

  // 6. Stars
  if (stars > 0) {
    sentences.push(`Starred by ${stars} ${stars === 1 ? 'person' : 'people'}.`);
  }

  if (sentences.length === 0) {
    sentences.push(`${totalPageviews} views from ${totalVisitors} visitors.`);
  }

  return sentences;
}
