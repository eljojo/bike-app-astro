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
import type { SaveHandlers, CurrentFiles } from '../../lib/content-save';
import type { FileChange } from '../../lib/git-service';
import { rideFilePathsFromRelPath, deriveGpxRelativePath } from '../../lib/ride-paths';
import { CITY } from '../../lib/config';
import { computeRideContentHashFromFiles, buildFreshRideData } from '../../lib/models/ride-model';
import { validateSlug, slugify } from '../../lib/slug';
import { commitGpxFile } from '../../lib/git-gpx';

export const prerender = false;

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
  media: z.array(z.object({
    key: z.string(),
    caption: z.string().optional(),
    cover: z.boolean().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  })).optional(),
  variants: z.array(z.object({
    name: z.string(),
    gpx: z.string(),
    distance_km: z.number().optional(),
    strava_url: z.string().optional(),
    rwgps_url: z.string().optional(),
    isNew: z.boolean().optional(),
    gpxContent: z.string().optional(),
  })).min(1, 'At least one GPX file is required').optional(),
  contentHash: z.string().optional(),
  gpxRelativePath: z.string().optional(),
});

export interface RideUpdate {
  frontmatter: Record<string, unknown>;
  body: string;
  media?: Array<{
    key: string;
    caption?: string;
    cover?: boolean;
    width?: number;
    height?: number;
    lat?: number;
    lng?: number;
  }>;
  variants?: Array<{
    name: string;
    gpx: string;
    distance_km?: number;
    strava_url?: string;
    rwgps_url?: string;
    isNew?: boolean;
    gpxContent?: string;
  }>;
  contentHash?: string;
  gpxRelativePath?: string;
}

/**
 * Create ride save handlers. Returns a fresh instance per request
 * to safely capture gpxRelativePath from the parsed request body.
 */
function createRideHandlers(): SaveHandlers<RideUpdate> {
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
        const name = (update.frontmatter as Record<string, unknown>).name as string;
        return slugify(name);
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

    async buildFileChanges(update, _slug, currentFiles) {
      if (!gpxRelPath) {
        throw new Error('gpxRelativePath is required for ride saves');
      }
      const paths = rideFilePathsFromRelPath(gpxRelPath, CITY);
      const files: FileChange[] = [];
      const deletePaths: string[] = [];
      const isNew = !currentFiles.primaryFile;

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

      // Build media file
      if (update.media) {
        const auxFiles = currentFiles.auxiliaryFiles || {};
        const mediaFilePath = Object.keys(auxFiles).find(p => p.endsWith('-media.yml'));
        const currentMedia = mediaFilePath ? auxFiles[mediaFilePath] : null;
        let existingMedia: Array<Record<string, unknown>> = [];
        if (currentMedia) {
          existingMedia = (yaml.load(currentMedia.content) as Array<Record<string, unknown>>) || [];
        }

        const merged = mergeMedia(update.media, existingMedia);
        if (merged.length > 0) {
          files.push({ path: paths.media, content: serializeYamlFile(merged) });
        } else if (currentMedia) {
          // All media removed — delete the file
          deletePaths.push(paths.media);
        }
      }

      return { files, deletePaths, isNew };
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
  return saveContent(request, locals, params, 'rides', createRideHandlers());
}
