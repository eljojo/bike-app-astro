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

  const routeBase = translatePath(`/routes/${localeSlug}`, locale);
  const routeBaseEn = translatePath(`/routes/${slug}`, locale);
  const mapBase = translatePath(`/routes/${localeSlug}/map`, locale);
  const mapBaseEn = translatePath(`/routes/${slug}/map`, locale);

  return [
    // Rewrite: translated slug URL serves default-slug page (200 = invisible proxy)
    `/${locale}${routeBase}  /${locale}${routeBaseEn}/  200`,
    `/${locale}${mapBase}  /${locale}${mapBaseEn}/  200`,
    // Redirect: default slug on locale path → translated slug (301 = permanent)
    `/${locale}${routeBaseEn}  /${locale}${routeBase}  301`,
    `/${locale}${mapBaseEn}  /${locale}${mapBase}  301`,
  ];
}
