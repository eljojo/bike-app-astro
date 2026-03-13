// AGENTS.md: See src/views/api/AGENTS.md for save pipeline rules.
// Key: always merge frontmatter, return new contentHash, cache stores blob SHAs (not commit SHAs).
import type { APIContext } from 'astro';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { z } from 'astro/zod';
import { serializeMdFile, serializeYamlFile } from '../../lib/file-serializers';
import { mergeMedia } from '../../lib/media-merge';
import { parseGpx } from '../../lib/gpx';
import { env } from '../../lib/env';
import { saveContent } from '../../lib/content-save';
import type { SaveHandlers, BuildResult, CurrentFiles } from '../../lib/content-save';
import type { IGitService, FileChange } from '../../lib/git-service';
import { rideFilePathsFromRelPath, deriveGpxRelativePath, resolveNewRideSlug, renameGpxRelPath } from '../../lib/ride-paths';
import { buildRedirectFileChange } from '../../lib/redirects';
import { CITY } from '../../lib/config';
import { computeRideContentHashFromFiles, buildFreshRideData, rideVariantSchema } from '../../lib/models/ride-model';
import { baseMediaItemSchema } from '../../lib/models/content-model';
import { validateSlug } from '../../lib/slug';
import { commitGpxFile } from '../../lib/git-gpx';
import { jsonError } from '../../lib/api-response';
import { updatePhotoRegistryCache } from '../../lib/photo-parking';
import sharedKeysData from 'virtual:bike-app/photo-shared-keys';

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
function createRideHandlers(): SaveHandlers<RideUpdate, RideBuildResult> {
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

    async checkExistence(git: IGitService): Promise<Response | null> {
      if (!gpxRelPath) return null;
      const paths = rideFilePathsFromRelPath(gpxRelPath, CITY);
      const existing = await git.readFile(paths.sidecar);
      if (existing) {
        return jsonError(`Ride already exists at ${gpxRelPath}`, 409);
      }
      return null;
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
      let mergedFrontmatter: Record<string, unknown>;

      if (isNew) {
        const adminFields: Record<string, unknown> = { ...update.frontmatter };
        if (!adminFields.status) adminFields.status = 'published';
        mergedFrontmatter = adminFields;
      } else {
        const { data: existingFm } = matter(currentFiles.primaryFile!.content);
        mergedFrontmatter = { ...existingFm, ...update.frontmatter };
      }

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
        const auxFiles = currentFiles.auxiliaryFiles || {};
        const mediaFilePath = Object.keys(auxFiles).find(p => p.endsWith('-media.yml'));
        const currentMedia = mediaFilePath ? auxFiles[mediaFilePath] : null;
        let existingMedia: Array<Record<string, unknown>> = [];
        if (currentMedia) {
          existingMedia = (yaml.load(currentMedia.content) as Array<Record<string, unknown>>) || [];
        }

        const oldKeys = new Set(existingMedia.map(m => m.key as string));
        const newKeys = new Set(update.media.map(m => m.key));
        addedMediaKeys = update.media.filter(m => !oldKeys.has(m.key)).map(m => m.key);
        removedMediaKeys = existingMedia.filter(m => !newKeys.has(m.key as string)).map(m => m.key as string);

        const merged = mergeMedia(update.media, existingMedia);
        if (merged.length > 0) {
          files.push({ path: paths.media, content: serializeYamlFile(merged) });
        } else if (currentMedia) {
          // All media removed — delete the file
          deletePaths.push(paths.media);
        }
      }

      return { files, deletePaths, isNew, rideSlug: _slug, addedMediaKeys, removedMediaKeys };
    },

    async afterCommit(result, database) {
      const { rideSlug, addedMediaKeys, removedMediaKeys } = result;
      const changes = [
        ...removedMediaKeys.map(key => ({ key, usage: { type: 'route' as const, slug: rideSlug }, action: 'remove' as const })),
        ...addedMediaKeys.map(key => ({ key, usage: { type: 'route' as const, slug: rideSlug }, action: 'add' as const })),
      ];
      await updatePhotoRegistryCache({ database, sharedKeysData, keyChanges: changes });
    },

    buildCommitMessage(update, _slug, isNew): string {
      const title = (update.frontmatter as Record<string, unknown>)?.name as string || _slug;
      const sidecarPath = gpxRelPath
        ? rideFilePathsFromRelPath(gpxRelPath, CITY).sidecar
        : _slug;
      const trailer = `\n\nChanges: ${sidecarPath}`;

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
  // Only check for duplicate rides when creating new ones
  const effectiveHandlers = params.slug === 'new'
    ? handlers
    : { ...handlers, checkExistence: undefined };
  return saveContent(request, locals, params, 'rides', effectiveHandlers);
}
