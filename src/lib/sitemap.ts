import { getCityConfig } from './config/city-config';
import { paths, routeSlug } from './paths';
import { translatePath } from './i18n/path-translations';
import { supportedLocales, defaultLocale } from './i18n/locale-utils';

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

export function buildSitemapEntries({ routes, guides, events, bikePaths, communities }: {
  routes: { id: string; data: { status: string; updated_at: string; variants?: { name: string; gpx: string; [k: string]: unknown }[]; translations?: Record<string, { slug?: string; [k: string]: unknown }>; [k: string]: unknown } }[];
  guides: { id: string; data: { status: string; [k: string]: unknown } }[];
  events?: { id: string }[];
  bikePaths?: { slug: string; memberOf?: string; standalone: boolean }[];
  communities?: { slug: string }[];
}): SitemapEntry[] {
  const entries: SitemapEntry[] = [
    ...localizedEntry('/', 1.0),
    ...localizedEntry('/routes', 0.9),
    ...localizedEntry('/calendar', 1.0),
    ...localizedEntry('/communities', 0.7),
    ...localizedEntry('/map', 0.2),
    ...localizedEntry('/about', 0.6),
    ...localizedEntry('/videos', 0.5),
    ...localizedEntry('/guides', 0.8),
    ...localizedEntry('/bike-shops', 0.6),
  ];

  // LLM-readable site description (not localized)
  entries.push({ url: `${BASE}/llms.txt`, priority: 0.3 });
  entries.push({ url: `${BASE}/llms-full.txt`, priority: 0.2 });

  const published = routes.filter(r => r.data.status === 'published');
  for (const r of published) {
    entries.push(...localizedEntryPerLocale(l => paths.route(routeSlug(r, l)), 0.8, r.data.updated_at));
  }

  const pubGuides = guides.filter(g => g.data.status === 'published');
  for (const g of pubGuides) {
    entries.push(...localizedEntry(paths.guide(g.id), 0.7));
  }

  if (events) {
    for (const e of events) {
      entries.push(...localizedEntry(paths.event(e.id), 0.6));
    }
  }

  if (bikePaths && bikePaths.length > 0) {
    entries.push(...localizedEntry('/bike-paths', 0.7));
    for (const bp of bikePaths.filter(p => p.standalone)) {
      entries.push(...localizedEntry(paths.bikePath(bp.slug, bp.memberOf), 0.6));
    }
  }

  if (communities) {
    for (const c of communities) {
      entries.push(...localizedEntry(paths.community(c.slug), 0.5));
    }
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
