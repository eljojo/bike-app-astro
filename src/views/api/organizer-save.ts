// AGENTS.md: See src/views/api/AGENTS.md for save pipeline rules.
// Key: always merge frontmatter, return new contentHash, cache stores blob SHAs (not commit SHAs).
import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import { serializeMdFile } from '../../lib/content/file-serializers';
import { CITY } from '../../lib/config/config';
import { saveContent } from '../../lib/content/content-save';
import type { SaveHandlers, BuildResult, WithSlugValidation, WithExistenceCheck, WithAfterCommit } from '../../lib/content/content-save';
import type { FileChange } from '../../lib/git/git.adapter-github';
import { organizerOps, placeOps } from '../../lib/content/content-ops.server';
import { normalizeSocialLinks } from '../../lib/models/organizer-model';
import { upsertContentCache } from '../../lib/content/cache';
import { computeBlobSha } from '../../lib/git/git.adapter-github';
import { slugify } from '../../lib/slug';
import { buildSingleMediaKeyChanges, afterCommitMediaCleanup, mergeFrontmatter, buildSimpleCommitMessage, buildGitHubUrl, checkSlugExistence } from '../../lib/content/save-helpers.server';
import { extractFrontmatterField, parkOrphanedMedia } from '../../lib/media/media-parking.server';
import type { ParkedMediaEntry } from '../../lib/media/media-merge';
import { fetchSharedKeysData } from '../../lib/content/load-admin-content.server';

export const prerender = false;

const socialLinkSchema = z.object({
  platform: z.string(),
  url: z.string(),
});

const placeDataSchema = z.object({
  name: z.string(),
  category: z.string(),
  lat: z.number(),
  lng: z.number(),
  address: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
});

