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
  const cdn = originFrom(process.env.R2_PUBLIC_URL || config.cdn_url, 'https://cdn.ottawabybike.ca');
  const videos = originFrom(config.videos_cdn_url, 'https://videos.ottawabybike.ca');
  const tiles = originFrom(config.tiles_url, 'https://tiles.ottawabybike.ca/cycle/{z}/{x}/{y}{r}.png');

  return { cdn, videos, tiles };
}

export function sharedCspDirectives(): string[] {
  const { cdn, videos, tiles } = cspOrigins();
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `img-src 'self' data: blob: ${cdn} ${videos} ${tiles}`,
    `media-src 'self' blob: ${videos} ${cdn}`,
    "font-src 'self' data:",
    "connect-src 'self' https://*.r2.cloudflarestorage.com",
    "manifest-src 'self'",
  ];
}

export function buildNonceCspHeader(nonce: string): string {
  return [
    ...sharedCspDirectives(),
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
  ].join('; ');
}

export function createCspNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
