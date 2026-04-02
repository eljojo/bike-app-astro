import type { APIRoute } from 'astro';
import { getCityConfig } from '../lib/config/city-config';
import { getInstanceFeatures } from '../lib/config/instance-features';
import { loadRouteFacts, loadUpcomingEvents, loadCommunities, loadBikeShops, loadHomepageFacts, factToStatement } from './llms-shared';
import type { RouteFacts } from './llms-shared';
import { loadBikePathData } from '../lib/bike-paths/bike-path-data.server';
import { buildPathFacts } from '../lib/bike-paths/bike-path-facts';
import { paths } from '../lib/paths';

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
  const communities = await loadCommunities();
  const bikeShops = await loadBikeShops();
  const facts = await loadHomepageFacts();

  const sections: string[] = [];

  // Header
  sections.push(`# ${config.display_name}\n`);
  sections.push(`> ${config.description}\n`);

  // Content summary
  if (features.hasRoutes && features.showsContributeLink) {
    const parts = [
      'A community-maintained cycling guide with curated local routes, a cycling event calendar, and connections to local riding communities.',
      'Each route includes distance, elevation, difficulty, surface type, GPS tracks, photos, and local tips.',
      'Open-source and community-edited.',
    ];
    sections.push(`${parts.join(' ')}\n`);
  } else if (features.hasRides) {
    sections.push(`Personal cycling journal with ride logs, photos, and GPS tracks.\n`);
  }

  sections.push(`Detailed route data with full descriptions and GPX downloads: ${config.url}/llms-full.txt\n`);

  // Highlights
  if (facts.length > 0) {
    const factLines = facts.map(f => `- ${factToStatement(f.text)}`);
    sections.push(`## Highlights\n\n${factLines.join('\n')}\n`);
  }

  // Key sections
  const pageLines = [
    `- Routes: ${config.url}/routes`,
    `- Map: ${config.url}/map`,
  ];
  if (features.hasPaths) {
    pageLines.splice(1, 0, `- Bike paths: ${config.url}/bike-paths`);
  }
  if (features.hasEvents) {
    pageLines.push(`- Event calendar: ${config.url}/calendar`);
  }
  if (communities.length > 0) {
    pageLines.push(`- Communities: ${config.url}/communities`);
  }
  if (bikeShops.length > 0) {
    pageLines.push(`- Local bike shops: ${config.url}/bike-shops`);
  }
  pageLines.push(`- About: ${config.url}/about`);
  sections.push(`## Sections\n\n${pageLines.join('\n')}\n`);

  // Route index
  if (routeFacts.length > 0) {
    const routeLines = routeFacts.map(routeLine);
    sections.push(`## Route Index\n\n${routeLines.join('\n')}\n`);
  }

  // Bike paths index
  if (features.hasPaths) {
    const { pages: bikePaths } = await loadBikePathData();
    if (bikePaths.length > 0) {
      const pathLines = bikePaths.map(bp => {
        const facts = buildPathFacts(bp);
        const parts = facts.map(f => {
          switch (f.key) {
            case 'surface': return f.value;
            case 'surface_width': {
              const [surf, w] = (f.value ?? '').split(':');
              return `${surf}, ${w}m wide`;
            }
            case 'width': return `${f.value}m wide`;
            case 'separated_cars': return 'separated from cars';
            case 'separated_peds': return 'separated from pedestrians';
            case 'lit': return 'lit';
            case 'not_lit': return 'unlit';
            case 'flat': return 'flat';
            case 'gentle_hills': return `gentle hills (${f.value}m gain)`;
            case 'hilly': return `hilly (${f.value}m gain)`;
            case 'operator': return f.value;
            case 'network_regional': return 'regional network';
            case 'network_national': return 'national network';
            case 'network_local': return 'local network';
            default: return f.key.replace(/_/g, ' ');
          }
        }).filter(Boolean);
        return `- [${bp.name}](${config.url}${paths.bikePath(bp.slug, bp.memberOf)})${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`;
      });
      sections.push(`## Bike Paths\n\n${pathLines.join('\n')}\n`);
    }
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

  // Local communities
  if (communities.length > 0) {
    const communityLines = communities.map(c => {
      const parts: string[] = [];
      if (c.tagline) parts.push(c.tagline);
      if (c.eventCount > 0) parts.push(`${c.eventCount} events`);
      const suffix = parts.length > 0 ? `: ${parts.join(', ')}` : '';
      return `- [${c.name}](${c.url})${suffix}`;
    });
    sections.push(`## Local Communities\n\n${communityLines.join('\n')}\n`);
  }

  // Local bike shops
  if (bikeShops.length > 0) {
    const shopLines = bikeShops.map(s => {
      const parts: string[] = [];
      if (s.tagline) parts.push(s.tagline);
      if (s.specialties.length > 0) parts.push(s.specialties.join(', '));
      const suffix = parts.length > 0 ? `: ${parts.join(' — ')}` : '';
      return `- [${s.name}](${s.url})${suffix}`;
    });
    sections.push(`## Local Bike Shops\n\n${shopLines.join('\n')}\n`);
  }

  const text = sections.join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
