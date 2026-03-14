// AGENTS.md: See src/views/api/AGENTS.md for save pipeline rules.
// Key: always merge frontmatter, return new contentHash, cache stores blob SHAs (not commit SHAs).
import type { APIContext } from 'astro';
import { z } from 'astro/zod';
import { serializeMdFile } from '../../lib/file-serializers';
import { CITY } from '../../lib/config';
import { env } from '../../lib/env';
import { jsonError } from '../../lib/api-response';
import { saveContent } from '../../lib/content-save';
import type { SaveHandlers, BuildResult, WithSlugValidation, WithExistenceCheck, WithAfterCommit } from '../../lib/content-save';
import type { FileChange } from '../../lib/git-service';
import { placeOps } from '../../lib/content-ops';
import { slugify } from '../../lib/slug';
import { buildPhotoKeyChanges, buildCommitTrailer } from '../../lib/save-helpers';
import { extractFrontmatterField, parkOrphanedPhoto, updatePhotoRegistryCache } from '../../lib/photo-parking';
import type { ParkedPhotoEntry } from '../../lib/media-merge';
import sharedKeysData from 'virtual:bike-app/photo-shared-keys';

export const prerender = false;

const placeUpdateSchema = z.object({
  frontmatter: z.object({
    name: z.string(),
    name_fr: z.string().optional(),
    category: z.string(),
    lat: z.number(),
    lng: z.number(),
    status: z.string().optional(),
    address: z.string().optional(),
    website: z.string().optional(),
    phone: z.string().optional(),
    google_maps_url: z.string().optional(),
    photo_key: z.string().optional(),
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
    address?: string;
    website?: string;
    phone?: string;
    google_maps_url?: string;
    photo_key?: string;
  };
  contentHash?: string;
}

interface PlaceBuildResult extends BuildResult {
  oldPhotoKey: string | undefined;
  newPhotoKey: string | undefined;
  placeSlug: string;
  mergedParked: ParkedPhotoEntry[] | undefined;
}

export const placeHandlers: SaveHandlers<PlaceUpdate, PlaceBuildResult> & WithSlugValidation & WithExistenceCheck & WithAfterCommit<PlaceBuildResult> = {
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
    const placePath = placeOps.getFilePaths(placeId).primary;
    const existing = await git.readFile(placePath);
    if (existing) {
      return jsonError(`Place ${placeId} already exists`, 409);
    }
    return null;
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

    let mergedParked: ParkedPhotoEntry[] | undefined;
    const parked = await parkOrphanedPhoto({
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

    // Build frontmatter, stripping empty optional fields
    const fm: Record<string, unknown> = {};
    fm.name = update.frontmatter.name;
    if (update.frontmatter.name_fr) fm.name_fr = update.frontmatter.name_fr;
    fm.category = update.frontmatter.category;
    fm.lat = update.frontmatter.lat;
    fm.lng = update.frontmatter.lng;
    if (update.frontmatter.status && update.frontmatter.status !== 'published') {
      fm.status = update.frontmatter.status;
    }
    if (update.frontmatter.address) fm.address = update.frontmatter.address;
    if (update.frontmatter.website) fm.website = update.frontmatter.website;
    if (update.frontmatter.phone) fm.phone = update.frontmatter.phone;
    if (update.frontmatter.google_maps_url) fm.google_maps_url = update.frontmatter.google_maps_url;
    if (update.frontmatter.photo_key) {
      fm.photo_key = update.frontmatter.photo_key;
    }

    files.push({ path: placePath, content: serializeMdFile(fm) });

    return { files, deletePaths: [], isNew, oldPhotoKey, newPhotoKey, placeSlug: placeId, mergedParked };
  },

  async afterCommit(result, database) {
    const { oldPhotoKey, newPhotoKey, placeSlug, mergedParked } = result;
    const changes = buildPhotoKeyChanges(oldPhotoKey, newPhotoKey, 'place', placeSlug);
    await updatePhotoRegistryCache({ database, sharedKeysData, keyChanges: changes, mergedParked });
  },

  buildCommitMessage(update, placeId, isNew): string {
    const resourcePath = `${CITY}/places/${placeId}`;
    const title = update.frontmatter.name || placeId;
    const trailer = buildCommitTrailer(resourcePath);
    return isNew ? `Create ${title}${trailer}` : `Update ${title}${trailer}`;
  },

  buildGitHubUrl(placeId: string, baseBranch: string): string {
    return `https://github.com/${env.GIT_OWNER}/${env.GIT_DATA_REPO}/blob/${baseBranch}/${placeOps.getFilePaths(placeId).primary}`;
  },
};

export async function POST({ params, request, locals }: APIContext) {
  if (params.id === 'new') {
    return saveContent(request, locals, params, 'places', placeHandlers);
  }
  // For edits, omit checkExistence — only check when creating new places
  const { checkExistence, ...editHandlers } = placeHandlers;
  return saveContent(request, locals, params, 'places', editHandlers);
}
