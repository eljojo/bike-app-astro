/**
 * Image service — Cloudflare implementation.
 *
 * Generates image URLs using Cloudflare Image Transformations (cdn-cgi/image/).
 * Originals are stored in R2 and served via the CDN_URL.
 *
 * To swap providers: replace these functions with equivalents that generate
 * URLs for your image transformation service (e.g., imgproxy, Thumbor, Sharp).
 * The interface is: (blobKey, options?) => URL string.
 */
import { getCityConfig } from '../config/city-config';
import { videoPosterPath } from './video-urls';

const R2_PUBLIC_URL = import.meta.env.R2_PUBLIC_URL || getCityConfig().cdn_url;

export interface ImageOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'scale-down';
  format?: 'auto' | 'webp' | 'avif';
}

/**
 * Pure image URL builder — works in both server and client contexts.
 * Unlike imageUrl(), takes the CDN base as a parameter so Preact islands
 * can use it without access to server-side config.
 */
export function buildImageUrl(
  cdnBase: string,
  key: string,
  opts?: ImageOptions,
): string {
  const transforms: string[] = [];
  if (opts?.width) transforms.push(`width=${opts.width}`);
  if (opts?.height) transforms.push(`height=${opts.height}`);
  if (opts?.fit) transforms.push(`fit=${opts.fit}`);
  if (opts?.format) transforms.push(`format=${opts.format}`);

  if (transforms.length > 0) {
    return `${cdnBase}/cdn-cgi/image/${transforms.join('%2C')}/${key}`;
  }
  return `${cdnBase}/${key}`;
}

/**
 * Build a 2x srcset string for retina displays.
 * Returns e.g. "https://cdn/cdn-cgi/image/width=160,height=160,fit=cover/key 2x"
 */
export function buildImageSrcSet2x(
  cdnBase: string,
  key: string,
  opts?: ImageOptions,
): string {
  const retinaOpts: ImageOptions = { ...opts };
  if (retinaOpts.width) retinaOpts.width *= 2;
  if (retinaOpts.height) retinaOpts.height *= 2;
  return `${buildImageUrl(cdnBase, key, retinaOpts)} 2x`;
}

export function imageUrl(blobKey: string, options: ImageOptions = {}): string {
  const opts = { ...options };
  if (!opts.format && (opts.width || opts.height || opts.fit)) opts.format = 'auto';
  return buildImageUrl(R2_PUBLIC_URL, blobKey, opts);
}

export function imageSrcSet2x(blobKey: string, options: ImageOptions = {}): string {
  return buildImageSrcSet2x(R2_PUBLIC_URL, blobKey, options);
}

export function originalUrl(blobKey: string): string {
  return `${R2_PUBLIC_URL}/${blobKey}`;
}

export interface MediaThumbnailConfig {
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
}

/**
 * Build a thumbnail URL for any media item (photo or video).
 * Photos use the photos CDN with image transformations.
 * Videos use the videos CDN, transforming the poster frame.
 */
export function buildMediaThumbnailUrl(
  item: { key: string; type?: string },
  config: MediaThumbnailConfig,
  opts?: ImageOptions,
): string {
  if (item.type === 'video') {
    const base = config.videosCdnUrl || config.cdnUrl;
    return buildImageUrl(base, videoPosterPath(item.key, config.videoPrefix), opts);
  }
  return buildImageUrl(config.cdnUrl, item.key, opts);
}
