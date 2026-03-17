import { z } from 'astro/zod';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { computeHashFromParts } from './content-hash.server';
import { eventMediaItemSchema, eventDetailToCache } from './event-model';
import type { EventDetail, EventGitFiles } from './event-model';

/** Compute content hash for event conflict detection. Hashes primary content + optional media.yml. */
export function computeEventContentHash(content: string, mediaContent?: string): string {
  return computeHashFromParts(content, mediaContent);
}

/**
 * Find the effective primary file from git file snapshots.
 * Handles both directory-based events (index.md primary) and flat events
 * (flat .md in auxiliaries when index.md primary doesn't exist).
 */
export function resolveEffectivePrimary(currentFiles: EventGitFiles): { content: string; sha: string } | null {
  if (currentFiles.primaryFile) return currentFiles.primaryFile;
  // Check auxiliaries for either index.md or flat .md
  const auxFiles = currentFiles.auxiliaryFiles || {};
  for (const p of Object.keys(auxFiles)) {
    if ((p.endsWith('/index.md') || p.endsWith('.md')) && auxFiles[p]) {
      return auxFiles[p];
    }
  }
  return null;
}

/** Compute event hash directly from git file snapshots used by the save pipeline. */
export function computeEventContentHashFromFiles(currentFiles: EventGitFiles): string {
  const primary = resolveEffectivePrimary(currentFiles);
  if (!primary) {
    throw new Error('Cannot compute event hash without primary file content');
  }
  const auxFiles = currentFiles.auxiliaryFiles || {};
  const mediaPath = Object.keys(auxFiles).find(p => p.endsWith('media.yml'));
  const mediaContent = mediaPath ? auxFiles[mediaPath]?.content : undefined;
  return computeEventContentHash(primary.content, mediaContent ?? undefined);
}

/** Parse media.yml content into media items array. */
function parseMediaYaml(yml: string): z.infer<typeof eventMediaItemSchema>[] {
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
    return entry as z.infer<typeof eventMediaItemSchema>;
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
    previous_event: frontmatter.previous_event as string | undefined,
    edition: frontmatter.edition as string | undefined,
    event_url: frontmatter.event_url as string | undefined,
    map_url: frontmatter.map_url as string | undefined,
    body: body.trim(),
    media,
  };
}

/** Build fresh event cache JSON directly from git file snapshots used by the save pipeline. */
export function buildFreshEventData(eventId: string, currentFiles: EventGitFiles): string {
  const primary = resolveEffectivePrimary(currentFiles);
  if (!primary) {
    throw new Error('Cannot build event cache data without primary file content');
  }

  const { data: ghFrontmatter, content: ghBody } = matter(primary.content);
  const auxFiles = currentFiles.auxiliaryFiles || {};
  const mediaPath = Object.keys(auxFiles).find(p => p.endsWith('media.yml'));
  const mediaContent = mediaPath ? auxFiles[mediaPath]?.content : undefined;
  const detail = eventDetailFromGit(eventId, ghFrontmatter, ghBody, mediaContent);
  return eventDetailToCache(detail);
}
