import { getCollection } from 'astro:content';
import { isPublished } from './content-filters';
import { elevationTags, getAllElevations } from './geo/elevation';
import { toPlaceData } from './places';
import { scoreRoute } from './difficulty';
import { routeShape } from './route-insights';
import { buildSimilarityMatrix } from './route-similarity';
import type { CollectionEntry } from 'astro:content';
import type { PlaceData } from './geo/proximity';

type Route = CollectionEntry<'routes'>;

/**
 * Build the full tag list for a route: content tags + elevation tags + shape tag.
 */
export function routeTags(route: Route, allElevations: number[]): string[] {
  const gpx = route.data.variants[0]?.gpx;
  const track = gpx ? route.data.gpxTracks[gpx] : null;
  const elevation = track?.elevation_gain_m ?? null;
  const shape = track ? routeShape(track.points, track.distance_m) : null;
  const dynamic = [...elevationTags(elevation, allElevations), ...(shape ? [shape] : [])];
  return [...new Set([...route.data.tags, ...dynamic])];
}

/**
 * Load everything the homepage needs: published routes sorted by difficulty,
 * per-route tags, and the filtered tag list for the tag filter bar.
 */
export async function loadHomepageData() {
  const routes = await getCollection('routes');
  const allElevations = getAllElevations(routes);

  const published = routes
    .filter(isPublished)
    .sort((a: Route, b: Route) => {
      const aMin = Math.min(...(scoreRoute(a).length ? scoreRoute(a) : [0]));
      const bMin = Math.min(...(scoreRoute(b).length ? scoreRoute(b) : [0]));
      return aMin - bMin;
    });

  const routeTagsMap = new Map<string, string[]>();
  for (const route of published) {
    routeTagsMap.set(route.id, routeTags(route, allElevations));
  }

  const TAGS_TO_AVOID = ['kinburn', 'easy'];
  const TAGS_TO_FORCE = ['bikepacking', 'snacks'];

  const tagCounts = new Map<string, number>();
  for (const route of published) {
    for (const tag of routeTagsMap.get(route.id)!) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const tagsByPopularity = [...tagCounts.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([tag]) => tag);

  const topTags = tagsByPopularity.slice(-14);
  const filterTags = [...new Set([...topTags, ...TAGS_TO_FORCE])]
    .filter(tag => !TAGS_TO_AVOID.includes(tag))
    .sort();

  return { published, routeTagsMap, filterTags };
}

/**
 * Load the shared data needed by route detail pages:
 * all routes, elevation stats, places, difficulty scores, and similarity data.
 */
export async function loadRouteData() {
  const routes = await getCollection('routes');
  const allElevations = getAllElevations(routes);
  const allPlaces = await getCollection('places');
  const placeData = toPlaceData(allPlaces);

  const routeDifficultyScores = new Map<string, number[]>();
  for (const r of routes.filter(isPublished)) {
    const scores = scoreRoute(r);
    if (scores.length > 0) routeDifficultyScores.set(r.id, scores);
  }

  const allScores = [...routeDifficultyScores.values()].map(s => s[0]);

  const similarityData = (routes.filter(isPublished) as Route[])
    .map((r) => {
      const gpx = r.data.variants[0]?.gpx;
      const track = gpx ? r.data.gpxTracks[gpx] : null;
      return track?.polyline ? { id: r.id, polyline: track.polyline } : null;
    })
    .filter((r): r is { id: string; polyline: string } => r != null);

  const similarityMatrix = buildSimilarityMatrix(similarityData);

  const routeNames: Record<string, string> = {};
  for (const r of routes) {
    routeNames[r.id] = r.data.name;
  }

  return { routes, allElevations, placeData, routeDifficultyScores, allScores, similarityMatrix, routeNames };
}

export type { PlaceData };
