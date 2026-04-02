/**
 * General-purpose YML-slug-to-page resolver.
 *
 * Given any bikepaths.yml slug, returns the page that owns it and all its
 * metadata (name, URL, thumbnail, length, standalone). Use this instead of
 * assuming YML slug = page slug.
 *
 * A YML entry can end up on a page in three ways:
 * 1. A markdown file with matching slug (or `includes` listing it)
 * 2. A `grouped_from` parent that absorbed it
 * 3. Its own YML-only page (if not absorbed)
 *
 * The resolver checks all three via the page's ymlEntries array.
 */
import { paths } from '../paths';

/** Minimal page shape needed by the resolver — avoids importing from .server.ts. */
interface ResolvablePage {
  slug: string;
  name: string;
  memberOf?: string;
  length_km?: number;
  thumbnail_key?: string;
  standalone: boolean;
  translations: Record<string, { name?: string }>;
  ymlEntries: Array<{ slug: string }>;
}

export interface PageRef {
  slug: string;
  name: string;
  url: string;
  length_km?: number;
  thumbnail_key?: string;
  standalone: boolean;
  networkSlug?: string;
}

/** Build a Map from YML slug → owning page for O(1) lookups. */
export function buildYmlSlugIndex(pages: ResolvablePage[]): Map<string, ResolvablePage> {
  const index = new Map<string, ResolvablePage>();
  for (const page of pages) {
    for (const entry of page.ymlEntries) {
      index.set(entry.slug, page);
    }
    // Also index by page slug for direct lookups
    if (!index.has(page.slug)) {
      index.set(page.slug, page);
    }
  }
  return index;
}

/** Resolve a YML slug to its owning page and metadata. */
export function resolvePageForYmlSlug(
  ymlSlug: string,
  pages: ResolvablePage[],
  locale?: string,
): PageRef | undefined {
  const page = pages.find(p =>
    p.slug === ymlSlug || p.ymlEntries.some(e => e.slug === ymlSlug),
  );
  if (!page) return undefined;

  return {
    slug: page.slug,
    name: localizedName(page, locale),
    url: paths.bikePath(page.slug, page.memberOf, locale),
    length_km: page.length_km,
    thumbnail_key: page.thumbnail_key,
    standalone: page.standalone,
    networkSlug: page.memberOf,
  };
}

/** Indexed version for repeated lookups (O(1) per call after O(n) build). */
export function resolvePageForYmlSlugIndexed(
  ymlSlug: string,
  index: Map<string, ResolvablePage>,
  locale?: string,
): PageRef | undefined {
  const page = index.get(ymlSlug);
  if (!page) return undefined;

  return {
    slug: page.slug,
    name: localizedName(page, locale),
    url: paths.bikePath(page.slug, page.memberOf, locale),
    length_km: page.length_km,
    thumbnail_key: page.thumbnail_key,
    standalone: page.standalone,
    networkSlug: page.memberOf,
  };
}

function localizedName(page: ResolvablePage, locale?: string): string {
  if (locale && page.translations[locale]?.name) {
    return page.translations[locale].name!;
  }
  return page.name;
}
