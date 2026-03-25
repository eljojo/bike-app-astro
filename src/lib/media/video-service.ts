/**
 * Video service — Cloudflare R2 implementation.
 *
 * Generates video source URLs for HLS and H.264 formats.
 * Videos are stored in R2 under CDN_URL/{prefix}/{blobKey}/ with
 * transcoded outputs from AWS MediaConvert.
 *
 * Source order: HLS master manifest (Safari and Chrome pick natively,
 * adaptive between 480p and 1080p H.265 tiers), then H.264 MP4
 * (universal fallback for Firefox, Edge, and browsers without HLS).
 *
 * To swap providers: replace these functions with equivalents that
 * return video source arrays for your transcoding/storage service.
 */
import { getCityConfig, isBlogInstance } from '../config/city-config';
import { CITY, VIDEO_PREFIX } from '../config/config';

const VIDEOS_CDN = getCityConfig().videos_cdn_url;

interface VideoSource {
  src: string;
  type: string;
}

/** Extract the bare 8-char key, stripping any prefix. Idempotent. */
export function bareVideoKey(key: string): string {
  const idx = key.indexOf('/');
  return idx !== -1 ? key.slice(idx + 1) : key;
}

/** Resolve a key to its R2 path prefix and bare key. */
export function resolveVideoPath(key: string): { prefix: string; bareKey: string } {
  const slashIdx = key.indexOf('/');
  if (slashIdx !== -1) {
    return { prefix: key.slice(0, slashIdx), bareKey: key.slice(slashIdx + 1) };
  }
  const prefix = isBlogInstance() ? VIDEO_PREFIX : CITY;
  return { prefix, bareKey: key };
}

/**
 * Format a key for storage in media.yml.
 *
 * Presign returns the full prefixed key (e.g. "montreal/abcdef" or
 * "montreal-staging/abcdef"). This function decides whether to persist
 * the prefix or strip it:
 *
 * - Production wiki (prefix === CITY): strip to bare "abcdef"
 * - Staging wiki (prefix !== CITY): preserve "montreal-staging/abcdef"
 * - Blog: strip to bare "abcdef"
 * - Bare key (legacy data): pass through unchanged
 */
export function videoKeyForGit(key: string): string {
  const slashIdx = key.indexOf('/');
  if (slashIdx === -1) return key;

  const prefix = key.slice(0, slashIdx);
  const bareKey = key.slice(slashIdx + 1);

  if (isBlogInstance()) return bareKey;
  if (prefix === CITY) return bareKey;
  return key;
}

export function videoPlaybackSources(key: string): VideoSource[] {
  const { prefix, bareKey } = resolveVideoPath(key);
  const base = `${VIDEOS_CDN}/${prefix}/${bareKey}/${bareKey}`;
  return [
    { src: `${base}.m3u8`, type: 'application/vnd.apple.mpegurl' },
    { src: `${base}-h264.mp4`, type: 'video/mp4' },
  ];
}

export function videoFallbackUrl(key: string): string {
  const { prefix, bareKey } = resolveVideoPath(key);
  return `${VIDEOS_CDN}/${prefix}/${bareKey}/${bareKey}-h264.mp4`;
}

export { buildVideoPosterUrl } from './video-urls';

export function videoPosterUrl(key: string): string {
  const { prefix, bareKey } = resolveVideoPath(key);
  const posterPath = `${prefix}/${bareKey}/${bareKey}-poster.0000000.jpg`;
  return `${VIDEOS_CDN}/cdn-cgi/image/format=auto/${posterPath}`;
}

export function videoDisplaySize(width: number, height: number): { width: number; height: number } {
  const maxWidth = width > height ? 640 : 360;
  const scale = maxWidth / width;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