const organizerUpdateSchema = z.object({
  frontmatter: z.object({
    name: z.string(),
    tagline: z.string().optional(),
    tags: z.array(z.string()).optional(),
    featured: z.boolean().optional(),
    hidden: z.boolean().optional(),
    website: z.string().optional(),
    instagram: z.string().optional(),
    social_links: z.array(socialLinkSchema).optional(),
    photo_key: z.string().optional(),
    photo_width: z.number().optional(),
    photo_height: z.number().optional(),
    photo_content_type: z.string().optional(),
    media: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  body: z.string().optional(),
  contentHash: z.string().optional(),
  place: placeDataSchema.optional(),
});

export interface OrganizerUpdate {
  frontmatter: {
    name: string;
    tagline?: string;
    tags?: string[];
    featured?: boolean;
    hidden?: boolean;
    website?: string;
    instagram?: string;
    social_links?: Array<{ platform: string; url: string }>;
    photo_key?: string;
    photo_width?: number;
    photo_height?: number;
    photo_content_type?: string;
    media?: Array<Record<string, unknown>>;
  };
  body?: string;
  contentHash?: string;
  place?: {
    name: string;
    category: string;
    lat: number;
    lng: number;
    address?: string;
    phone?: string;
    website?: string;
  };
}

interface OrganizerBuildResult extends BuildResult {
  oldPhotoKey: string | undefined;
  newPhotoKey: string | undefined;
  organizerSlug: string;
  mergedParked: ParkedMediaEntry[] | undefined;
  linkedPlace?: { slug: string; fileContent: string };
}

/**
 * Create organizer save handlers. Returns a fresh instance per request
 * to safely encapsulate sharedKeysData from concurrent request contamination.
 */
export function createOrganizerHandlers(sharedKeysData: Record<string, Array<{ type: string; slug: string }>> = {}): SaveHandlers<OrganizerUpdate, OrganizerBuildResult> & WithSlugValidation & WithExistenceCheck & WithAfterCommit<OrganizerBuildResult> {
  return {
    parseRequest(body: unknown): OrganizerUpdate {
      return organizerUpdateSchema.parse(body);
    },

    resolveContentId(params, update): string {
      const id = params.slug;
      if (id === 'new') {
        return slugify(update.frontmatter.name);
      }
      return id!;
    },

    validateSlug(slug: string): string | null {
      if (!slug || slug.length < 2) return 'Organizer name is too short';
      return null;
    },

    getFilePaths: organizerOps.getFilePaths,
    computeContentHash: organizerOps.computeContentHash,
    buildFreshData: organizerOps.buildFreshData,

    async checkExistence(git, slug) {
      return checkSlugExistence(git, organizerOps.getFilePaths(slug).primary, 'Organizer', slug);
    },

    async buildFileChanges(update, slug, currentFiles, git) {
      const filePath = organizerOps.getFilePaths(slug).primary;
      const isNew = !currentFiles.primaryFile;
      const files: FileChange[] = [];

      // Detect photo_key change and park orphaned photo
      const oldPhotoKey = currentFiles.primaryFile
        ? extractFrontmatterField(currentFiles.primaryFile.content, 'photo_key')
        : undefined;
      const newPhotoKey = update.frontmatter.photo_key;

      let mergedParked: ParkedMediaEntry[] | undefined;
      const parked = await parkOrphanedMedia({
        oldKey: oldPhotoKey,
        newKey: newPhotoKey,
        contentType: 'organizer',
        contentId: slug,
        sharedKeysData,
        git,
      });
      if (parked) {
        mergedParked = parked.mergedParked;
        files.push(parked.fileChange);
      }

      // Build frontmatter update, stripping empty optional fields
      const fm: Record<string, unknown> = {};
      fm.name = update.frontmatter.name;
      if (update.frontmatter.tagline) fm.tagline = update.frontmatter.tagline;
      if (update.frontmatter.tags?.length) fm.tags = update.frontmatter.tags;
      if (update.frontmatter.featured !== undefined) fm.featured = update.frontmatter.featured;
      if (update.frontmatter.hidden !== undefined) fm.hidden = update.frontmatter.hidden;
      // Normalize social links: expand bare handles to full URLs,
      // migrate legacy instagram/website fields into social_links
      const existingContent = currentFiles.primaryFile?.content ?? '';
      const legacyInstagram = extractFrontmatterField(existingContent, 'instagram');
      const legacyWebsite = extractFrontmatterField(existingContent, 'website');
      const normalized = normalizeSocialLinks(
        update.frontmatter.social_links ?? [],
        { instagram: legacyInstagram, website: legacyWebsite },
      );
      if (normalized.length) fm.social_links = normalized;
      if (update.frontmatter.photo_key) {
        fm.photo_key = update.frontmatter.photo_key;
        if (update.frontmatter.photo_width) fm.photo_width = update.frontmatter.photo_width;
        if (update.frontmatter.photo_height) fm.photo_height = update.frontmatter.photo_height;
        if (update.frontmatter.photo_content_type) fm.photo_content_type = update.frontmatter.photo_content_type;
      }
      if (update.frontmatter.media?.length) fm.media = update.frontmatter.media;

      // Merge with existing frontmatter to preserve fields the editor doesn't manage
      const merged = mergeFrontmatter(
        isNew,
        currentFiles.primaryFile?.content ?? null,
        fm,
      );

      files.push({ path: filePath, content: serializeMdFile(merged, update.body) });

      // If a place was submitted alongside the organizer (e.g. from the wizard),
      // build its markdown file and include it in the same commit.
      let linkedPlace: OrganizerBuildResult['linkedPlace'];
      if (update.place) {
        const placeSlug = slugify(update.place.name);
        const placeFm: Record<string, unknown> = {
          name: update.place.name,
          category: update.place.category,
          lat: update.place.lat,
          lng: update.place.lng,
          organizer: slug,
        };
        if (update.place.address) placeFm.address = update.place.address;
        if (update.place.phone) placeFm.phone = update.place.phone;
        if (update.place.website) placeFm.website = update.place.website;
        const placePath = placeOps.getFilePaths(placeSlug).primary;
        const placeFileContent = serializeMdFile(placeFm);
        files.push({ path: placePath, content: placeFileContent });
        linkedPlace = { slug: placeSlug, fileContent: placeFileContent };
      }

      return { files, deletePaths: [], isNew, oldPhotoKey, newPhotoKey, organizerSlug: slug, mergedParked, linkedPlace };
    },

    async afterCommit(result, database) {
      const { oldPhotoKey, newPhotoKey, organizerSlug, mergedParked, linkedPlace } = result;
      const changes = buildSingleMediaKeyChanges(oldPhotoKey, newPhotoKey, 'organizer', organizerSlug);
      await afterCommitMediaCleanup({ database, sharedKeysData, mediaKeyChanges: changes, mergedParked });

      // Write linked place to D1 cache if one was created alongside the organizer.
      if (linkedPlace) {
        try {
          const placeFiles = { primaryFile: { content: linkedPlace.fileContent, sha: computeBlobSha(linkedPlace.fileContent) }, auxiliaryFiles: {} };
          const placeCacheData = placeOps.buildFreshData(linkedPlace.slug, placeFiles);
          await upsertContentCache(database, {
            contentType: 'places',
            contentSlug: linkedPlace.slug,
            data: placeCacheData,
            githubSha: placeFiles.primaryFile.sha,
          });
        } catch (err) {
          console.error('Failed to cache linked place after organizer commit:', err);
        }
      }
    },

    buildCommitMessage(update, slug, isNew): string {
      return buildSimpleCommitMessage(update.frontmatter.name || slug, `${CITY}/organizers/${slug}`, isNew);
    },

    buildGitHubUrl(slug: string, baseBranch: string): string {
      return buildGitHubUrl(organizerOps.getFilePaths(slug).primary, baseBranch);
    },
  };
}

export async function POST({ params, request, locals }: APIContext) {
  const sharedKeysData = await fetchSharedKeysData(new URL(request.url));
  const handlers = createOrganizerHandlers(sharedKeysData);
  // Omit checkExistence for all organizer saves — wizard retries and edits both
  // need idempotent behavior. buildFileChanges handles new vs existing correctly.
  const { checkExistence: _checkExistence, ...idempotentHandlers } = handlers;
  return saveContent(request, locals, params, 'organizers', idempotentHandlers);
}
