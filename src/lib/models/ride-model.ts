import { createHash } from 'node:crypto';
import { z } from 'astro/zod';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { parseGpx } from '../gpx';
import type { GitFiles } from './content-model';

const mediaItemSchema = z.object({
  key: z.string(),
  caption: z.string().optional(),
  cover: z.boolean().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  type: z.string().optional(),
  score: z.number().optional(),
});

const variantSchema = z.object({
  name: z.string(),
  gpx: z.string(),
  distance_km: z.number().optional(),
  strava_url: z.string().optional(),
  rwgps_url: z.string().optional(),
});

export const rideDetailSchema = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string().default(''),
  tags: z.array(z.string()).default([]),
  status: z.string().default('published'),
  body: z.string().default(''),
  media: z.array(mediaItemSchema).default([]),
  variants: z.array(variantSchema).default([]),
  contentHash: z.string(),
  ride_date: z.string().default(''),
  country: z.string().optional(),
  tour_slug: z.string().optional(),
  highlight: z.boolean().optional(),
  strava_id: z.string().optional(),
  privacy_zone: z.boolean().optional(),
  elapsed_time_s: z.number().optional(),
  moving_time_s: z.number().optional(),
  average_speed_kmh: z.number().optional(),
});

export type RideDetail = z.infer<typeof rideDetailSchema>;
export type RideMediaItem = z.infer<typeof mediaItemSchema>;

export interface RideGitFiles extends GitFiles {
  primaryFile: { content: string; sha: string } | null;
  auxiliaryFiles?: Record<string, { content: string; sha: string } | null>;
}

/** Compute content hash for ride conflict detection. Canonical order: sidecar, gpx, media. */
export function computeRideContentHash(sidecarContent: string, gpxContent?: string, mediaContent?: string): string {
  const hash = createHash('md5').update(sidecarContent);
  if (gpxContent) hash.update(gpxContent);
  if (mediaContent) hash.update(mediaContent);
  return hash.digest('hex');
}

/** Compute ride hash directly from git file snapshots used by the save pipeline. */
export function computeRideContentHashFromFiles(currentFiles: RideGitFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot compute ride hash without primary file content');
  }
  const auxFiles = currentFiles.auxiliaryFiles || {};
  const gpxPath = Object.keys(auxFiles).find(p => p.endsWith('.gpx'));
  const gpxContent = gpxPath ? auxFiles[gpxPath]?.content : undefined;
  const mediaPath = Object.keys(auxFiles).find(p => p.endsWith('-media.yml'));
  const mediaContent = mediaPath ? auxFiles[mediaPath]?.content : undefined;
  return computeRideContentHash(currentFiles.primaryFile.content, gpxContent, mediaContent);
}

/** Parse media YAML content into media items, filtering to photos only. */
function parseMediaYaml(yml: string): RideMediaItem[] {
  if (!yml.trim()) return [];
  const parsed = yaml.load(yml);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((m: Record<string, unknown>) => m.type === 'photo')
    .map((m: Record<string, unknown>) => {
      const item: Record<string, unknown> = { key: m.key as string };
      if (m.caption != null) item.caption = m.caption;
      if (m.cover != null) item.cover = m.cover;
      if (m.width != null) item.width = m.width;
      if (m.height != null) item.height = m.height;
      if (m.lat != null) item.lat = m.lat;
      if (m.lng != null) item.lng = m.lng;
      return item as RideMediaItem;
    });
}

/**
 * Parse raw git content (sidecar frontmatter + body + GPX + media YAML) into canonical RideDetail.
 * GPX content is parsed for distance and timing metrics. If contentHash is not provided,
 * it is computed from the raw sidecar, GPX, and media content.
 */
export function rideDetailFromGit(
  slug: string,
  frontmatter: Record<string, unknown>,
  body: string,
  gpxContent?: string,
  mediaYml?: string,
  contentHash?: string,
): RideDetail {
  let distance_km = 0;
  let elapsed_time_s: number | undefined;
  let moving_time_s: number | undefined;
  let average_speed_kmh: number | undefined;
  let gpxFilename = '';

  if (gpxContent) {
    try {
      const track = parseGpx(gpxContent);
      distance_km = Math.round(track.distance_m / 100) / 10;
      elapsed_time_s = track.elapsed_time_s || undefined;
      moving_time_s = track.moving_time_s || undefined;
      average_speed_kmh = track.average_speed_kmh || undefined;
    } catch {
      // GPX parse failure — leave metrics at defaults
    }
  }

  // Extract GPX filename from frontmatter variants if available
  const fmVariants = frontmatter.variants as Array<{ gpx?: string }> | undefined;
  if (fmVariants?.[0]?.gpx) {
    gpxFilename = fmVariants[0].gpx;
  }

  const media = mediaYml ? parseMediaYaml(mediaYml) : [];

  // Use provided hash or compute from reconstructed sidecar content
  const hash = contentHash ?? computeRideContentHash(
    matter.stringify(body, frontmatter).trim(),
    gpxContent,
    mediaYml,
  );

  return {
    slug,
    name: (frontmatter.name as string) || slug,
    tagline: (frontmatter.tagline as string) || '',
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    status: (frontmatter.status as string) || 'published',
    body: body.trim(),
    media,
    variants: [{
      name: (frontmatter.name as string) || slug,
      gpx: gpxFilename,
      distance_km,
    }],
    contentHash: hash,
    ride_date: (frontmatter.ride_date as string) || '',
    country: frontmatter.country as string | undefined,
    tour_slug: frontmatter.tour_slug as string | undefined,
    highlight: typeof frontmatter.highlight === 'boolean' ? frontmatter.highlight : undefined,
    strava_id: frontmatter.strava_id as string | undefined,
    privacy_zone: typeof frontmatter.privacy_zone === 'boolean' ? frontmatter.privacy_zone : undefined,
    elapsed_time_s,
    moving_time_s,
    average_speed_kmh,
  };
}

/** Serialize RideDetail to JSON string for D1 cache. */
export function rideDetailToCache(detail: RideDetail): string {
  return JSON.stringify(detail);
}

/** Build fresh ride cache JSON directly from git file snapshots used by the save pipeline. */
export function buildFreshRideData(slug: string, currentFiles: RideGitFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot build ride cache data without primary file content');
  }

  const { data: fm, content: body } = matter(currentFiles.primaryFile.content);
  const auxFiles = currentFiles.auxiliaryFiles || {};

  const gpxPath = Object.keys(auxFiles).find(p => p.endsWith('.gpx'));
  const gpxContent = gpxPath ? auxFiles[gpxPath]?.content : undefined;
  const mediaPath = Object.keys(auxFiles).find(p => p.endsWith('-media.yml'));
  const mediaContent = mediaPath ? auxFiles[mediaPath]?.content : undefined;

  // Extract GPX filename from path into frontmatter variants
  if (gpxPath && !fm.variants) {
    const parts = gpxPath.split('/');
    fm.variants = [{ gpx: parts[parts.length - 1] }];
  }

  // Compute hash from raw file content (not reconstructed), matching save pipeline behavior
  const hash = computeRideContentHashFromFiles(currentFiles);
  const detail = rideDetailFromGit(slug, fm, body, gpxContent, mediaContent, hash);
  return rideDetailToCache(detail);
}

/** Deserialize and validate D1 cache blob into RideDetail. Throws on invalid data. */
export function rideDetailFromCache(blob: string): RideDetail {
  const parsed = JSON.parse(blob);
  return rideDetailSchema.parse(parsed);
}
