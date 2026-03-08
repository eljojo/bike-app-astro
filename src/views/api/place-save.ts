import type { APIContext } from 'astro';
import yaml from 'js-yaml';
import { z } from 'zod';
import { CITY } from '../../lib/config';
import { GIT_OWNER, GIT_DATA_REPO } from '../../lib/config';
import { jsonError } from '../../lib/api-response';
import { saveContent } from '../../lib/content-save';
import type { SaveHandlers, CurrentFiles } from '../../lib/content-save';
import type { IGitService, FileChange } from '../../lib/git-service';
import { buildFreshPlaceData, computePlaceContentHashFromFiles } from '../../lib/models/place-model';
import { slugify } from '../../lib/slug';
import { getPhotoUsages, updateSharedKeys, serializeSharedKeys } from '../../lib/photo-registry';
import { loadSharedKeysMap } from '../../lib/load-admin-content';
import { mergeParkedPhotos, type ParkedPhotoEntry } from '../../lib/media-merge';
import { upsertContentCache } from '../../lib/cache';
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

function resolvePlacePath(placeId: string): string {
  return `${CITY}/places/${placeId}.md`;
}

export const placeHandlers: SaveHandlers<PlaceUpdate> = {
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

  getFilePaths(placeId: string) {
    return { primary: resolvePlacePath(placeId) };
  },

  computeContentHash(currentFiles: CurrentFiles): string {
    return computePlaceContentHashFromFiles(currentFiles);
  },

  buildFreshData(placeId: string, currentFiles: CurrentFiles): string {
    return buildFreshPlaceData(placeId, currentFiles);
  },

  async checkExistence(git: IGitService, placeId: string): Promise<Response | null> {
    const placePath = resolvePlacePath(placeId);
    const existing = await git.readFile(placePath);
    if (existing) {
      return jsonError(`Place ${placeId} already exists`, 409);
    }
    return null;
  },

  async buildFileChanges(update, placeId, currentFiles, git) {
    const placePath = resolvePlacePath(placeId);
    const isNew = !currentFiles.primaryFile;
    const files: FileChange[] = [];

    // Detect photo_key change
    let oldPhotoKey: string | undefined;
    if (currentFiles.primaryFile) {
      const fmMatch = currentFiles.primaryFile.content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const existingFm = yaml.load(fmMatch[1]) as Record<string, unknown>;
        oldPhotoKey = existingFm.photo_key as string | undefined;
      }
    }
    const newPhotoKey = update.frontmatter.photo_key;

    // If photo_key was removed, check if it's used elsewhere and park if not
    let mergedParked: ParkedPhotoEntry[] | undefined;
    if (oldPhotoKey && oldPhotoKey !== newPhotoKey) {
      const sharedKeysMap = await loadSharedKeysMap(sharedKeysData);
      const usages = getPhotoUsages(sharedKeysMap, oldPhotoKey);
      const usedElsewhere = usages.some(u => !(u.type === 'place' && u.slug === placeId));

      if (!usedElsewhere) {
        const parkedPath = `${CITY}/parked-photos.yml`;
        const existingParkedFile = await git.readFile(parkedPath);
        const existingParked: ParkedPhotoEntry[] = existingParkedFile
          ? (yaml.load(existingParkedFile.content) as ParkedPhotoEntry[]) || []
          : [];
        mergedParked = mergeParkedPhotos(existingParked, [{ key: oldPhotoKey }], new Set());
        files.push({ path: parkedPath, content: yaml.dump(mergedParked, { lineWidth: -1 }) });
      }
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

    const frontmatterStr = yaml.dump(fm, {
      lineWidth: -1, quotingType: '"', forceQuotes: false,
    }).trimEnd();

    const content = `---\n${frontmatterStr}\n---\n`;
    files.push({ path: placePath, content });

    return {
      files,
      deletePaths: [],
      isNew,
      oldPhotoKey,
      newPhotoKey,
      placeSlug: placeId,
      mergedParked,
    };
  },

  async afterCommit(result, database) {
    const oldPhotoKey = result.oldPhotoKey as string | undefined;
    const newPhotoKey = result.newPhotoKey as string | undefined;
    const placeSlug = result.placeSlug as string;

    if (oldPhotoKey !== newPhotoKey) {
      const sharedKeysMap = await loadSharedKeysMap(sharedKeysData);
      if (oldPhotoKey) {
        updateSharedKeys(sharedKeysMap, oldPhotoKey, { type: 'place', slug: placeSlug }, 'remove');
      }
      if (newPhotoKey) {
        updateSharedKeys(sharedKeysMap, newPhotoKey, { type: 'place', slug: placeSlug }, 'add');
      }
      await upsertContentCache(database, {
        contentType: 'photo-shared-keys',
        contentSlug: '__global',
        data: serializeSharedKeys(sharedKeysMap),
        githubSha: 'n/a',
      });
    }

    const mergedParked = result.mergedParked as ParkedPhotoEntry[] | undefined;
    if (mergedParked) {
      await upsertContentCache(database, {
        contentType: 'parked-photos',
        contentSlug: '__global',
        data: JSON.stringify(mergedParked),
        githubSha: 'n/a',
      });
    }
  },

  buildCommitMessage(update, placeId, isNew): string {
    const resourcePath = `${CITY}/places/${placeId}`;
    const title = update.frontmatter.name || placeId;
    const trailer = `\n\nChanges: ${resourcePath}`;
    return isNew ? `Create ${title}${trailer}` : `Update ${title}${trailer}`;
  },

  buildGitHubUrl(placeId: string, baseBranch: string): string {
    return `https://github.com/${GIT_OWNER}/${GIT_DATA_REPO}/blob/${baseBranch}/${resolvePlacePath(placeId)}`;
  },
};

export async function POST({ params, request, locals }: APIContext) {
  const id = params.id;
  const handlers = id === 'new'
    ? placeHandlers
    : { ...placeHandlers, checkExistence: undefined };

  return saveContent(request, locals, params, 'places', handlers);
}
