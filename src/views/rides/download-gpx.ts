import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const routes = await getCollection('routes');
  const paths: { params: { slug: string; variant: string }; props: { gpxContent: string; filename: string } }[] = [];

  for (const route of routes) {
    for (const variant of route.data.variants) {
      const variantName = variant.gpx.replace(/\.gpx$/, '').replace(/^variants\//, '');
      const track = route.data.gpxTracks[variant.gpx];
      if (track?.rawGpx) {
        paths.push({
          params: { slug: route.id, variant: variantName },
          props: { gpxContent: track.rawGpx, filename: `${route.id}-${variant.gpx.replace('variants/', '')}` },
        });
      }
    }
  }
  return paths;
};

export const GET: APIRoute = async ({ props }) => {
  const { gpxContent, filename } = props;
  return new Response(gpxContent, {
    headers: {
      'Content-Type': 'application/gpx+xml',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
