import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import fs from 'node:fs';
import path from 'node:path';
import { cityDir } from '../../lib/config/config';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const routes = await getCollection('routes');
  const paths: { params: { slug: string; variant: string }; props: { gpxFilePath: string; filename: string } }[] = [];

  for (const route of routes) {
    for (const variant of route.data.variants) {
      const variantName = variant.gpx.replace(/\.gpx$/, '').replace(/^variants\//, '');
      const gpxFilePath = path.join(cityDir, 'routes', route.id, variant.gpx);
      if (fs.existsSync(gpxFilePath)) {
        paths.push({
          params: { slug: route.id, variant: variantName },
          props: { gpxFilePath, filename: `${route.id}-${variant.gpx.replace('variants/', '')}` },
        });
      }
    }
  }
  return paths;
};

export const GET: APIRoute = async ({ props }) => {
  const { gpxFilePath, filename } = props;
  const gpxContent = fs.readFileSync(gpxFilePath, 'utf-8');
  return new Response(gpxContent, {
    headers: {
      'Content-Type': 'application/gpx+xml',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
