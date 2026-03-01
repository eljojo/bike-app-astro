import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const routes = await getCollection('routes');
  const guides = await getCollection('guides');
  const base = 'https://ottawabybike.ca';

  const urls = [
    base,
    `${base}/calendar`,
    `${base}/map`,
    `${base}/about`,
    `${base}/videos`,
    `${base}/guides`,
    ...routes.filter(r => r.data.status === 'published').map(r => `${base}/routes/${r.id}`),
    ...routes.filter(r => r.data.status === 'published').map(r => `${base}/routes/${r.id}/map`),
    ...guides.filter(g => g.data.status === 'published').map(g => `${base}/guides/${g.id}`),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
