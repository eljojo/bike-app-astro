// AGENTS.md: See src/views/api/AGENTS.md for save pipeline rules.
// Key: always merge frontmatter, return new contentHash, cache stores blob SHAs (not commit SHAs).
import type { APIContext } from 'astro';
import { z } from 'astro/zod';
import { serializeMdFile, serializeYamlFile } from '../../lib/file-serializers';
import { mergeMedia } from '../../lib/media-merge';
import { parseGpx } from '../../lib/gpx';
import { env } from '../../lib/env/env.service';
import { saveContent } from '../../lib/content-save';
import type { SaveHandlers, BuildResult, CurrentFiles, WithSlugValidation, WithExistenceCheck, WithAfterCommit } from '../../lib/content-save';
import type { IGitService, FileChange } from '../../lib/git/git.adapter-github';
import { rideFilePathsFromRelPath, deriveGpxRelativePath, resolveNewRideSlug, renameGpxRelPath, suffixGpxRelPath, suffixRideSlug } from '../../lib/ride-paths';
import { buildRedirectFileChange } from '../../lib/redirects';
import { CITY } from '../../lib/config/config';
import { computeRideContentHashFromFiles, buildFreshRideData, rideVariantSchema } from '../../lib/models/ride-model';
import { baseMediaItemSchema } from '../../lib/models/content-model';
import { validateSlug } from '../../lib/slug';
import { commitGpxFile } from '../../lib/git/git-gpx';

import { updatePhotoRegistryCache } from '../../lib/photo-parking';
import sharedKeysData from 'virtual:bike-app/photo-shared-keys';
import { buildMediaKeyChanges, computeMediaKeyDiff, buildCommitTrailer, mergeFrontmatter, loadExistingMedia } from '../../lib/save-helpers';

export const prerender = false;

/** Variant with client-only upload fields. */
const rideVariantPayloadSchema = rideVariantSchema.extend({
  isNew: z.boolean().optional(),
  gpxContent: z.string().optional(),
});

const rideUpdateSchema = z.object({
  frontmatter: z.object({
    name: z.string(),
    tagline: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.string().optional(),
    ride_date: z.string().optional(),
    country: z.string().optional(),
    tour_slug: z.string().optional(),
    highlight: z.boolean().optional(),
    strava_id: z.string().optional(),
    privacy_zone: z.boolean().optional(),
  }),
  body: z.string(),
  media: z.array(baseMediaItemSchema).optional(),
  variants: z.array(rideVariantPayloadSchema).min(1, 'At least one GPX file is required').optional(),
  newSlug: z.string().optional(),
  contentHash: z.string().optional(),
  gpxRelativePath: z.string().optional(),
});

export type RideUpdate = z.infer<typeof rideUpdateSchema>;

interface RideBuildResult extends BuildResult {
  rideSlug: string;
  addedMediaKeys: string[];
  removedMediaKeys: string[];
}

/**
 * Create ride save handlers. Returns a fresh instance per request
 * to safely capture gpxRelativePath from the parsed request body.
 */
