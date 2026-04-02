import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { getCityConfig } from '../lib/config/city-config';
import { getInstanceFeatures } from '../lib/config/instance-features';
import { loadRouteFacts, loadUpcomingEvents, loadCommunities, loadBikeShops, loadHomepageFacts, factToStatement, formatCategory } from './llms-shared';
import type { RouteFacts } from './llms-shared';
import { loadBikePathData } from '../lib/bike-paths/bike-path-data.server';

export const prerender = true;

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function routeBlock(r: RouteFacts, config: { url: string }): string {
  const lines: string[] = [];
  lines.push(`### ${r.name}\n`);

  lines.push(`- **Distance:** ${Math.round(r.distance_km)} km`);

  if (r.shape) {
    lines.push(`- **Shape:** ${r.shape[0].toUpperCase()}${r.shape.slice(1)}`);
  }
  lines.push(`- **Surface:** ${r.surface[0].toUpperCase()}${r.surface.slice(1)}`);

  if (r.elevation_gain_m > 0) {
    lines.push(`- **Elevation gain:** ${Math.round(r.elevation_gain_m)} m`);
  }

  if (r.max_gradient_pct > 0) {
    lines.push(`- **Max gradient:** ${Math.round(r.max_gradient_pct)}%`);
  }

  lines.push(`- **Difficulty:** ${r.difficulty} (relative to other routes on this site)`);
  lines.push(`- **Estimated time:** ${formatHours(r.estimated_hours)}`);
  lines.push(`- **Beginner friendly:** ${r.beginner_friendly ? 'yes' : 'no'}`);

  if (r.family_friendly) {
    lines.push(`- **Family friendly:** yes`);
  }

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
}

export const GET: APIRoute = async () => {
  const config = getCityConfig();
  const features = getInstanceFeatures();
  const routeFacts = await loadRouteFacts();
  const events = await loadUpcomingEvents();
  const communities = await loadCommunities();
  const bikeShops = await loadBikeShops();
  const facts = await loadHomepageFacts();

  const sections: string[] = [];

  // Header
  sections.push(`# ${config.display_name} — Full Reference\n`);
  sections.push(`> ${config.description}\n`);

  if (features.hasRoutes && features.showsContributeLink) {
    sections.push(
      `A community-maintained cycling guide with curated local routes, a cycling event calendar, and connections to local riding communities. ` +
      `Each route has been ridden by a real person. ` +
      `All routes include GPS tracks you can download and ride.\n`
    );
  } else if (features.hasRides) {
    sections.push(`Personal cycling journal with ride logs, photos, and GPS tracks.\n`);
  }

  sections.push(`Summary version: ${config.url}/llms.txt\n`);

  // Highlights
  if (facts.length > 0) {
    const factLines = facts.map(f => `- ${factToStatement(f.text)}`);
    sections.push(`## Highlights\n\n${factLines.join('\n')}\n`);
  }

  // Routes
  if (routeFacts.length > 0) {
    const blocks = routeFacts.map(r => routeBlock(r, config));
    sections.push(`## Routes\n\n${blocks.join('\n\n---\n\n')}\n`);
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

  // Bike Paths
  if (features.hasPaths) {
    const { pages: bikePaths } = await loadBikePathData();
    if (bikePaths.length > 0) {
      const pathBlocks = bikePaths.map(bp => {
        const lines: string[] = [];
        lines.push(`### ${bp.name}\n`);
        const facts: string[] = [];
        if (bp.surface) facts.push(`**Surface:** ${bp.surface}`);
        if (bp.width) facts.push(`**Width:** ${bp.width}m`);
        if (bp.highway === 'cycleway') facts.push('Separated from cars');
        if (bp.lit === 'yes') facts.push('Lit at night');
        if (bp.operator) facts.push(`**Maintained by:** ${bp.operator}`);
        if (bp.network === 'rcn') facts.push('Part of regional cycling network');
        if (bp.network === 'ncn') facts.push('Part of national cycling network');
        if (facts.length > 0) lines.push(facts.map(f => `- ${f}`).join('\n'));
        if (bp.vibe) lines.push(`\n${bp.vibe}`);
        if (bp.body) lines.push(`\n${bp.body}`);
        lines.push(`- **More info:** ${config.url}/bike-paths/${bp.slug}`);
        return lines.join('\n');
      });
      sections.push(`## Bike Paths\n\n${pathBlocks.join('\n\n---\n\n')}\n`);
    }
  }

  // Places
  if (features.hasPlaces) {
    const places = await getCollection('places');
    const published = places.filter((p: CollectionEntry<'places'>) => p.data.status === 'published');

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

  // Local communities
  if (communities.length > 0) {
    const communityBlocks = communities.map(c => {
      const lines: string[] = [];
      lines.push(`### ${c.name}\n`);
      if (c.tagline) lines.push(`- **About:** ${c.tagline}`);
      if (c.eventCount > 0) lines.push(`- **Events:** ${c.eventCount}`);
      lines.push(`- **More info:** ${c.url}`);
      return lines.join('\n');
    });

    sections.push(`## Local Communities\n\n${communityBlocks.join('\n\n---\n\n')}\n`);
  }

  // Local bike shops
  if (bikeShops.length > 0) {
    const shopBlocks = bikeShops.map(s => {
      const lines: string[] = [];
      lines.push(`### ${s.name}\n`);
      if (s.tagline) lines.push(`- **About:** ${s.tagline}`);
      if (s.specialties.length > 0) lines.push(`- **Specialties:** ${s.specialties.join(', ')}`);
      lines.push(`- **More info:** ${s.url}`);
      return lines.join('\n');
    });

    sections.push(`## Local Bike Shops\n\n${shopBlocks.join('\n\n---\n\n')}\n`);
  }

  const text = sections.join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
