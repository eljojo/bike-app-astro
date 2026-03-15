/**
 * Video service — Cloudflare R2 implementation.
 *
 * Generates video source URLs for HLS, H.265, and H.264 formats.
 * Videos are stored in R2 under CDN_URL/{prefix}/{blobKey}/ with
 * transcoded outputs from AWS MediaConvert.
 *
 * Source order: HLS master manifest (Safari picks natively, adaptive
 * between 480p thumb and 1080p H.265 big), then H.265 MP4 (modern
 * browsers), then H.264 MP4 (universal fallback). Browsers use the
 * first source they can play.
 *
 * To swap providers: replace these functions with equivalents that
 * return video source arrays for your transcoding/storage service.
 */
import { getCityConfig } from '../config/city-config';
import { VIDEO_PREFIX } from '../config/config';

const VIDEOS_CDN = getCityConfig().videos_cdn_url;

interface VideoSource {
  src: string;
  type: string;
}

export function videoPlaybackSources(blobKey: string): VideoSource[] {
  const base = `${VIDEOS_CDN}/${VIDEO_PREFIX}/${blobKey}/${blobKey}`;
  return [
    { src: `${base}.m3u8`, type: 'application/vnd.apple.mpegurl' },
    { src: `${base}-h265.mp4`, type: 'video/mp4; codecs="hvc1"' },
    { src: `${base}-h264.mp4`, type: 'video/mp4' },
  ];
}

export function videoFallbackUrl(blobKey: string): string {
  return `${VIDEOS_CDN}/${VIDEO_PREFIX}/${blobKey}/${blobKey}-h264.mp4`;
}

export function videoPosterUrl(videoKey: string): string {
  return `${VIDEOS_CDN}/${VIDEO_PREFIX}/${videoKey}/${videoKey}-poster.0000000.jpg`;
}

export function videoDisplaySize(width: number, height: number): { width: number; height: number } {
  const maxWidth = width > height ? 640 : 360;
  const scale = maxWidth / width;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
