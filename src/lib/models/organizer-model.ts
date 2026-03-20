import { z } from 'astro/zod';
import type { CollectionEntry } from 'astro:content';
import { baseMediaItemSchema } from './content-model';
import { socialLinkSchema } from '../../schemas';
import { paths } from '../paths';

export type OrganizerEntry = CollectionEntry<'organizers'>;

export const organizerDetailSchema = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string().optional(),
  tags: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  hidden: z.boolean().default(false),
  website: z.string().optional(),
  instagram: z.string().optional(),
  social_links: z.array(socialLinkSchema).default([]),
  photo_key: z.string().optional(),
  photo_content_type: z.string().optional(),
  photo_width: z.number().optional(),
  photo_height: z.number().optional(),
  media: z.array(baseMediaItemSchema).default([]),
  body: z.string().default(''),
  contentHash: z.string().optional(),
});

export type OrganizerDetail = z.infer<typeof organizerDetailSchema>;

/**
 * A community qualifies for a detail page if it's not explicitly hidden
 * and has at least one of:
 * - A markdown body (bio/description)
 * - A tagline
 * - Media attached
 * - The featured flag set to true
 */
export function hasDetailPage(org: OrganizerEntry): boolean {
  if (org.data.hidden) return false;
  return !!(
    org.body?.trim() ||
    org.data.tagline ||
    (org.data.media && org.data.media.length > 0) ||
    org.data.featured
  );
}

/**
 * Get the best link for an organizer — detail page if qualified, otherwise external.
 * Uses the `paths` module for localized URL construction (matches route/event pattern).
 */
export function organizerLink(org: OrganizerEntry, locale?: string): string {
  if (hasDetailPage(org)) {
    return paths.community(org.id, locale);
  }
  if (org.data.website) return org.data.website;
  if (org.data.instagram) return `https://instagram.com/${org.data.instagram}`;
  const primary = org.data.social_links?.[0];
  if (primary) return primary.url;
  return '#';
}

export function organizerInitials(name: string): string {
  return name.split(/\s+/).slice(0, 3).map(w => w[0]).join('').toUpperCase();
}

/** Serialize OrganizerDetail to JSON string for D1 cache. */
export function organizerDetailToCache(detail: OrganizerDetail): string {
  return JSON.stringify(detail);
}

/** Deserialize and validate D1 cache blob into OrganizerDetail. Throws on invalid data. */
export function organizerDetailFromCache(blob: string): OrganizerDetail {
  return organizerDetailSchema.parse(JSON.parse(blob));
}
