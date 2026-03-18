import type { APIRoute } from 'astro';
import { getCityConfig } from '../lib/config/city-config';
import { getInstanceFeatures } from '../lib/config/instance-features';
import { loadRouteFacts, loadUpcomingEvents } from './llms-shared';
import type { RouteFacts } from './llms-shared';

export const prerender = true;

function routeLine(r: RouteFacts): string {
  const parts: string[] = [
    `${Math.round(r.distance_km)} km`,
    r.surface,
  ];
  if (r.shape) parts.push(r.shape);
  parts.push(r.difficulty);
  if (r.beginner_friendly) parts.push('beginner friendly');
  else if (r.family_friendly) parts.push('family friendly');
  return `- [${r.name}](${r.url}): ${parts.join(', ')}`;
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

  // Content summary
  if (features.hasRoutes && features.showsContributeLink) {
    const content = [
      'Community-maintained cycling route database.',
      'Each route includes distance, elevation, difficulty, surface type, GPS tracks, photos, and local tips.',
      'Open-source and community-edited.',
    ];
    sections.push(`${content.join(' ')}\n`);
  } else if (features.hasRides) {
    sections.push(`Personal cycling journal with ride logs, photos, and GPS tracks.\n`);
  }

  sections.push(`Detailed route data with full descriptions and GPX downloads: ${config.url}/llms-full.txt\n`);

  // Key sections
  const pageLines = [
    `- Routes: ${config.url}/routes`,
    `- Map: ${config.url}/map`,
  ];
  if (features.hasEvents) {
    pageLines.push(`- Calendar: ${config.url}/calendar`);
  }
  pageLines.push(`- About: ${config.url}/about`);
  sections.push(`## Sections\n\n${pageLines.join('\n')}\n`);

  // Route index
  if (routeFacts.length > 0) {
    const routeLines = routeFacts.map(routeLine);
    sections.push(`## Route Index\n\n${routeLines.join('\n')}\n`);
  }

  // Upcoming events
  if (events.length > 0) {
    const eventLines = events.map(e => {
      const parts = [e.date];
      if (e.location) parts.push(e.location);
      if (e.distances) parts.push(e.distances);
      return `- ${e.name}: ${parts.join(', ')}`;
    });
    sections.push(`## Upcoming Events\n\n${eventLines.join('\n')}\n`);
  }

  const text = sections.join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
