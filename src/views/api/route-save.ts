import { createHash } from 'node:crypto';
import type { APIContext } from 'astro';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { mergeMedia } from '../../lib/media-merge';
import { parseGpx } from '../../lib/gpx';
import { GIT_OWNER, GIT_DATA_REPO } from '../../lib/config';
import { jsonError } from '../../lib/api-response';
import { saveContent } from '../../lib/content-save';
import type { SaveHandlers, CurrentFiles } from '../../lib/content-save';
import type { FileChange } from '../../lib/git-service';
import { uploadToLfs } from '../../lib/git-lfs';
import { env } from '../../lib/env';
import { routeDetailFromGit, routeDetailToCache } from '../../lib/models/route-model';
import { validateSlug } from '../../lib/slug';

export const prerender = false;

interface VariantPayload {
  name: string;
  gpx: string;
  distance_km?: number;
  strava_url?: string;
  rwgps_url?: string;
  isNew?: boolean;
  gpxContent?: string;
}

export interface RouteUpdate {
  frontmatter: Record<string, unknown>;
  body: string;
  media: Array<{
    key: string;
    caption?: string;
    cover?: boolean;
    width?: number;
    height?: number;
  }>;
  variants?: VariantPayload[];
  contentHash?: string;
}

const CITY = 'ottawa';

