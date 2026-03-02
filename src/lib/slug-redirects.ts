import { translatePath } from './path-translations';

/**
 * Generate Cloudflare-compatible _redirects lines for a translated route slug.
 *
 * For each non-default locale that has a translated slug, we generate:
 * - A 200 rewrite so the translated-slug URL serves the default-slug page
 * - A 301 redirect so the default slug on the locale path goes to the translated slug
 *
 * Rewrite targets include trailing slashes so Cloudflare Pages serves the
 * index.html directly instead of issuing a 307 trailing-slash redirect.
 */
export function slugRedirectLines(
  slug: string,
  localeSlug: string,
  locale: string,
): string[] {
  if (localeSlug === slug) return [];

  // Both URLs use locale-translated path segments (e.g. "parcours" not "routes"
  // in French). The only difference is the slug portion — one uses the translated
  // slug, the other uses the default slug (which matches the built HTML filename).
  const localeRoute = translatePath(`/routes/${localeSlug}`, locale);
  const defaultRoute = translatePath(`/routes/${slug}`, locale);
  const localeMap = translatePath(`/routes/${localeSlug}/map`, locale);
  const defaultMap = translatePath(`/routes/${slug}/map`, locale);

  return [
    // 200 rewrite: locale slug URL silently serves the default-slug page
    `/${locale}${localeRoute}  /${locale}${defaultRoute}/  200`,
    `/${locale}${localeMap}/*  /${locale}${defaultMap}/:splat  200`,
    `/${locale}${localeMap}  /${locale}${defaultMap}/  200`,
    // 301 redirect: default slug on locale prefix → locale slug
    `/${locale}${defaultRoute}  /${locale}${localeRoute}  301`,
    `/${locale}${defaultMap}/*  /${locale}${localeMap}/:splat  301`,
    `/${locale}${defaultMap}  /${locale}${localeMap}  301`,
  ];
}
