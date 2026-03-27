// AGENTS.md: See src/views/api/AGENTS.md for save pipeline rules.
// Key: always merge frontmatter, return new contentHash, cache stores blob SHAs (not commit SHAs).
import type { APIContext } from 'astro';
import { z } from 'astro/zod';
import { serializeMdFile } from '../../lib/content/file-serializers';
import { CITY } from '../../lib/config/config';
import { env } from '../../lib/env/env.service';
import { saveContent } from '../../lib/content/content-save';
import type { SaveHandlers } from '../../lib/content/content-save';
import type { FileChange } from '../../lib/git/git.adapter-github';
import { bikePathOps } from '../../lib/content/content-ops.server';
import { buildCommitTrailer } from '../../lib/content/save-helpers.server';

export const prerender = false;

const bikePathUpdateSchema = z.object({
  frontmatter: z.object({
    name: z.string().optional(),
    name_fr: z.string().optional(),
    vibe: z.string().optional(),
    hidden: z.boolean().optional(),
    includes: z.array(z.string()).default([]),
    photo_key: z.string().optional(),
    tags: z.array(z.string()).default([]),
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
    includes: string[];
    photo_key?: string;
    tags: string[];
  };
  body: string;
  contentHash?: string;
}

export const bikePathHandlers: SaveHandlers<BikePathUpdate> = {
  parseRequest(body: unknown): BikePathUpdate {
    return bikePathUpdateSchema.parse(body);
  },

  resolveContentId(params): string {
    return params.id!;
  },

  getFilePaths: bikePathOps.getFilePaths,
  computeContentHash: bikePathOps.computeContentHash,
  buildFreshData: bikePathOps.buildFreshData,

  async buildFileChanges(update, bikePathId, _currentFiles) {
    const bikePath = bikePathOps.getFilePaths(bikePathId).primary;
    const files: FileChange[] = [];

    const fm: Record<string, unknown> = {};
    if (update.frontmatter.name) fm.name = update.frontmatter.name;
    if (update.frontmatter.name_fr) fm.name_fr = update.frontmatter.name_fr;
    if (update.frontmatter.vibe) fm.vibe = update.frontmatter.vibe;
    if (update.frontmatter.hidden) fm.hidden = update.frontmatter.hidden;
    if (update.frontmatter.includes.length > 0) fm.includes = update.frontmatter.includes;
    if (update.frontmatter.photo_key) fm.photo_key = update.frontmatter.photo_key;
    if (update.frontmatter.tags.length > 0) fm.tags = update.frontmatter.tags;

    files.push({ path: bikePath, content: serializeMdFile(fm, update.body) });

    return { files, deletePaths: [], isNew: !_currentFiles.primaryFile };
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
  return saveContent(request, locals, params, 'bike-paths', bikePathHandlers);
}
