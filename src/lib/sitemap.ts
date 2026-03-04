import { getCityConfig } from './city-config';
import { paths, routeSlug } from './paths';
import { translatePath } from './path-translations';
import { supportedLocales, defaultLocale } from './locale-utils';

const BASE = getCityConfig().url;

interface SitemapEntry {
  url: string;
  lastmod?: string;
  priority: number;
  alternates?: { locale: string; url: string }[];
}

/** Build a locale-prefixed URL. Default locale has no prefix. */
function localeUrl(path: string, locale: string): string {
  const defLocale = defaultLocale();
  if (locale === defLocale) return `${BASE}${path}`;
  const translated = translatePath(path, locale);
  return translated === '/' ? `${BASE}/${locale}/` : `${BASE}/${locale}${translated}`;
}

/** Create a sitemap entry with alternates for all supported locales. */
function localizedEntry(path: string, priority: number, lastmod?: string): SitemapEntry[] {
  const locales = supportedLocales();
  const alternates = locales.map(l => ({ locale: l, url: localeUrl(path, l) }));

  return locales.map(locale => ({
    url: localeUrl(path, locale),
    lastmod,
    priority,
    alternates,
  }));
}

/** Create a sitemap entry where the path varies per locale (e.g. route slugs). */
function localizedEntryPerLocale(pathFn: (locale: string) => string, priority: number, lastmod?: string): SitemapEntry[] {
  const locales = supportedLocales();
  const alternates = locales.map(l => ({ locale: l, url: localeUrl(pathFn(l), l) }));

  return locales.map(locale => ({
    url: localeUrl(pathFn(locale), locale),
    lastmod,
    priority,
    alternates,
  }));
}

export function buildSitemapEntries({ routes, guides }: {
  routes: { id: string; data: { status: string; updated_at: string; variants?: { name: string; gpx: string; [k: string]: unknown }[]; translations?: Record<string, { slug?: string; [k: string]: unknown }>; [k: string]: unknown } }[];
  guides: { id: string; data: { status: string; [k: string]: unknown } }[];
}): SitemapEntry[] {
  const entries: SitemapEntry[] = [
    ...localizedEntry('/', 1.0),
    ...localizedEntry('/calendar', 1.0),
    ...localizedEntry('/map', 0.2),
    ...localizedEntry('/about', 0.6),
    ...localizedEntry('/videos', 0.5),
    ...localizedEntry('/guides', 0.8),
  ];

  const published = routes.filter(r => r.data.status === 'published');
  for (const r of published) {
    entries.push(...localizedEntryPerLocale(l => paths.route(routeSlug(r, l)), 0.8, r.data.updated_at));
    entries.push(...localizedEntryPerLocale(l => paths.routeMap(routeSlug(r, l)), 0.2, r.data.updated_at));
  }

  const pubGuides = guides.filter(g => g.data.status === 'published');
  for (const g of pubGuides) {
    entries.push(...localizedEntry(paths.guide(g.id), 0.7));
  }

  return entries;
}

export function renderSitemapXml(entries: SitemapEntry[]): string {
  const hasAlternates = entries.some(e => e.alternates && e.alternates.length > 1);

  const urls = entries.map(e => {
    let xml = `  <url>\n    <loc>${e.url}</loc>`;
    if (e.lastmod) xml += `\n    <lastmod>${e.lastmod}</lastmod>`;
    xml += `\n    <priority>${e.priority.toFixed(1)}</priority>`;
    if (e.alternates && e.alternates.length > 1) {
      for (const alt of e.alternates) {
        xml += `\n    <xhtml:link rel="alternate" hreflang="${alt.locale}" href="${alt.url}" />`;
      }
      // x-default points to the default locale version
      const defUrl = e.alternates.find(a => a.locale === defaultLocale())?.url;
      if (defUrl) {
        xml += `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${defUrl}" />`;
      }
    }
    xml += `\n  </url>`;
    return xml;
  }).join('\n');

  const xmlns = hasAlternates
    ? ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"'
    : ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset${xmlns}>\n${urls}\n</urlset>`;
}
