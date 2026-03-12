import { createHash } from 'node:crypto';
import { z } from 'astro/zod';
import yaml from 'js-yaml';
import matter from 'gray-matter';

const organizerRefSchema = z.object({
  name: z.string(),
  website: z.string().optional(),
  instagram: z.string().optional(),
});

const waypointDetailSchema = z.object({
  place: z.string(),
  type: z.enum(['checkpoint', 'danger', 'poi']),
  label: z.string(),
  distance_km: z.number().optional(),
  opening: z.string().optional(),
  closing: z.string().optional(),
  route: z.string().optional(),
});

const registrationDetailSchema = z.object({
  url: z.string().optional(),
  slots: z.number().optional(),
  price: z.string().optional(),
  deadline: z.string().optional(),
  departure_groups: z.array(z.string()).optional(),
});

const resultDetailSchema = z.object({
  brevet_no: z.number().optional(),
  last_name: z.string(),
  first_name: z.string().optional(),
  time: z.string().optional(),
  homologation: z.string().optional(),
  status: z.enum(['DNS', 'DNF', 'DQ']).optional(),
});

const mediaItemSchema = z.object({
  key: z.string(),
  caption: z.string().optional(),
  cover: z.boolean().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  type: z.string().optional(),
});

export const eventDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  year: z.string(),
  name: z.string(),
  start_date: z.string(),
  event_date: z.string().optional(),
  start_time: z.string().optional(),
  end_date: z.string().optional(),
  end_time: z.string().optional(),
  time_limit_hours: z.number().optional(),
  status: z.string().optional(),
  routes: z.array(z.string()).default([]),
  registration: registrationDetailSchema.optional(),
  registration_url: z.string().optional(),
  waypoints: z.array(waypointDetailSchema).default([]),
  results: z.array(resultDetailSchema).default([]),
  gpx_include_waypoints: z.boolean().optional(),
  distances: z.string().optional(),
  location: z.string().optional(),
  review_url: z.string().optional(),
  organizer: z.union([z.string(), organizerRefSchema]).optional(),
  poster_key: z.string().optional(),
  poster_content_type: z.string().optional(),
  body: z.string(),
  media: z.array(mediaItemSchema).default([]),
});

export type EventDetail = z.infer<typeof eventDetailSchema>;

interface GitFileSnapshot {
  content: string;
  sha: string;
}

export interface EventGitFiles {
  primaryFile: GitFileSnapshot | null;
  auxiliaryFiles?: Record<string, GitFileSnapshot | null>;
}

/** Compute content hash for event conflict detection. Hashes primary content + optional media.yml. */
export function computeEventContentHash(content: string, mediaContent?: string): string {
  const hash = createHash('md5').update(content);
  if (mediaContent) hash.update(mediaContent);
  return hash.digest('hex');
}

/** Compute event hash directly from git file snapshots used by the save pipeline. */
export function computeEventContentHashFromFiles(currentFiles: EventGitFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot compute event hash without primary file content');
  }
  const mediaContent = currentFiles.auxiliaryFiles?.['media.yml']?.content;
  return computeEventContentHash(currentFiles.primaryFile.content, mediaContent ?? undefined);
}

/** Parse media.yml content into media items array. */
function parseMediaYaml(yml: string): z.infer<typeof mediaItemSchema>[] {
  if (!yml.trim()) return [];
  const parsed = yaml.load(yml);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item: Record<string, unknown>) => {
    const entry: Record<string, unknown> = { key: item.key as string };
    if (item.caption != null) entry.caption = item.caption;
    if (item.cover != null) entry.cover = item.cover;
    if (item.width != null) entry.width = item.width;
    if (item.height != null) entry.height = item.height;
    if (item.lat != null) entry.lat = item.lat;
    if (item.lng != null) entry.lng = item.lng;
    if (item.type != null) entry.type = item.type;
    return entry as z.infer<typeof mediaItemSchema>;
  });
}

/**
 * Parse raw git content (frontmatter + body) into canonical EventDetail.
 * Optionally accepts media.yml content for directory-based events.
 */
export function eventDetailFromGit(
  eventId: string,
  frontmatter: Record<string, unknown>,
  body: string,
  mediaYml?: string,
): EventDetail {
  const [year, slug] = eventId.split('/');
  const media = mediaYml ? parseMediaYaml(mediaYml) : [];

  return {
    id: eventId,
    slug,
    year,
    name: frontmatter.name as string,
    start_date: frontmatter.start_date as string,
    event_date: frontmatter.event_date as string | undefined,
    start_time: frontmatter.start_time as string | undefined,
    end_date: frontmatter.end_date as string | undefined,
    end_time: frontmatter.end_time as string | undefined,
    time_limit_hours: frontmatter.time_limit_hours as number | undefined,
    status: frontmatter.status as string | undefined,
    routes: (frontmatter.routes as string[]) ?? [],
    registration: frontmatter.registration as EventDetail['registration'],
    registration_url: frontmatter.registration_url as string | undefined,
    waypoints: (frontmatter.waypoints as EventDetail['waypoints']) ?? [],
    results: (frontmatter.results as EventDetail['results']) ?? [],
    gpx_include_waypoints: frontmatter.gpx_include_waypoints as boolean | undefined,
    distances: frontmatter.distances as string | undefined,
    location: frontmatter.location as string | undefined,
    review_url: frontmatter.review_url as string | undefined,
    organizer: frontmatter.organizer as string | { name: string; website?: string; instagram?: string } | undefined,
    poster_key: frontmatter.poster_key as string | undefined,
    poster_content_type: frontmatter.poster_content_type as string | undefined,
    body: body.trim(),
    media,
  };
}

/** Serialize EventDetail to JSON string for D1 cache. */
export function eventDetailToCache(detail: EventDetail): string {
  return JSON.stringify(detail);
}

/** Build fresh event cache JSON directly from git file snapshots used by the save pipeline. */
export function buildFreshEventData(eventId: string, currentFiles: EventGitFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot build event cache data without primary file content');
  }

  const { data: ghFrontmatter, content: ghBody } = matter(currentFiles.primaryFile.content);
  const mediaContent = currentFiles.auxiliaryFiles?.['media.yml']?.content;
  const detail = eventDetailFromGit(eventId, ghFrontmatter, ghBody, mediaContent);
  return eventDetailToCache(detail);
}

/** Deserialize and validate D1 cache blob into EventDetail. Throws on invalid data. */
export function eventDetailFromCache(blob: string): EventDetail {
  const parsed = JSON.parse(blob);
  return eventDetailSchema.parse(parsed);
}
