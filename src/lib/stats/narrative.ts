/**
 * Generate a human-readable narrative summary for a content item's stats.
 * Pure function, browser-safe. Connects the dots between metrics.
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
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s} seconds`;
  return s > 0 ? `${m}m ${s}s` : `${m} minutes`;
}

export function buildNarrative(input: NarrativeInput): string[] {
  const sentences: string[] = [];
  const {
    contentType, totalPageviews, totalVisitors, entryVisitors,
    wallTimeHours, avgVisitDuration, mapConversionRate, stars, totalReactions,
  } = input;

  if (totalPageviews === 0) return ['No analytics data for this period.'];

  const viewsPerVisitor = totalVisitors > 0 ? totalPageviews / totalVisitors : 0;
  const entryRate = totalVisitors > 0 ? entryVisitors / totalVisitors : 0;
  const wallTimePerVisitor = totalVisitors > 0 ? (wallTimeHours / totalVisitors) * 60 : 0; // minutes

  // 1. Stickiness story
  if (viewsPerVisitor >= 2) {
    sentences.push(`People come back — ${viewsPerVisitor.toFixed(1)} views per visitor means this is sticky content, not just a one-time visit.`);
  } else if (viewsPerVisitor >= 1.3) {
    sentences.push(`Some repeat visits (${viewsPerVisitor.toFixed(1)} views per visitor) — a mix of returning visitors and new arrivals.`);
  } else if (totalVisitors > 20) {
    sentences.push(`Almost all visits are one-time (${viewsPerVisitor.toFixed(1)} views per visitor). This content gets reach but doesn't bring people back.`);
  }

  // 2. Discovery story
  if (entryRate > 0.5 && entryVisitors > 5) {
    sentences.push(`${Math.round(entryRate * 100)}% of visitors land here directly — this is a front door to the site, likely from search or shared links.`);
  } else if (entryRate > 0.2 && entryVisitors > 5) {
    sentences.push(`${Math.round(entryRate * 100)}% of visitors arrive here from outside the site — a meaningful discovery page.`);
  } else if (entryRate < 0.05 && totalVisitors > 20) {
    sentences.push('Almost nobody lands here from search — visitors discover it by navigating within the site.');
  }

  // 3. Engagement depth story
  if (contentType === 'route') {
    if (mapConversionRate > 0.3) {
      sentences.push(`${Math.round(mapConversionRate * 100)}% of visitors open the map — strong intent to actually ride this route.`);
    } else if (mapConversionRate > 0.1 && mapConversionRate <= 0.3) {
      sentences.push(`${Math.round(mapConversionRate * 100)}% open the map. People are interested but may need more to commit — better photos or a clearer description could help.`);
    } else if (totalPageviews > 50 && mapConversionRate < 0.05) {
      sentences.push('Very few visitors open the map. They read the page but don\'t take the next step toward riding.');
    }

    // Map time — people studying the map are seriously planning
    if (input.mapDurationS && input.mapDurationS > 90) {
      sentences.push(`People spend ${formatDuration(input.mapDurationS)} on the map — they're studying the route, not just glancing. This is planning behavior.`);
    } else if (input.mapDurationS && input.mapDurationS > 45 && mapConversionRate > 0.15) {
      sentences.push(`Map visitors stay for ${formatDuration(input.mapDurationS)} — a good sign they're considering the ride.`);
    }
  }

  // 4. Attention story
  if (wallTimePerVisitor > 3) {
    sentences.push(`Visitors spend ${formatDuration(wallTimePerVisitor * 60)} each on average — deep reading, not just skimming.`);
  } else if (avgVisitDuration < 15 && totalPageviews > 30) {
    sentences.push(`Average visit is just ${formatDuration(avgVisitDuration)}. People leave quickly — the first impression may not be landing.`);
  }

  // 5. Endorsement story
  if (stars > 0 && totalReactions > 0) {
    const starRate = totalVisitors > 0 ? stars / totalVisitors : 0;
    if (starRate > 0.05) {
      sentences.push(`${stars} star${stars > 1 ? 's' : ''} from ${totalVisitors} visitors — an unusually high endorsement rate.`);
    } else if (stars >= 3) {
      sentences.push(`${stars} people have starred this — a quiet but real signal of value.`);
    }
  }

  if (sentences.length === 0) {
    sentences.push(`${totalPageviews} views from ${totalVisitors} visitors. Not enough signal yet to draw conclusions.`);
  }

  return sentences;
}
