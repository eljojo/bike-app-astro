import { getCityConfig } from './city-config';

function originFrom(raw: string | undefined, fallback: string): string {
  try {
    return new URL(raw || fallback).origin;
  } catch {
    return new URL(fallback).origin;
  }
}

export function cspOrigins() {
  const config = getCityConfig();
  const cdn = originFrom(process.env.R2_PUBLIC_URL || config.cdn_url, config.cdn_url);
  const videos = originFrom(config.videos_cdn_url, config.videos_cdn_url);

  return { cdn, videos };
}

interface CspOptions {
  /** Exact R2 origin for image presigned uploads, e.g. https://acctid.r2.cloudflarestorage.com */
  r2Origin?: string;
  /** Exact S3 origin for video presigned uploads, e.g. https://bucket.s3.us-east-1.amazonaws.com */
  s3Origin?: string;
}

export function sharedCspDirectives(options?: CspOptions): string[] {
  const { cdn, videos } = cspOrigins();
  const connectSources = ["'self'", 'https://nominatim.openstreetmap.org'];
  if (options?.r2Origin) connectSources.push(options.r2Origin);
  if (options?.s3Origin) connectSources.push(options.s3Origin);
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `img-src 'self' data: blob: ${cdn} ${videos} https://www.gravatar.com`,
    `media-src 'self' blob: ${videos} ${cdn}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
}

export function buildNonceCspHeader(nonce: string, options?: CspOptions): string {
  return [
    ...sharedCspDirectives(options),
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
  ].join('; ');
}

export function createCspNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
