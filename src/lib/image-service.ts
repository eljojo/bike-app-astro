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
import { getCityConfig } from './config/city-config';

const R2_PUBLIC_URL = import.meta.env.R2_PUBLIC_URL || getCityConfig().cdn_url;

export interface ImageOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'scale-down';
  format?: 'auto' | 'webp' | 'avif';
}

export function imageUrl(blobKey: string, options: ImageOptions = {}): string {
  const transforms: string[] = [];
  if (options.width) transforms.push(`width=${options.width}`);
  if (options.height) transforms.push(`height=${options.height}`);
  if (options.fit) transforms.push(`fit=${options.fit}`);
  if (options.format) transforms.push(`format=${options.format}`);
  else if (transforms.length > 0) transforms.push('format=auto');

  if (transforms.length > 0) {
    return `${R2_PUBLIC_URL}/cdn-cgi/image/${transforms.join(',')}/${blobKey}`;
  }
  return `${R2_PUBLIC_URL}/${blobKey}`;
}

export function originalUrl(blobKey: string): string {
  return `${R2_PUBLIC_URL}/${blobKey}`;
}
