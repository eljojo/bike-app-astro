import type { APIRoute } from 'astro';
import { getCityConfig } from '../lib/config/city-config';
import { getInstanceFeatures } from '../lib/config/instance-features';
import { loadRouteFacts, loadUpcomingEvents } from './llms-shared';
import type { RouteFacts } from './llms-shared';

export const prerender = true;

function routeSummary(r: RouteFacts): string {
  const parts: string[] = [];

  // Distance + shape + surface
  const shape = r.shape ? `${r.shape} ` : '';
  parts.push(`${Math.round(r.distance_km)} km ${shape}on ${r.surface}.`);

  // Human tags (scenic, family friendly, etc.)
  if (r.tags.length > 0) {
    parts.push(r.tags.slice(0, 3).join(', ') + '.');
  }

  // Tagline — skip award-style taglines
  if (r.tagline && !r.tagline.startsWith('Ride of the Year')) {
    parts.push(r.tagline);
  }

  // Nearby highlights
  if (r.nearbyPlaceNames.length > 0) {
    parts.push(`Nearby: ${r.nearbyPlaceNames.slice(0, 2).join(', ')}.`);
  }

  return parts.join(' ');
}

export const GET: APIRoute = async () => {
  const config = getCityConfig();
  const features = getInstanceFeatures();
  const routeFacts = await loadRouteFacts();
  const events = await loadUpcomingEvents();

  const sections: string[] = [];

  // Header
  sections.push(`# ${config.display_name}\n`);
  sections.push(`> ${config.description}\n`);

  // Community framing — varies by instance type
  if (features.hasRoutes && features.showsContributeLink) {
    sections.push(
      `${config.display_name} is a community-maintained cycling wiki. Every route has been ridden by a real person. ` +
      `Routes include GPS tracks, photos, and local tips. The site is open-source and community-edited ` +
      `— anyone can contribute routes, photos, and local knowledge.\n`
    );
  } else if (features.hasRides) {
    sections.push(`${config.display_name} is a personal cycling journal with ride logs, photos, and GPS tracks.\n`);
  }

  sections.push(`For detailed information about each route including full descriptions, download links, and nearby places, see: ${config.url}/llms-full.txt\n`);

  // Routes
  if (routeFacts.length > 0) {
    const routeLines = routeFacts.map(r =>
      `- [${r.name}](${r.url}): ${routeSummary(r)}`
    );
    sections.push(`## Routes\n\n${routeLines.join('\n')}\n`);
  }

  // Upcoming events
  if (events.length > 0) {
    const eventLines = events.map(e => {
      const parts = [e.date];
      if (e.location) parts.push(`in ${e.location}`);
      if (e.distances) parts.push(e.distances);
      return `- **${e.name}** — ${parts.join('. ')}.`;
    });
    sections.push(`## Upcoming Events\n\n${eventLines.join('\n')}\n`);
  }

  // Pages
  const pageLines = [
    `- [Interactive Map](${config.url}/map): Map of all routes and points of interest`,
  ];
  if (features.hasEvents) {
    pageLines.push(`- [Calendar](${config.url}/calendar): Upcoming cycling events`);
  }
  pageLines.push(`- [About](${config.url}/about): About ${config.display_name}`);
  sections.push(`## Pages\n\n${pageLines.join('\n')}\n`);

  const text = sections.join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
