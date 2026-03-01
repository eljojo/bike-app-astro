import { getCityConfig } from './city-config';
import { paths } from './paths';

const BASE = getCityConfig().url;

interface SitemapEntry {
  url: string;
  lastmod?: string;
  priority: number;
}

export function buildSitemapEntries({ routes, guides }: {
  routes: { id: string; data: { status: string; updated_at: string; variants?: { name: string; gpx: string }[] } }[];
  guides: { id: string; data: { status: string } }[];
}): SitemapEntry[] {
  const entries: SitemapEntry[] = [
    { url: BASE, priority: 1.0 },
    { url: `${BASE}/calendar`, priority: 1.0 },
    { url: `${BASE}/map`, priority: 0.2 },
    { url: `${BASE}/about`, priority: 0.6 },
    { url: `${BASE}/videos`, priority: 0.5 },
    { url: `${BASE}/guides`, priority: 0.8 },
  ];

  const published = routes.filter(r => r.data.status === 'published');
  for (const r of published) {
    entries.push({ url: `${BASE}${paths.route(r.id)}`, lastmod: r.data.updated_at, priority: 0.8 });
    entries.push({ url: `${BASE}${paths.routeMap(r.id)}`, lastmod: r.data.updated_at, priority: 0.2 });
  }

  const pubGuides = guides.filter(g => g.data.status === 'published');
  for (const g of pubGuides) {
    entries.push({ url: `${BASE}${paths.guide(g.id)}`, priority: 0.7 });
  }

  return entries;
}

export function renderSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map(e => {
    let xml = `  <url>\n    <loc>${e.url}</loc>`;
    if (e.lastmod) xml += `\n    <lastmod>${e.lastmod}</lastmod>`;
    xml += `\n    <priority>${e.priority.toFixed(1)}</priority>`;
    xml += `\n  </url>`;
    return xml;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}
