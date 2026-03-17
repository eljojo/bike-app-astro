import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import fs from 'node:fs';
import { cityDir } from '../../lib/config/config.server';
import { variantSlug, variantFilename, rideGpxPath, serveGpxFile } from '../../lib/gpx/download.server';
import { loadBuildPlan, filterByBuildPlan } from '../../lib/content/build-plan.server';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const routes = await getCollection('routes');
  const filtered = filterByBuildPlan(routes, loadBuildPlan(), 'ride');
  const paths: { params: { slug: string; variant: string }; props: { gpxFilePath: string; filename: string } }[] = [];

  for (const route of filtered) {
    if (!route.data.gpxRelativePath) continue;
    const gpxFilePath = rideGpxPath(cityDir, route.data.gpxRelativePath);
    if (!fs.existsSync(gpxFilePath)) continue;

    for (const variant of route.data.variants) {
      paths.push({
        params: { slug: route.id, variant: variantSlug(variant.gpx) },
        props: { gpxFilePath, filename: `${route.id}-${variantFilename(variant.gpx)}` },
      });
    }
  }
  return paths;
};

export const GET: APIRoute = async ({ props }) => {
  const { gpxFilePath, filename } = props;
  return serveGpxFile(gpxFilePath, filename)!;
};
