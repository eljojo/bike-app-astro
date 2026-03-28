// AGENTS.md: See src/views/api/AGENTS.md for save pipeline rules.
// Key: always merge frontmatter, return new contentHash, cache stores blob SHAs (not commit SHAs).
import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import { serializeMdFile } from '../../lib/content/file-serializers';
import { CITY } from '../../lib/config/config';
import { env } from '../../lib/env/env.service';
import { saveContent } from '../../lib/content/content-save';
import type { SaveHandlers, BuildResult, WithAfterCommit } from '../../lib/content/content-save';
import type { FileChange } from '../../lib/git/git.adapter-github';
import { bikePathOps } from '../../lib/content/content-ops.server';
import { buildSingleMediaKeyChanges, buildCommitTrailer, afterCommitMediaCleanup, mergeFrontmatter } from '../../lib/content/save-helpers.server';
import { extractFrontmatterField, parkOrphanedMedia } from '../../lib/media/media-parking.server';
import type { ParkedMediaEntry } from '../../lib/media/media-merge';
import { fetchSharedKeysData } from '../../lib/content/load-admin-content.server';

let sharedKeysData: Record<string, Array<{ type: string; slug: string }>> = {};

export const prerender = false;

const bikePathUpdateSchema = z.object({
  frontmatter: z.object({
    name: z.string().optional(),
    name_fr: z.string().optional(),
    vibe: z.string().optional(),
    hidden: z.boolean().optional(),
    stub: z.boolean().optional(),
    featured: z.boolean().optional(),
    includes: z.array(z.string()).default([]),
    photo_key: z.string().optional(),
    tags: z.array(z.string()).default([]),
    wikipedia: z.string().optional(),
    operator: z.string().optional(),
  }),
  body: z.string().default(''),
  contentHash: z.string().optional(),
});

export interface BikePathUpdate {
  frontmatter: {
    name?: string;
    name_fr?: string;
    vibe?: string;
    hidden?: boolean;
    stub?: boolean;
    featured?: boolean;
    includes: string[];
    photo_key?: string;
    tags: string[];
    wikipedia?: string;
    operator?: string;
  };
  body: string;
  contentHash?: string;
}

interface BikePathBuildResult extends BuildResult {
  oldPhotoKey: string | undefined;
  newPhotoKey: string | undefined;
  bikePathSlug: string;
  mergedParked: ParkedMediaEntry[] | undefined;
}

export const bikePathHandlers: SaveHandlers<BikePathUpdate, BikePathBuildResult> & WithAfterCommit<BikePathBuildResult> = {
  parseRequest(body: unknown): BikePathUpdate {
    return bikePathUpdateSchema.parse(body);
  },

  resolveContentId(params): string {
    return params.id!;
  },

  getFilePaths: bikePathOps.getFilePaths,
  computeContentHash: bikePathOps.computeContentHash,
  buildFreshData: bikePathOps.buildFreshData,

  async buildFileChanges(update, bikePathId, currentFiles, git) {
    const bikePath = bikePathOps.getFilePaths(bikePathId).primary;
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
      contentType: 'bike-path',
      contentId: bikePathId,
      sharedKeysData,
      git,
    });
    if (parked) {
      mergedParked = parked.mergedParked;
      files.push(parked.fileChange);
    }

    // Merge frontmatter: overlay editor fields on existing frontmatter
    const mergedFrontmatter = mergeFrontmatter(
      isNew,
      currentFiles.primaryFile?.content ?? null,
      update.frontmatter as Record<string, unknown>,
    );

    files.push({ path: bikePath, content: serializeMdFile(mergedFrontmatter, update.body) });

    return { files, deletePaths: [], isNew, oldPhotoKey, newPhotoKey, bikePathSlug: bikePathId, mergedParked };
  },

  async afterCommit(result, database) {
    const { oldPhotoKey, newPhotoKey, bikePathSlug, mergedParked } = result;
    const changes = buildSingleMediaKeyChanges(oldPhotoKey, newPhotoKey, 'bike-path', bikePathSlug);
    await afterCommitMediaCleanup({ database, sharedKeysData, mediaKeyChanges: changes, mergedParked });
  },

  buildCommitMessage(update, bikePathId, isNew): string {
    const resourcePath = `${CITY}/bike-paths/${bikePathId}`;
    const title = update.frontmatter.name || bikePathId;
    const trailer = buildCommitTrailer(resourcePath);
    return isNew ? `Create ${title}${trailer}` : `Update ${title}${trailer}`;
  },

  buildGitHubUrl(bikePathId: string, baseBranch: string): string {
    return `https://github.com/${env.GIT_OWNER}/${env.GIT_DATA_REPO}/blob/${baseBranch}/${bikePathOps.getFilePaths(bikePathId).primary}`;
  },
};

export async function POST({ params, request, locals }: APIContext) {
  sharedKeysData = await fetchSharedKeysData(new URL(request.url));
  return saveContent(request, locals, params, 'bike-paths', bikePathHandlers);
}
