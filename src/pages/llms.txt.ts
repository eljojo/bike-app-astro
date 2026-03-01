import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

function stripEmoji(text: string): string {
  return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?/gu, '').replace(/\s{2,}/g, ' ').trim();
}

export const GET: APIRoute = async () => {
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
    return `- [${stripEmoji(r.data.name)}](https://ottawabybike.ca/routes/${r.id}): ${desc}`;
  });

  const guideLines = pubGuides.map(g => {
    const desc = stripEmoji(g.data.tagline || 'Cycling guide');
    return `- [${stripEmoji(g.data.name)}](https://ottawabybike.ca/guides/${g.id}): ${desc}`;
  });

  const text = `# Ottawa by Bike

> Ottawa by Bike is a curated guide to cycling routes in Ottawa and Gatineau, Canada.
> It covers road routes, gravel routes, and multi-use pathways across the National
> Capital Region, with GPS tracks, elevation profiles, photos, and local tips.

## Routes

${routeLines.join('\n')}

## Guides

${guideLines.join('\n')}

## Pages

- [Interactive Map](https://ottawabybike.ca/map): Map of all routes and points of interest
- [Calendar](https://ottawabybike.ca/calendar): Upcoming cycling events in the region
- [Videos](https://ottawabybike.ca/videos): Cycling videos from Ottawa and beyond
- [About](https://ottawabybike.ca/about): About Ottawa by Bike and José Albornoz
`;

  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
