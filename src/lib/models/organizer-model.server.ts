import matter from 'gray-matter';
import { computeHashFromParts } from './content-hash.server';
import type { GitFiles } from './content-model';
import { organizerDetailSchema, type OrganizerDetail } from './organizer-model';

export function parseOrganizerFile(slug: string, content: string): OrganizerDetail {
  const { data, content: body } = matter(content);
  return organizerDetailSchema.parse({
    slug,
    name: data.name || slug,
    tagline: data.tagline,
    tags: data.tags || [],
    featured: data.featured || false,
    website: data.website,
    instagram: data.instagram,
    social_links: data.social_links || [],
    photo_key: data.photo_key,
    photo_content_type: data.photo_content_type,
    photo_width: data.photo_width,
    photo_height: data.photo_height,
    media: data.media || [],
    body: body.trim(),
  });
}

export function computeOrganizerContentHash(content: string): string {
  return computeHashFromParts(content);
}

export function computeOrganizerContentHashFromFiles(currentFiles: GitFiles): string {
  if (!currentFiles.primaryFile) return '';
  return computeOrganizerContentHash(currentFiles.primaryFile.content);
}

export function buildFreshOrganizerData(slug: string, currentFiles: GitFiles): string {
  if (!currentFiles.primaryFile) return JSON.stringify({});
  return JSON.stringify(parseOrganizerFile(slug, currentFiles.primaryFile.content));
}