export const routeHandlers: SaveHandlers<RouteUpdate> = {
  parseRequest(body: unknown): RouteUpdate {
    const update = body as RouteUpdate;
    // Validate frontmatter keys
    const allowedKeys = new Set(['name', 'tagline', 'tags', 'status', 'difficulty', 'surface', 'title']);
    const unknownKeys = Object.keys(update.frontmatter || {}).filter(k => !allowedKeys.has(k));
    if (unknownKeys.length > 0) {
      throw new Error(`Unknown frontmatter keys: ${unknownKeys.join(', ')}`);
    }
    return update;
  },

  resolveContentId(params): string {
    return params.slug!;
  },

  validateSlug,

  getFilePaths(slug: string) {
    const basePath = `${CITY}/routes/${slug}`;
    return {
      primary: `${basePath}/index.md`,
      auxiliary: [`${basePath}/media.yml`],
    };
  },

  computeContentHash(currentFiles: CurrentFiles): string {
    const hash = createHash('md5').update(currentFiles.primaryFile!.content);
    const mediaPath = Object.keys(currentFiles.auxiliaryFiles || {})[0];
    if (mediaPath && currentFiles.auxiliaryFiles![mediaPath]) {
      hash.update(currentFiles.auxiliaryFiles![mediaPath]!.content);
    }
    return hash.digest('hex');
  },

  buildFreshData(slug: string, currentFiles: CurrentFiles): string {
    const { data: ghFrontmatter, content: ghBody } = matter(currentFiles.primaryFile!.content);
    const mediaPath = Object.keys(currentFiles.auxiliaryFiles || {})[0];
    const currentMedia = mediaPath ? currentFiles.auxiliaryFiles![mediaPath] : null;
    const detail = routeDetailFromGit(slug, ghFrontmatter, ghBody, currentMedia?.content);
    return routeDetailToCache(detail);
  },

  async buildFileChanges(update, slug, currentFiles): Promise<{ files: FileChange[]; deletePaths: string[]; isNew: boolean }> {
    const basePath = `${CITY}/routes/${slug}`;
    const files: FileChange[] = [];
    const deletePaths: string[] = [];
    const isNew = !currentFiles.primaryFile;

    // Build frontmatter
    let mergedFrontmatter: Record<string, unknown>;
    let existingFrontmatter: Record<string, unknown> = {};

    if (isNew) {
      const adminFields: Record<string, unknown> = { ...update.frontmatter };
      adminFields.status = 'draft';
      adminFields.created_at = new Date().toISOString().split('T')[0];
      adminFields.updated_at = new Date().toISOString().split('T')[0];
      mergedFrontmatter = adminFields;
    } else {
      const { data } = matter(currentFiles.primaryFile!.content);
      existingFrontmatter = data;
      mergedFrontmatter = { ...existingFrontmatter, ...update.frontmatter };
    }

    // Process variants
    if (update.variants) {
      const variantMeta = update.variants.map(v => {
        const entry: Record<string, unknown> = { name: v.name, gpx: v.gpx };
        if (v.isNew && v.gpxContent) {
          const track = parseGpx(v.gpxContent);
          entry.distance_km = Math.round(track.distance_m / 100) / 10;
        } else if (v.distance_km) {
          entry.distance_km = v.distance_km;
        }
        if (v.strava_url) entry.strava_url = v.strava_url;
        if (v.rwgps_url) entry.rwgps_url = v.rwgps_url;
        return entry;
      });
      mergedFrontmatter.variants = variantMeta;

      const firstDistance = (variantMeta[0] as Record<string, unknown>)?.distance_km;
      if (firstDistance) {
        mergedFrontmatter.distance_km = firstDistance;
      }

      for (const v of update.variants) {
        if (v.isNew && v.gpxContent) {
          // Upload GPX to LFS and commit pointer file instead of raw content
          const token = env.GITHUB_TOKEN;
          if (token && typeof token === 'string') {
            const pointer = await uploadToLfs(token, GIT_OWNER, GIT_DATA_REPO, v.gpxContent);
            files.push({ path: `${basePath}/${v.gpx}`, content: pointer });
          } else {
            // Local dev: commit raw GPX (local git handles LFS via .gitattributes)
            files.push({ path: `${basePath}/${v.gpx}`, content: v.gpxContent });
          }
        }
      }

      if (existingFrontmatter.variants) {
        const existingGpxFiles = new Set(
          (existingFrontmatter.variants as Array<{ gpx: string }>).map(v => v.gpx)
        );
        const newGpxFiles = new Set(update.variants.map(v => v.gpx));
        for (const gpx of existingGpxFiles) {
          if (!newGpxFiles.has(gpx)) {
            deletePaths.push(`${basePath}/${gpx}`);
          }
        }
      }
    }

    // Build index.md
    const frontmatterStr = yaml.dump(mergedFrontmatter, {
      lineWidth: -1, quotingType: '"', forceQuotes: false,
    }).trimEnd();

    files.push({ path: `${basePath}/index.md`, content: `---\n${frontmatterStr}\n---\n\n${update.body}\n` });

    // Build media.yml
    if (update.media) {
      const mediaPath = Object.keys(currentFiles.auxiliaryFiles || {})[0];
      const currentMedia = mediaPath ? currentFiles.auxiliaryFiles![mediaPath] : null;
      let existingMedia: Array<Record<string, unknown>> = [];
      if (currentMedia) {
        existingMedia = (yaml.load(currentMedia.content) as Array<Record<string, unknown>>) || [];
      }
      const merged = mergeMedia(update.media, existingMedia);
      if (merged.length > 0) {
        const mediaYaml = yaml.dump(merged, { flowLevel: -1, lineWidth: -1 });
        files.push({ path: `${basePath}/media.yml`, content: mediaYaml });
      }
    }

    return { files, deletePaths, isNew };
  },

  buildCommitMessage(update, slug, isNew, currentFiles): string {
    const resourcePath = `${CITY}/routes/${slug}`;
    if (isNew) return `Create ${resourcePath}`;

    const parts: string[] = [];
    if (update.frontmatter) parts.push('Update');
    if (update.media) {
      const mediaPath = Object.keys(currentFiles.auxiliaryFiles || {})[0];
      const currentMedia = mediaPath ? currentFiles.auxiliaryFiles![mediaPath] : null;
      let existingCount = 0;
      if (currentMedia) {
        const entries = (yaml.load(currentMedia.content) as Array<Record<string, unknown>>) || [];
        existingCount = entries.length;
      }
      const added = update.media.length - existingCount;
      if (added > 0) {
        parts.push(`${added} media`);
      }
    }
    if (update.variants) {
      const newVariants = update.variants.filter(v => v.isNew);
      if (newVariants.length > 0) {
        parts.push(`${newVariants.length} variant${newVariants.length > 1 ? 's' : ''}`);
      }
    }
    return parts.length > 0 ? `${parts.join(' + ')} for ${resourcePath}` : `Update ${resourcePath}`;
  },

  buildCacheData(update, slug, currentFiles): string {
    const { data: fm } = currentFiles.primaryFile
      ? matter(currentFiles.primaryFile.content)
      : { data: {} as Record<string, unknown> };
    const detail = {
      slug,
      name: update.frontmatter.name as string,
      tagline: (update.frontmatter.tagline as string) || '',
      tags: (update.frontmatter.tags as string[]) || [],
      distance: (fm.distance_km as number) || 0,
      status: update.frontmatter.status as string,
      body: update.body,
      media: update.media || [],
      variants: update.variants?.map(v => ({
        name: v.name, gpx: v.gpx,
        ...(v.distance_km != null ? { distance_km: v.distance_km } : {}),
        ...(v.strava_url ? { strava_url: v.strava_url } : {}),
        ...(v.rwgps_url ? { rwgps_url: v.rwgps_url } : {}),
      })) || [],
    };
    return routeDetailToCache(detail);
  },

  buildGitHubUrl(slug: string, baseBranch: string): string {
    return `https://github.com/${GIT_OWNER}/${GIT_DATA_REPO}/blob/${baseBranch}/ottawa/routes/${slug}/index.md`;
  },
};

export async function POST({ params, request, locals }: APIContext) {
  return saveContent(request, locals, params, 'routes', routeHandlers);
}
