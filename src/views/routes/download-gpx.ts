import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import fs from 'node:fs';
import { cityDir } from '../../lib/config/config';
import { variantSlug, variantFilename, routeGpxPath, serveGpxFile } from '../../lib/gpx/download';
import { loadBuildPlan, filterByBuildPlan } from '../../lib/content/build-plan';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const routes = await getCollection('routes');
  const filtered = filterByBuildPlan(routes, loadBuildPlan(), 'route');
  const paths: { params: { slug: string; variant: string }; props: { gpxFilePath: string; filename: string } }[] = [];

  for (const route of filtered) {
    for (const variant of route.data.variants) {
      const gpxFilePath = routeGpxPath(cityDir, route.id, variant.gpx);
      if (fs.existsSync(gpxFilePath)) {
        paths.push({
          params: { slug: route.id, variant: variantSlug(variant.gpx) },
          props: { gpxFilePath, filename: `${route.id}-${variantFilename(variant.gpx)}` },
        });
      }
    }
  }
  return paths;
};

export const GET: APIRoute = async ({ props }) => {
  const { gpxFilePath, filename } = props;
  return serveGpxFile(gpxFilePath, filename)!;
};
