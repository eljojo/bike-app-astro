import { createHash } from 'node:crypto';
import { z } from 'astro/zod';
import matter from 'gray-matter';

const organizerRefSchema = z.object({
  name: z.string(),
  website: z.string().optional(),
  instagram: z.string().optional(),
});

export const eventDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  year: z.string(),
  name: z.string(),
  start_date: z.string(),
  start_time: z.string().optional(),
  end_date: z.string().optional(),
  end_time: z.string().optional(),
  registration_url: z.string().optional(),
  distances: z.string().optional(),
  location: z.string().optional(),
  review_url: z.string().optional(),
  organizer: z.union([z.string(), organizerRefSchema]).optional(),
  poster_key: z.string().optional(),
  poster_content_type: z.string().optional(),
  body: z.string(),
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

/** Compute content hash for event conflict detection. Hashes the full .md content. */
export function computeEventContentHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

/** Compute event hash directly from git file snapshots used by the save pipeline. */
export function computeEventContentHashFromFiles(currentFiles: EventGitFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot compute event hash without primary file content');
  }
  return computeEventContentHash(currentFiles.primaryFile.content);
}

/**
 * Parse raw git content (frontmatter + body) into canonical EventDetail.
 */
export function eventDetailFromGit(
  eventId: string,
  frontmatter: Record<string, unknown>,
  body: string,
): EventDetail {
  const [year, slug] = eventId.split('/');
  return {
    id: eventId,
    slug,
    year,
    name: frontmatter.name as string,
    start_date: frontmatter.start_date as string,
    start_time: frontmatter.start_time as string | undefined,
    end_date: frontmatter.end_date as string | undefined,
    end_time: frontmatter.end_time as string | undefined,
    registration_url: frontmatter.registration_url as string | undefined,
    distances: frontmatter.distances as string | undefined,
    location: frontmatter.location as string | undefined,
    review_url: frontmatter.review_url as string | undefined,
    organizer: frontmatter.organizer as string | { name: string; website?: string; instagram?: string } | undefined,
    poster_key: frontmatter.poster_key as string | undefined,
    poster_content_type: frontmatter.poster_content_type as string | undefined,
    body: body.trim(),
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
  const detail = eventDetailFromGit(eventId, ghFrontmatter, ghBody);
  return eventDetailToCache(detail);
}

/** Deserialize and validate D1 cache blob into EventDetail. Throws on invalid data. */
export function eventDetailFromCache(blob: string): EventDetail {
  const parsed = JSON.parse(blob);
  return eventDetailSchema.parse(parsed);
}
