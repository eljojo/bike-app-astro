import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { variantSlug, variantFilename } from '../../lib/gpx/download.server';
import { gpxResponse } from '../../lib/gpx/download.server';
import { buildGpxFromPoints } from '../../lib/geo/elevation-enrichment';
import { loadBuildPlan, filterByBuildPlan } from '../../lib/content/build-plan.server';
interface TrackPoints {
  points: { lat: number; lon: number; ele?: number }[];
}

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const routes = await getCollection('routes');
  const filtered = filterByBuildPlan(routes, loadBuildPlan(), 'ride');
  const paths: { params: { slug: string; variant: string }; props: { name: string; track: TrackPoints; filename: string } }[] = [];

  for (const route of filtered) {
    for (const variant of route.data.variants) {
      const track = route.data.gpxTracks[variant.gpx];
      if (!track?.points?.length) continue;

      paths.push({
        params: { slug: route.id, variant: variantSlug(variant.gpx) },
        props: {
          name: route.data.name,
          track: { points: track.points },
          filename: `${route.id}-${variantFilename(variant.gpx)}`,
        },
      });
    }
  }
  return paths;
};

export const GET: APIRoute = async ({ props }) => {
  const { name, track, filename } = props;
  // Generate GPX from the privacy-filtered track points (already filtered by the loader)
  const points = track.points.map((p: { lat: number; lon: number; ele?: number }) => ({
    lat: p.lat,
    lon: p.lon,
    ele: p.ele,
  }));
  const gpxXml = buildGpxFromPoints(name, points);
  return gpxResponse(gpxXml, filename);
};
