import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getCityConfig } from '../lib/city-config';

function stripEmoji(text: string): string {
  return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?/gu, '').replace(/\s{2,}/g, ' ').trim();
}

export const GET: APIRoute = async () => {
  const config = getCityConfig();
  const routes = await getCollection('routes');
  const guides = await getCollection('guides');

  const published = routes
    .filter(r => r.data.status === 'published')
    .sort((a, b) => a.data.name.localeCompare(b.data.name));
  const pubGuides = guides
    .filter(g => g.data.status === 'published')
    .sort((a, b) => a.data.name.localeCompare(b.data.name));

  const routeLines = published.map(r => {
    const desc = stripEmoji(r.data.tagline || `${r.data.distance_km}km cycling route`);
    return `- [${stripEmoji(r.data.name)}](${config.url}/routes/${r.id}): ${desc}`;
  });

  const guideLines = pubGuides.map(g => {
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
