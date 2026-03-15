/**
 * Video service — Cloudflare R2 implementation.
 *
 * Generates video source URLs for AV1 and H.264 formats.
 * Videos are stored in R2 under CDN_URL/videos/{blobKey}/ with
 * transcoded outputs from AWS MediaConvert.
 *
 * To swap providers: replace these functions with equivalents that
 * return video source arrays for your transcoding/storage service.
 */
import { getCityConfig } from '../config/city-config';
import { CITY } from '../config/config';

const VIDEOS_CDN = getCityConfig().videos_cdn_url;

interface VideoSource {
  src: string;
  type: string;
}

export function videoPlaybackSources(blobKey: string): VideoSource[] {
  const base = `${VIDEOS_CDN}/${CITY}/${blobKey}/${blobKey}`;
  return [
    { src: `${base}-av1.mp4`, type: 'video/mp4; codecs=av01.0.05M.08' },
    { src: `${base}-h264.mp4`, type: 'video/mp4; codecs=avc1' },
  ];
}

export function videoFallbackUrl(blobKey: string): string {
  return `${VIDEOS_CDN}/${CITY}/${blobKey}/${blobKey}-h264.mp4`;
}

export function videoPosterUrl(videoKey: string): string {
  return `${VIDEOS_CDN}/${CITY}/${videoKey}/${videoKey}-poster.0000000.jpg`;
}

export function videoDisplaySize(width: number, height: number): { width: number; height: number } {
  const maxWidth = width > height ? 640 : 360;
  const scale = maxWidth / width;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
