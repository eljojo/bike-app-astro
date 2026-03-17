import type { APIRoute, GetStaticPaths } from 'astro';
import type { CollectionEntry } from 'astro:content';
import { loadRouteData } from '../../lib/route-data';
import type { PlaceData } from '../../lib/geo/proximity';
import { isPublished } from '../../lib/content/content-filters';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { getCityConfig } from '../../lib/config/city-config';
import { elevationConclusion } from '../../lib/geo/elevation';
import { routeShape } from '../../lib/route-insights';
import { difficultyLabel } from '../../lib/difficulty';
import { findNearbyPlaces } from '../../lib/geo/proximity';
import { findSimilarRoutes } from '../../lib/route-similarity';
import { variantKey, variantSlug } from '../../lib/gpx/filenames';
import { paths, routeSlug } from '../../lib/paths';
import { supportedLocales, defaultLocale } from '../../lib/i18n/locale-utils';
import { loadBuildPlan, filterByBuildPlan } from '../../lib/content/build-plan.server';

type Route = CollectionEntry<'routes'>;

interface RouteJsonProps {
  route: Route;
  allElevations: number[];
  placeData: PlaceData[];
  routeDifficultyScores: Map<string, number[]>;
  allScores: number[];
  similarityMatrix: Record<string, Record<string, number>>;
  routeNames: Record<string, string>;
}

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  if (!getInstanceFeatures().hasRoutes) return [];

  const { routes, allElevations, placeData, routeDifficultyScores, allScores, similarityMatrix, routeNames } = await loadRouteData();
  const filtered = filterByBuildPlan(routes.filter(isPublished), loadBuildPlan(), 'route');

  return filtered.map(route => ({
    params: { slug: route.id },
    props: { route, allElevations, placeData, routeDifficultyScores, allScores, similarityMatrix, routeNames },
  }));
};

export const GET: APIRoute = async ({ props, currentLocale }) => {
  const { route, allElevations, placeData, routeDifficultyScores, allScores, similarityMatrix, routeNames } = props as RouteJsonProps;
  const config = getCityConfig();
  const locale = currentLocale || defaultLocale();
  const { name, tagline, distance_km, tags, media, variants, gpxTracks } = route.data;

  const trans = route.data.translations?.[locale];
  const localeName = trans?.name || name;
  const localeTagline = trans?.tagline || tagline;

  const asSlugInput = route as unknown as Parameters<typeof routeSlug>[0];
  const slug = routeSlug(asSlugInput, locale);

  // Build variants array
  const jsonVariants = variants.map((v) => {
    const track = gpxTracks[v.gpx];
    const vKey = variantKey(v.gpx);
    const vSlug = variantSlug(v.gpx);

    const result: Record<string, unknown> = {
      name: v.name,
      key: vKey,
      distance_km: v.distance_km || distance_km,
    };

    if (track) {
      result.elevation_gain_m = track.elevation_gain_m;
      const elConclusion = elevationConclusion(track.elevation_gain_m, allElevations);
      if (elConclusion) result.elevation_conclusion = elConclusion;
      const shape = routeShape(track.points, track.distance_m);
      if (shape) result.shape = shape;
      result.polyline = track.polyline;

      // Center and bounds
      const mid = track.points[Math.floor(track.points.length / 2)];
      const lats = track.points.map((p) => p.lat);
      const lons = track.points.map((p) => p.lon);
      result.center = [mid.lat, mid.lon];
      result.bounds = [
        [Math.min(...lats), Math.min(...lons)],
        [Math.max(...lats), Math.max(...lons)],
      ];
    }

    // Difficulty
    const scores = routeDifficultyScores.get(route.id);
    const variantIndex = variants.indexOf(v);
    if (scores?.[variantIndex] != null) {
      result.difficulty_score = scores[variantIndex];
      result.difficulty_label = difficultyLabel(scores[variantIndex], allScores);
    }

    // GPX download URL
    result.gpx_url = `/routes/${route.id}/${vSlug}.gpx`;

    // External links
    if (v.strava_url) result.strava_url = v.strava_url;
    if (v.rwgps_url) result.rwgps_url = v.rwgps_url;
    if (v.komoot_url) result.komoot_url = v.komoot_url;

    return result;
  });

  // Build media array
  const cdnUrl = config.cdn_url;
  const videosCdnUrl = config.videos_cdn_url;
  const jsonMedia = media.map((m) => {
    const entry: Record<string, unknown> = {
      type: m.type,
      key: m.key,
    };
    if (m.type === 'photo') {
      entry.url = `${cdnUrl}/${m.key}`;
      if (m.caption) entry.caption = m.caption;
    } else {
      entry.url = `${videosCdnUrl}/${m.key}`;
      if (m.title) entry.title = m.title;
      if (m.duration) entry.duration = m.duration;
    }
    if (m.cover) entry.cover = true;
    if (m.width) entry.width = m.width;
    if (m.height) entry.height = m.height;
    if (m.lat != null) entry.lat = m.lat;
    if (m.lng != null) entry.lng = m.lng;
    return entry;
  });

  // Nearby places
  const primaryGpx = variants[0]?.gpx;
  const primaryTrack = primaryGpx ? gpxTracks[primaryGpx] : null;
  const nearbyPlaces = primaryTrack ? findNearbyPlaces(primaryTrack.points, placeData) : [];
  const jsonNearby = nearbyPlaces.slice(0, 10).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    distance_m: Math.round(p.distance_m),
    lat: p.lat,
    lng: p.lng,
  }));

  // Similar routes
  const similar = findSimilarRoutes(route.id, similarityMatrix, 3);
  const jsonSimilar = similar.map((s) => ({
    id: s.id,
    name: routeNames[s.id] || s.id,
    score: s.score,
  }));

  // Translations
  const jsonTranslations: Record<string, unknown> = {};
  for (const loc of supportedLocales()) {
    if (loc === locale) continue;
    const t = route.data.translations?.[loc];
    jsonTranslations[loc] = {
      name: t?.name || name,
      tagline: t?.tagline || tagline,
      url: paths.route(routeSlug(asSlugInput, loc), loc),
    };
  }

  const json = {
    id: route.id,
    name: localeName,
    tagline: localeTagline,
    url: paths.route(slug, locale),
    distance_km,
    tags,
    created_at: route.data.created_at,
    updated_at: route.data.updated_at,
    variants: jsonVariants,
    media: jsonMedia,
    nearby_places: jsonNearby,
    similar_routes: jsonSimilar,
    translations: jsonTranslations,
  };

  return new Response(JSON.stringify(json), {
    headers: { 'Content-Type': 'application/json' },
  });
};
