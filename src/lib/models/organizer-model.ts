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
 * Extract an Instagram username from flexible input.
 * Handles: @eljojo, eljojo, https://instagram.com/eljojo, instagram.com/eljojo/
 */
export function parseInstagramUsername(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^https?:\/\/(www\.)?instagram\.com\//, '');
  cleaned = cleaned.replace(/\/+$/, '');
  cleaned = cleaned.replace(/^@/, '');
  return cleaned;
}

/**
 * Get the Instagram username for an organizer.
 * Checks the legacy `instagram` field first, falls back to instagram social link.
 */
export function organizerInstagram(data: { instagram?: string; social_links?: Array<{ platform: string; url: string }> }): string | undefined {
  if (data.instagram) return parseInstagramUsername(data.instagram);
  const link = data.social_links?.find(l => l.platform === 'instagram');
  if (link?.url) return parseInstagramUsername(link.url);
  return undefined;
}

/**
 * Get the website URL for an organizer.
 * Checks the legacy `website` field first, falls back to website social link.
 */
export function organizerWebsite(data: { website?: string; social_links?: Array<{ platform: string; url: string }> }): string | undefined {
  if (data.website) return data.website;
  const link = data.social_links?.find(l => l.platform === 'website');
  return link?.url || undefined;
}

/**
 * Normalize social links on save — expand bare usernames/handles to full URLs,
 * and migrate legacy instagram/website fields into social_links.
 */
export function normalizeSocialLinks(
  socialLinks: Array<{ platform: string; url: string }>,
  legacy?: { instagram?: string; website?: string },
): Array<{ platform: string; url: string }> {
  const result = socialLinks.map(link => {
    if (link.platform === 'instagram') {
      const username = parseInstagramUsername(link.url);
      return { platform: 'instagram', url: `https://instagram.com/${username}` };
    }
    return link;
  });

  if (legacy?.instagram && !result.some(l => l.platform === 'instagram')) {
    const username = parseInstagramUsername(legacy.instagram);
    result.push({ platform: 'instagram', url: `https://instagram.com/${username}` });
  }

  if (legacy?.website && !result.some(l => l.platform === 'website')) {
    result.push({ platform: 'website', url: legacy.website });
  }

  return result;
}

/**
 * Get the best link for an organizer — detail page if qualified, otherwise external.
 * Uses the `paths` module for localized URL construction (matches route/event pattern).
 */
export function organizerLink(org: OrganizerEntry, locale?: string): string {
  if (hasDetailPage(org)) {
    return paths.community(org.id, locale);
  }
  const website = organizerWebsite(org.data);
  if (website) return website;
  const ig = organizerInstagram(org.data);
  if (ig) return `https://instagram.com/${ig}`;
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
