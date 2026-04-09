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
  const suffix = [size, options.lang].join('-');
  const filename = options.variant
    ? `${slug}--${options.variant}-${suffix}`
    : `${slug}-${suffix}`;
  return `/api/map-image/${type}/${options.hash}/${filename}.png`;
}
