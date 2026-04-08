/**
 * Build a map image proxy URL.
 *
 * URL format: /api/map-image/{type}/{hash}/{slug}-{variant?}-{size}-{lang}.png
 */
export function mapImageUrl(
  type: string,
  slug: string,
  size: string,
  options: { hash: string; variant?: string; lang: string },
): string {
  const parts = [slug];
  if (options.variant) parts.push(options.variant);
  parts.push(size);
  parts.push(options.lang);
  return `/api/map-image/${type}/${options.hash}/${parts.join('-')}.png`;
}
