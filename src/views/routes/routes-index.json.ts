import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '../../lib/content/content-filters';
import { getInstanceFeatures } from '../../lib/config/instance-features';
import { getCityConfig } from '../../lib/config/city-config';
import { routeShape } from '../../lib/route-insights';
import { difficultyLabel, scoreRoute } from '../../lib/difficulty';
import { paths, routeSlug } from '../../lib/paths';
import { defaultLocale } from '../../lib/i18n/locale-utils';
// NOTE: This is a single-output endpoint (not parameterized), so it must NOT
// use filterByBuildPlan — doing so would produce a partial index in incremental
// mode, overwriting the full one from the previous build.

export const prerender = true;

export const GET: APIRoute = async ({ currentLocale }) => {
  if (!getInstanceFeatures().hasRoutes) {
    return new Response(JSON.stringify({ routes: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const config = getCityConfig();
  const locale = currentLocale || defaultLocale();
  const allRoutes = await getCollection('routes');
  const published = allRoutes.filter(isPublished);

  const allScores = published
    .map(r => scoreRoute(r))
    .filter(s => s.length > 0)
    .map(s => s[0]);

  const routes = published.map(route => {
    const { name, tagline, distance_km, tags, media, variants, gpxTracks } = route.data;
    const trans = route.data.translations?.[locale];

    const primaryGpx = variants[0]?.gpx;
    const primaryTrack = primaryGpx ? gpxTracks[primaryGpx] : null;
    const shape = primaryTrack ? routeShape(primaryTrack.points, primaryTrack.distance_m) : null;

    const scores = scoreRoute(route);
    const primaryScore = scores[0] ?? null;
    const label = primaryScore !== null ? difficultyLabel(primaryScore, allScores) : null;

    const cover = media.find((m) => m.cover);
    const cdnUrl = config.cdn_url;

    const asSlugInput = route as unknown as Parameters<typeof routeSlug>[0];

    const entry: Record<string, unknown> = {
      id: route.id,
      name: trans?.name || name,
      tagline: trans?.tagline || tagline,
      url: paths.route(routeSlug(asSlugInput, locale), locale),
      distance_km,
      tags,
    };
    if (shape) entry.shape = shape;
    if (label) entry.difficulty_label = label;
    if (cover) {
      entry.cover = {
        key: cover.key,
        url: `${cdnUrl}/${cover.key}`,
        width: cover.width,
        height: cover.height,
      };
    }

    return entry;
  });

  return new Response(JSON.stringify({ routes }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
