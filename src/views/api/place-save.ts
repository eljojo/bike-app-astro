// AGENTS.md: See src/views/api/AGENTS.md for save pipeline rules.
// Key: always merge frontmatter, return new contentHash, cache stores blob SHAs (not commit SHAs).
import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import { serializeMdFile } from '../../lib/content/file-serializers';
import { CITY } from '../../lib/config/config';
import { saveContent } from '../../lib/content/content-save';
import type { SaveHandlers, BuildResult, WithSlugValidation, WithExistenceCheck, WithAfterCommit } from '../../lib/content/content-save';
import type { FileChange } from '../../lib/git/git.adapter-github';
import { placeOps } from '../../lib/content/content-ops.server';
import { slugify } from '../../lib/slug';
import { buildSingleMediaKeyChanges, afterCommitMediaCleanup, mergeFrontmatter, buildSimpleCommitMessage, buildGitHubUrl, checkSlugExistence } from '../../lib/content/save-helpers.server';
import { extractFrontmatterField, parkOrphanedMedia } from '../../lib/media/media-parking.server';
import type { ParkedMediaEntry } from '../../lib/media/media-merge';
import { fetchSharedKeysData } from '../../lib/content/load-admin-content.server';

export const prerender = false;

const placeUpdateSchema = z.object({
  frontmatter: z.object({
    name: z.string(),
    name_fr: z.string().optional(),
    category: z.string(),
    lat: z.number(),
    lng: z.number(),
    status: z.string().optional(),
    vibe: z.string().optional(),
    good_for: z.array(z.string()).default([]),
    address: z.string().optional(),
    website: z.string().optional(),
    phone: z.string().optional(),
    google_maps_url: z.string().optional(),
    photo_key: z.string().optional(),
    organizer: z.string().optional(),
    social_links: z.array(z.object({
      platform: z.string(),
      url: z.string(),
    })).default([]),
  }),
  contentHash: z.string().optional(),
});

export interface PlaceUpdate {
  frontmatter: {
    name: string;
    name_fr?: string;
    category: string;
    lat: number;
    lng: number;
    status?: string;
    vibe?: string;
    good_for: string[];
    address?: string;
    website?: string;
    phone?: string;
    google_maps_url?: string;
    photo_key?: string;
    organizer?: string;
    social_links: Array<{ platform: string; url: string }>;
  };
  contentHash?: string;
}

interface PlaceBuildResult extends BuildResult {
  oldPhotoKey: string | undefined;
  newPhotoKey: string | undefined;
  placeSlug: string;
  mergedParked: ParkedMediaEntry[] | undefined;
}

/**
 * Create place save handlers. Returns a fresh instance per request
 * to safely encapsulate sharedKeysData from concurrent request contamination.
 */
export function createPlaceHandlers(sharedKeysData: Record<string, Array<{ type: string; slug: string }>> = {}): SaveHandlers<PlaceUpdate, PlaceBuildResult> & WithSlugValidation & WithExistenceCheck & WithAfterCommit<PlaceBuildResult> {
  return {
    parseRequest(body: unknown): PlaceUpdate {
      return placeUpdateSchema.parse(body);
    },

    resolveContentId(params, update): string {
      const id = params.id;
      if (id === 'new') {
        return slugify(update.frontmatter.name);
      }
      return id!;
    },

    validateSlug(placeId: string): string | null {
      if (!placeId || placeId.length < 2) return 'Place name is too short';
      return null;
    },

    getFilePaths: placeOps.getFilePaths,
    computeContentHash: placeOps.computeContentHash,
    buildFreshData: placeOps.buildFreshData,

    async checkExistence(git, placeId) {
      return checkSlugExistence(git, placeOps.getFilePaths(placeId).primary, 'Place', placeId);
    },

    async buildFileChanges(update, placeId, currentFiles, git) {
      const placePath = placeOps.getFilePaths(placeId).primary;
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
        contentType: 'place',
        contentId: placeId,
        sharedKeysData,
        git,
      });
      if (parked) {
        mergedParked = parked.mergedParked;
        files.push(parked.fileChange);
      }

      // Build editor fields, stripping empty optional values
      const fm: Record<string, unknown> = {};
      fm.name = update.frontmatter.name;
      if (update.frontmatter.name_fr) fm.name_fr = update.frontmatter.name_fr;
      fm.category = update.frontmatter.category;
      fm.lat = update.frontmatter.lat;
      fm.lng = update.frontmatter.lng;
      if (update.frontmatter.status && update.frontmatter.status !== 'published') {
        fm.status = update.frontmatter.status;
      }
      if (update.frontmatter.vibe) fm.vibe = update.frontmatter.vibe;
      if (update.frontmatter.good_for.length > 0) fm.good_for = update.frontmatter.good_for;
      if (update.frontmatter.address) fm.address = update.frontmatter.address;
      if (update.frontmatter.website) fm.website = update.frontmatter.website;
      if (update.frontmatter.phone) fm.phone = update.frontmatter.phone;
      if (update.frontmatter.google_maps_url) fm.google_maps_url = update.frontmatter.google_maps_url;
      if (update.frontmatter.photo_key) {
        fm.photo_key = update.frontmatter.photo_key;
      }
      if (update.frontmatter.organizer) fm.organizer = update.frontmatter.organizer;
      if (update.frontmatter.social_links.length > 0) fm.social_links = update.frontmatter.social_links;

      // Merge with existing frontmatter to preserve fields the editor doesn't manage
      const merged = mergeFrontmatter(isNew, currentFiles.primaryFile?.content ?? null, fm);

      // Strip default status — places default to published, no need to persist it
      if (merged.status === 'published') delete merged.status;

      files.push({ path: placePath, content: serializeMdFile(merged) });

      return { files, deletePaths: [], isNew, oldPhotoKey, newPhotoKey, placeSlug: placeId, mergedParked };
    },

    async afterCommit(result, database) {
      const { oldPhotoKey, newPhotoKey, placeSlug, mergedParked } = result;
      const changes = buildSingleMediaKeyChanges(oldPhotoKey, newPhotoKey, 'place', placeSlug);
      await afterCommitMediaCleanup({ database, sharedKeysData, mediaKeyChanges: changes, mergedParked });
    },

    buildCommitMessage(update, placeId, isNew): string {
      return buildSimpleCommitMessage(update.frontmatter.name || placeId, `${CITY}/places/${placeId}`, isNew);
    },

    buildGitHubUrl(placeId: string, baseBranch: string): string {
      return buildGitHubUrl(placeOps.getFilePaths(placeId).primary, baseBranch);
    },
  };
}

export async function POST({ params, request, locals }: APIContext) {
  const sharedKeysData = await fetchSharedKeysData(new URL(request.url));
  const handlers = createPlaceHandlers(sharedKeysData);
  if (params.id === 'new') {
    return saveContent(request, locals, params, 'places', handlers);
  }
  // For edits, omit checkExistence — only check when creating new places
  const { checkExistence: _checkExistence, ...editHandlers } = handlers;
  return saveContent(request, locals, params, 'places', editHandlers);
}
