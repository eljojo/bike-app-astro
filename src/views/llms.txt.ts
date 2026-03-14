import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getCityConfig } from '../lib/city-config';

export const prerender = true;

function stripEmoji(text: string): string {
  return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?/gu, '').replace(/\s{2,}/g, ' ').trim();
}

export const GET: APIRoute = async () => {
  const config = getCityConfig();
  const routes = await getCollection('routes');
  const guides = await getCollection('guides');
  type Route = (typeof routes)[number];
  type Guide = (typeof guides)[number];

  const published = routes
    .filter((r: Route) => r.data.status === 'published')
    .sort((a: Route, b: Route) => a.data.name.localeCompare(b.data.name));
  const pubGuides = guides
    .filter((g: Guide) => g.data.status === 'published')
    .sort((a: Guide, b: Guide) => a.data.name.localeCompare(b.data.name));

  const routeLines = published.map((r: Route) => {
    const desc = stripEmoji(r.data.tagline || `${r.data.distance_km}km cycling route`);
    return `- [${stripEmoji(r.data.name)}](${config.url}/routes/${r.id}): ${desc}`;
  });

  const guideLines = pubGuides.map((g: Guide) => {
    const desc = stripEmoji(g.data.tagline || 'Cycling guide');
    return `- [${stripEmoji(g.data.name)}](${config.url}/guides/${g.id}): ${desc}`;
  });

  const text = `# ${config.display_name}

> ${config.description}

## Routes

${routeLines.join('\n')}

## Guides

${guideLines.join('\n')}

## Pages

- [Interactive Map](${config.url}/map): Map of all routes and points of interest
- [Calendar](${config.url}/calendar): Upcoming cycling events in the region
- [Videos](${config.url}/videos): Cycling videos
- [About](${config.url}/about): About ${config.display_name} and ${config.author.name}
`;

  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
