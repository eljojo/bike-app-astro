import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getCityConfig } from '../lib/config/city-config';

export const prerender = true;

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const GET: APIRoute = async () => {
  const config = getCityConfig();
  const routes = await getCollection('routes');
  type Route = (typeof routes)[number];
  const published = routes
    .filter((r: Route) => r.data.status === 'published')
    .sort((a: Route, b: Route) => new Date(b.data.updated_at).getTime() - new Date(a.data.updated_at).getTime());

  const items = published.map((r: Route) => `    <item>
      <title>${escapeXml(r.data.name)}</title>
      <link>${config.url}/routes/${r.id}</link>
      <guid>${config.url}/routes/${r.id}</guid>
      <description>${escapeXml(r.data.tagline || `${r.data.name} — ${r.data.distance_km}km cycling route`)}</description>
      <pubDate>${new Date(r.data.updated_at).toUTCString()}</pubDate>
    </item>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(config.display_name)}</title>
    <link>${config.url}</link>
    <description>${escapeXml(config.tagline)}</description>
    <language>${config.locale}</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml' } });
};
