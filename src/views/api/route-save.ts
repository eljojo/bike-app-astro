import type { APIContext } from 'astro';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { z } from 'zod';
import { mergeMedia } from '../../lib/media-merge';
import { parseGpx } from '../../lib/gpx';
import { GIT_OWNER, GIT_DATA_REPO, CITY } from '../../lib/config';
import { jsonError } from '../../lib/api-response';
import { saveContent } from '../../lib/content-save';
import type { SaveHandlers, CurrentFiles } from '../../lib/content-save';
import type { FileChange } from '../../lib/git-service';
import { uploadToLfs } from '../../lib/git-lfs';
import { env } from '../../lib/env';
import { routeDetailFromGit, routeDetailToCache, computeRouteContentHash } from '../../lib/models/route-model';
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

const routeUpdateSchema = z.object({
  frontmatter: z.object({
    name: z.string(),
    tagline: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.string().optional(),
    difficulty: z.string().optional(),
    surface: z.string().optional(),
    title: z.string().optional(),
  }).strict(),
  body: z.string(),
  media: z.array(z.object({
    key: z.string(),
    caption: z.string().optional(),
    cover: z.boolean().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })).optional(),
  variants: z.array(z.object({
    name: z.string(),
    gpx: z.string(),
    distance_km: z.number().optional(),
    strava_url: z.string().optional(),
    rwgps_url: z.string().optional(),
    isNew: z.boolean().optional(),
    gpxContent: z.string().optional(),
  })).optional(),
  contentHash: z.string().optional(),
  translations: z.record(z.string(), z.object({
    name: z.string(),
    tagline: z.string(),
    body: z.string(),
  })).optional(),
});

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
  translations?: Record<string, { name: string; tagline: string; body: string }>;
}

export const routeHandlers: SaveHandlers<RouteUpdate> = {
  parseRequest(body: unknown): RouteUpdate {
    return routeUpdateSchema.parse(body);
  },

  resolveContentId(params): string {
    return params.slug!;
  },

  validateSlug,

  getFilePaths(slug: string) {
    const basePath = `${CITY}/routes/${slug}`;
    return {
      primary: `${basePath}/index.md`,
      auxiliary: [`${basePath}/media.yml`, `${basePath}/index.fr.md`],
    };
  },

  computeContentHash(currentFiles: CurrentFiles): string {
    const auxFiles = currentFiles.auxiliaryFiles || {};
    const mediaPath = Object.keys(auxFiles).find(p => p.endsWith('media.yml'));
    const mediaContent = mediaPath ? auxFiles[mediaPath]?.content : undefined;
    const translationContents: Record<string, string> = {};
    for (const [p, f] of Object.entries(auxFiles)) {
      const match = p.match(/index\.(\w+)\.md$/);
      if (match && f) translationContents[match[1]] = f.content;
    }
    return computeRouteContentHash(
      currentFiles.primaryFile!.content,
      mediaContent,
      Object.keys(translationContents).length > 0 ? translationContents : undefined,
    );
  },

  buildFreshData(slug: string, currentFiles: CurrentFiles): string {
    const { data: ghFrontmatter, content: ghBody } = matter(currentFiles.primaryFile!.content);
    const auxFiles = currentFiles.auxiliaryFiles || {};
    const mediaPath = Object.keys(auxFiles).find(p => p.endsWith('media.yml'));
    const currentMedia = mediaPath ? auxFiles[mediaPath] : null;

    const translations: Record<string, { name?: string; tagline?: string; body?: string }> = {};
    for (const [p, f] of Object.entries(auxFiles)) {
      const match = p.match(/index\.(\w+)\.md$/);
      if (match && f) {
        const { data: tFm, content: tBody } = matter(f.content);
        translations[match[1]] = {
          name: tFm.name as string | undefined,
          tagline: tFm.tagline as string | undefined,
          body: tBody.trim() || undefined,
        };
      }
    }

    const detail = routeDetailFromGit(slug, ghFrontmatter, ghBody, currentMedia?.content, translations);
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
      if (!adminFields.status) adminFields.status = 'published';
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

    // Build translation files (index.fr.md, etc.)
    if (update.translations) {
      for (const [locale, trans] of Object.entries(update.translations)) {
        const transPath = `${basePath}/index.${locale}.md`;
        const hasContent = trans.name || trans.tagline || trans.body;
        if (hasContent) {
          const transFm: Record<string, string> = {};
          if (trans.name) transFm.name = trans.name;
          if (trans.tagline) transFm.tagline = trans.tagline;
          const fmStr = Object.keys(transFm).length > 0
            ? yaml.dump(transFm, { lineWidth: -1, quotingType: '"', forceQuotes: false }).trimEnd()
            : '';
          const transContent = trans.body.trim()
            ? `---\n${fmStr}\n---\n\n${trans.body}\n`
            : fmStr ? `---\n${fmStr}\n---\n` : '';
          if (transContent) {
            files.push({ path: transPath, content: transContent });
          }
        } else {
          // All fields empty — delete the translation file if it exists
          const existing = currentFiles.auxiliaryFiles?.[transPath];
          if (existing) deletePaths.push(transPath);
        }
      }
    }

    // Build media.yml
    if (update.media) {
      const mediaPath = Object.keys(currentFiles.auxiliaryFiles || {}).find(p => p.endsWith('media.yml'));
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
      const mediaPath = Object.keys(currentFiles.auxiliaryFiles || {}).find(p => p.endsWith('media.yml'));
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

    const translations: Record<string, { name?: string; tagline?: string; body?: string }> = {};
    if (update.translations) {
      for (const [locale, t] of Object.entries(update.translations)) {
        if (t.name || t.tagline || t.body) {
          translations[locale] = { name: t.name || undefined, tagline: t.tagline || undefined, body: t.body || undefined };
        }
      }
    }

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
      translations,
    };
    return routeDetailToCache(detail);
  },

  buildGitHubUrl(slug: string, baseBranch: string): string {
    return `https://github.com/${GIT_OWNER}/${GIT_DATA_REPO}/blob/${baseBranch}/${CITY}/routes/${slug}/index.md`;
  },
};

export async function POST({ params, request, locals }: APIContext) {
  return saveContent(request, locals, params, 'routes', routeHandlers);
}
