import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getCityConfig } from '../lib/config/city-config';
import { getInstanceFeatures } from '../lib/config/instance-features';
import { loadRouteFacts, loadUpcomingEvents, formatCategory } from './llms-shared';

export const prerender = true;

export const GET: APIRoute = async () => {
  const config = getCityConfig();
  const features = getInstanceFeatures();
  const routeFacts = await loadRouteFacts();
  const events = await loadUpcomingEvents();

  const sections: string[] = [];

  // Header
  sections.push(`# ${config.display_name} — Full Reference\n`);
  sections.push(`> ${config.description}\n`);

  if (features.hasRoutes && features.showsContributeLink) {
    sections.push(
      `${config.display_name} is a community-maintained cycling wiki where every route has been ridden by a real person. ` +
      `Anyone can contribute routes, photos, corrections, and local knowledge. ` +
      `All routes include GPS tracks you can download and ride.\n`
    );
  } else if (features.hasRides) {
    sections.push(`${config.display_name} is a personal cycling journal with ride logs, photos, and GPS tracks.\n`);
  }

  sections.push(`This is the detailed version of ${config.url}/llms.txt with full route descriptions, nearby places, and event details.\n`);

  // Routes
  if (routeFacts.length > 0) {
    const routeBlocks = routeFacts.map(r => {
      const lines: string[] = [];
      lines.push(`### ${r.name}\n`);
      lines.push(`- **Distance:** ${Math.round(r.distance_km)} km`);

      const shape = r.shape ? `${r.shape[0].toUpperCase()}${r.shape.slice(1)}` : null;
      lines.push(`- **Type:** ${shape ? `${shape} on ${r.surface}` : r.surface}`);

      if (r.elevation_gain_m > 0) {
        lines.push(`- **Elevation:** ${Math.round(r.elevation_gain_m)}m gain`);
      }

      lines.push(`- **Difficulty:** ${r.difficulty[0].toUpperCase()}${r.difficulty.slice(1)} (relative to other routes on this site)`);

      if (r.tags.length > 0) {
        lines.push(`- **Tags:** ${r.tags.join(', ')}`);
      }

      if (r.nearbyPlaceNames.length > 0) {
        lines.push(`- **Nearby:** ${r.nearbyPlaceNames.join(', ')}`);
      }

      if (r.gpxDownloadPath) {
        lines.push(`- **GPX download:** ${config.url}${r.gpxDownloadPath}`);
      }

      lines.push(`- **More info:** ${r.url}`);

      if (r.body) {
        lines.push('');
        lines.push(r.body);
      }

      return lines.join('\n');
    });

    sections.push(`## Routes\n\n${routeBlocks.join('\n\n---\n\n')}\n`);
  }

  // Upcoming events
  if (events.length > 0) {
    const eventBlocks = events.map(e => {
      const lines: string[] = [];
      lines.push(`### ${e.name}\n`);
      lines.push(`- **Date:** ${e.date}`);
      if (e.location) lines.push(`- **Location:** ${e.location}`);
      if (e.distances) lines.push(`- **Distances:** ${e.distances}`);
      if (e.body) {
        lines.push('');
        lines.push(e.body);
      }
      return lines.join('\n');
    });

    sections.push(`## Upcoming Events\n\n${eventBlocks.join('\n\n---\n\n')}\n`);
  }

  // Places
  if (features.hasPlaces) {
    const places = await getCollection('places');
    const published = places.filter(p => p.data.status === 'published');

    if (published.length > 0) {
      // Group by category
      const grouped = new Map<string, string[]>();
      for (const p of published) {
        const cat = p.data.category;
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push(p.data.name);
      }

      // Sort categories by count (most places first), names alphabetically within
      const categoryBlocks = [...grouped.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([cat, names]) => {
          const sorted = names.sort((a, b) => a.localeCompare(b));
          return `### ${formatCategory(cat)}\n\n${sorted.map(n => `- ${n}`).join('\n')}`;
        });

      sections.push(`## Places\n\n${categoryBlocks.join('\n\n')}\n`);
    }
  }

  const text = sections.join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
