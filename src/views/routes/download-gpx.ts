import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import fs from 'node:fs';
import path from 'node:path';
import { cityDir } from '@/lib/config';

export const getStaticPaths: GetStaticPaths = async () => {
  const routes = await getCollection('routes');
  const paths: { params: { slug: string; variant: string }; props: { routeId: string; gpxFile: string } }[] = [];

  for (const route of routes) {
    for (const variant of route.data.variants) {
      const variantName = variant.gpx.replace(/\.gpx$/, '').replace(/^variants\//, '');
      paths.push({
        params: { slug: route.id, variant: variantName },
        props: { routeId: route.id, gpxFile: variant.gpx },
      });
    }
  }
  return paths;
};

export const GET: APIRoute = async ({ props }) => {
  const { routeId, gpxFile } = props;
  const gpxPath = path.join(cityDir, 'routes', routeId, gpxFile);

  if (!fs.existsSync(gpxPath)) {
    return new Response('Not found', { status: 404 });
  }

  const content = fs.readFileSync(gpxPath, 'utf-8');
  return new Response(content, {
    headers: {
      'Content-Type': 'application/gpx+xml',
      'Content-Disposition': `attachment; filename="${routeId}-${gpxFile.replace('variants/', '')}"`,
    },
  });
};