function createRideHandlers(): SaveHandlers<RideUpdate, RideBuildResult> & WithSlugValidation & WithExistenceCheck & WithAfterCommit<RideBuildResult> {
  let gpxRelPath: string | undefined;

  return {
    parseRequest(body: unknown): RideUpdate {
      const parsed = rideUpdateSchema.parse(body);
      gpxRelPath = parsed.gpxRelativePath;

      // For new rides: derive path from ride_date + first variant's GPX filename
      if (!gpxRelPath && parsed.variants?.[0]?.gpxContent) {
        const rideDate = (parsed.frontmatter as Record<string, unknown>).ride_date as string;
        const tourSlug = (parsed.frontmatter as Record<string, unknown>).tour_slug as string | undefined;
        const gpxFilename = parsed.variants[0].gpx;
        gpxRelPath = deriveGpxRelativePath(rideDate, gpxFilename, tourSlug);
        // Sync variant's gpx field with the normalized filename from the derived path
        // so buildFileChanges uses the correct DD-name.gpx filename
        parsed.variants[0].gpx = gpxRelPath.split('/').pop()!;
      }

      return parsed;
    },

    resolveContentId(params, update): string {
      const slug = params.slug;
      if (slug === 'new') {
        const fm = update.frontmatter as Record<string, unknown>;
        const name = fm.name as string;
        const rideDate = fm.ride_date as string;
        const tourSlug = fm.tour_slug as string | undefined;
        return resolveNewRideSlug(name, rideDate, tourSlug);
      }
      return slug!;
    },

    validateSlug(slug: string): string | null {
      return validateSlug(slug);
    },

    getFilePaths(_slug: string) {
      if (!gpxRelPath) {
        throw new Error('gpxRelativePath is required for ride saves');
      }
      const paths = rideFilePathsFromRelPath(gpxRelPath, CITY);
      return {
        primary: paths.sidecar,
        auxiliary: [paths.gpx, paths.media],
      };
    },

    computeContentHash(currentFiles: CurrentFiles): string {
      return computeRideContentHashFromFiles(currentFiles);
    },

    buildFreshData(slug: string, currentFiles: CurrentFiles): string {
      return buildFreshRideData(slug, currentFiles);
    },

    async checkExistence(git: IGitService, contentId: string): Promise<Response | string | null> {
      if (!gpxRelPath) return null;
      const paths = rideFilePathsFromRelPath(gpxRelPath, CITY);
      const existing = await git.readFile(paths.sidecar);
      if (!existing) return null;

      // Path collision — find a free slot by appending -2, -3, etc.
      for (let n = 2; n <= 99; n++) {
        const candidatePath = suffixGpxRelPath(gpxRelPath, n);
        const candidatePaths = rideFilePathsFromRelPath(candidatePath, CITY);
        const found = await git.readFile(candidatePaths.sidecar);
        if (!found) {
          gpxRelPath = candidatePath;
          return suffixRideSlug(contentId, n);
        }
      }
      return new Response(JSON.stringify({ error: 'Too many rides with the same name on this date' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      });
    },

    async buildFileChanges(update, _slug, currentFiles, git) {
      if (!gpxRelPath) {
        throw new Error('gpxRelativePath is required for ride saves');
      }
      const isNew = !currentFiles.primaryFile;
      const files: FileChange[] = [];
      const deletePaths: string[] = [];

      // Handle slug rename: update gpxRelPath, delete old files, add redirect
      if (update.newSlug && update.newSlug !== _slug && !isNew) {
        const oldPaths = rideFilePathsFromRelPath(gpxRelPath, CITY);
        deletePaths.push(oldPaths.sidecar, oldPaths.media, oldPaths.gpx);

        gpxRelPath = renameGpxRelPath(gpxRelPath, update.newSlug);
        files.push(await buildRedirectFileChange(git, 'rides', _slug, update.newSlug));
      }

      const paths = rideFilePathsFromRelPath(gpxRelPath, CITY);

      // Build frontmatter by merging with existing
      const mergedFrontmatter = mergeFrontmatter(isNew, currentFiles.primaryFile?.content ?? null, update.frontmatter as Record<string, unknown>);

      // Process variants and GPX
      if (update.variants) {
        for (const v of update.variants) {
          if (v.isNew && v.gpxContent) {
            const track = parseGpx(v.gpxContent);
            if (track.points.length < 2) {
              throw new Error('GPX file must contain at least 2 track points');
            }
            const gpxPath = paths.gpx.replace(/[^/]+$/, v.gpx);
            files.push(await commitGpxFile({
              path: gpxPath,
              content: v.gpxContent,
              token: env.GITHUB_TOKEN,
              owner: env.GIT_OWNER,
              repo: env.GIT_DATA_REPO,
            }));
          }
        }
      }

      // Build sidecar .md
      files.push({ path: paths.sidecar, content: serializeMdFile(mergedFrontmatter, update.body) });

      // Build media file and track key changes for shared-keys registry
      let addedMediaKeys: string[] = [];
      let removedMediaKeys: string[] = [];
      if (update.media) {
        const existingMedia = loadExistingMedia(currentFiles.auxiliaryFiles);
        ({ addedKeys: addedMediaKeys, removedKeys: removedMediaKeys } = computeMediaKeyDiff(existingMedia, update.media));

        const merged = mergeMedia(update.media, existingMedia);
        if (merged.length > 0) {
          files.push({ path: paths.media, content: serializeYamlFile(merged) });
        } else if (existingMedia.length > 0) {
          // All media removed — delete the file
          deletePaths.push(paths.media);
        }
      }

      return { files, deletePaths, isNew, rideSlug: _slug, addedMediaKeys, removedMediaKeys };
    },

    async afterCommit(result, database) {
      const { rideSlug, addedMediaKeys, removedMediaKeys } = result;
      const changes = buildMediaKeyChanges(addedMediaKeys, removedMediaKeys, 'route', rideSlug);
      await updatePhotoRegistryCache({ database, sharedKeysData, keyChanges: changes });
    },

    buildCommitMessage(update, _slug, isNew): string {
      const title = (update.frontmatter as Record<string, unknown>)?.name as string || _slug;
      const sidecarPath = gpxRelPath
        ? rideFilePathsFromRelPath(gpxRelPath, CITY).sidecar
        : _slug;
      const trailer = buildCommitTrailer(sidecarPath);

      if (isNew) return `Create ride ${title}${trailer}`;

      const parts: string[] = [];
      if (update.frontmatter) parts.push('Update');
      if (update.media) {
        parts.push('media');
      }
      if (update.variants) {
        const newVariants = (update.variants || []).filter(v => v.isNew);
        if (newVariants.length > 0) {
          parts.push(`${newVariants.length} GPX`);
        }
      }

      let subject: string;
      if (parts.length === 0 || (parts.length === 1 && parts[0] === 'Update')) {
        subject = `Update ride ${title}`;
      } else {
        subject = `${parts.join(' + ')} for ride ${title}`;
      }
      return `${subject}${trailer}`;
    },

    buildGitHubUrl(_slug: string, baseBranch: string): string {
      const sidecarPath = gpxRelPath
        ? rideFilePathsFromRelPath(gpxRelPath, CITY).sidecar
        : _slug;
      return `https://github.com/${env.GIT_OWNER}/${env.GIT_DATA_REPO}/blob/${baseBranch}/${sidecarPath}`;
    },
  };
}

export async function POST({ params, request, locals }: APIContext) {
  const handlers = createRideHandlers();
  if (params.slug === 'new') {
    return saveContent(request, locals, params, 'rides', handlers);
  }
  // For edits, omit checkExistence — only deduplicate when creating new rides
  const { checkExistence, ...editHandlers } = handlers;
  return saveContent(request, locals, params, 'rides', editHandlers);
}
