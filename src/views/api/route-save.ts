import type { APIContext } from 'astro';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { z } from 'zod';
import { mergeMedia, mergeParkedPhotos, type ParkedPhotoEntry } from '../../lib/media-merge';
import { parseGpx } from '../../lib/gpx';
import { GIT_OWNER, GIT_DATA_REPO, CITY } from '../../lib/config';
import { jsonError } from '../../lib/api-response';
import { saveContent } from '../../lib/content-save';
import { upsertContentCache } from '../../lib/cache';
import type { SaveHandlers, CurrentFiles } from '../../lib/content-save';
import type { FileChange } from '../../lib/git-service';
import { uploadToLfs } from '../../lib/git-lfs';
import { env } from '../../lib/env';
import { buildFreshRouteData, computeRouteContentHashFromFiles } from '../../lib/models/route-model';
import { validateSlug } from '../../lib/slug';
import { supportedLocales, defaultLocale } from '../../lib/locale-utils';
import { updateRedirectsYaml } from '../../lib/redirects';
import { updateSharedKeys, serializeSharedKeys } from '../../lib/photo-registry';
import { loadSharedKeysMap } from '../../lib/load-admin-content';
import sharedKeysData from 'virtual:bike-app/photo-shared-keys';

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
    lat: z.number().optional(),
    lng: z.number().optional(),
    uploaded_by: z.string().optional(),
    captured_at: z.string().optional(),
  })).optional(),
  variants: z.array(z.object({
    name: z.string(),
    gpx: z.string(),
    distance_km: z.number().optional(),
    strava_url: z.string().optional(),
    rwgps_url: z.string().optional(),
    isNew: z.boolean().optional(),
    gpxContent: z.string().optional(),
  })).min(1, 'At least one route option is required').optional(),
  parkedPhotos: z.array(z.object({
    key: z.string(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    caption: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    uploaded_by: z.string().optional(),
    captured_at: z.string().optional(),
  })).optional(),
  deletedParkedKeys: z.array(z.string()).optional(),
  newSlug: z.string().optional(),
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
  newSlug?: string;
  media?: Array<{
    key: string;
    caption?: string;
    cover?: boolean;
    width?: number;
    height?: number;
    lat?: number;
    lng?: number;
    uploaded_by?: string;
    captured_at?: string;
  }>;
  parkedPhotos?: ParkedPhotoEntry[];
  deletedParkedKeys?: string[];
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
    const secondaryLocales = supportedLocales().filter(l => l !== defaultLocale());
    return {
      primary: `${basePath}/index.md`,
      auxiliary: [
        `${basePath}/media.yml`,
        ...secondaryLocales.map(l => `${basePath}/index.${l}.md`),
      ],
    };
  },

  computeContentHash(currentFiles: CurrentFiles): string {
    return computeRouteContentHashFromFiles(currentFiles);
  },

  buildFreshData(slug: string, currentFiles: CurrentFiles): string {
    return buildFreshRouteData(slug, currentFiles);
  },

  async buildFileChanges(update, slug, currentFiles, git) {
    const targetSlug = update.newSlug && update.newSlug !== slug ? update.newSlug : slug;
    const basePath = `${CITY}/routes/${targetSlug}`;
    const files: FileChange[] = [];
    const deletePaths: string[] = [];
    const isNew = !currentFiles.primaryFile;

    // If slug changed and not new, delete old files
    if (targetSlug !== slug && !isNew) {
      const oldBasePath = `${CITY}/routes/${slug}`;
      deletePaths.push(`${oldBasePath}/index.md`);
      deletePaths.push(`${oldBasePath}/media.yml`);
      const secondaryLocales = supportedLocales().filter(l => l !== defaultLocale());
      for (const l of secondaryLocales) {
        deletePaths.push(`${oldBasePath}/index.${l}.md`);
      }
      if (currentFiles.auxiliaryFiles) {
        for (const path of Object.keys(currentFiles.auxiliaryFiles)) {
          if (path.endsWith('.gpx')) {
            deletePaths.push(path);
          }
        }
      }

      // Add redirect entry
      const redirectsPath = `${CITY}/redirects.yml`;
      const redirectsFile = await git.readFile(redirectsPath);
      const updatedRedirects = updateRedirectsYaml(
        redirectsFile?.content || '',
        'routes',
        slug,
        targetSlug,
      );
      files.push({ path: redirectsPath, content: updatedRedirects });
    }

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
          // Preserve existing frontmatter fields (e.g. slug) that the editor doesn't manage
          const existingTransFile = currentFiles.auxiliaryFiles?.[transPath];
          const existingTransFm: Record<string, string> = {};
          if (existingTransFile) {
            const { data } = matter(existingTransFile.content);
            Object.assign(existingTransFm, data);
          }
          const transFm: Record<string, string> = { ...existingTransFm };
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

    // Build media.yml and track added/removed keys for shared-keys map
    let addedMediaKeys: string[] = [];
    let removedMediaKeys: string[] = [];
    if (update.media) {
      const mediaPath = Object.keys(currentFiles.auxiliaryFiles || {}).find(p => p.endsWith('media.yml'));
      const currentMedia = mediaPath ? currentFiles.auxiliaryFiles![mediaPath] : null;
      let existingMedia: Array<Record<string, unknown>> = [];
      if (currentMedia) {
        existingMedia = (yaml.load(currentMedia.content) as Array<Record<string, unknown>>) || [];
      }

      // Compute diffs for shared-keys map
      const oldKeys = new Set(existingMedia.map(m => m.key as string));
      const newKeys = new Set(update.media.map(m => m.key));
      addedMediaKeys = update.media.filter(m => !oldKeys.has(m.key)).map(m => m.key);
      removedMediaKeys = existingMedia.filter(m => !newKeys.has(m.key as string)).map(m => m.key as string);

      const merged = mergeMedia(update.media, existingMedia);
      if (merged.length > 0) {
        const mediaYaml = yaml.dump(merged, { flowLevel: -1, lineWidth: -1 });
        files.push({ path: `${basePath}/media.yml`, content: mediaYaml });
      }
    }

    // Update parked-photos.yml
    const parkedPath = `${CITY}/parked-photos.yml`;
    let existingParked: ParkedPhotoEntry[] = [];
    const parkedFile = await git.readFile(parkedPath);
    if (parkedFile) {
      existingParked = (yaml.load(parkedFile.content) as ParkedPhotoEntry[]) || [];
    }

    // Un-park any photos that were added to this route from parking
    const unparkedKeys = new Set(
      (update.media || [])
        .filter(m => existingParked.some(p => p.key === m.key))
        .map(m => m.key),
    );

    // Also remove explicitly deleted parked photos
    if (update.deletedParkedKeys) {
      for (const k of update.deletedParkedKeys) unparkedKeys.add(k);
    }

    const toAdd = update.parkedPhotos || [];
    const mergedParked = mergeParkedPhotos(existingParked, toAdd, unparkedKeys);

    if (mergedParked.length > 0) {
      files.push({ path: parkedPath, content: yaml.dump(mergedParked, { flowLevel: -1, lineWidth: -1 }) });
    } else if (existingParked.length > 0) {
      deletePaths.push(parkedPath);
    }

    return { files, deletePaths, isNew, mergedParked, addedMediaKeys, removedMediaKeys, slug: targetSlug };
  },

  buildCommitMessage(update, slug, isNew, currentFiles): string {
    const targetSlug = update.newSlug && update.newSlug !== slug ? update.newSlug : slug;
    const resourcePath = `${CITY}/routes/${targetSlug}`;
    const title = (update.frontmatter as Record<string, unknown>)?.name as string || slug;
    const trailer = `\n\nChanges: ${resourcePath}`;

    if (targetSlug !== slug) {
      return `Rename ${title}: ${slug} → ${targetSlug}${trailer}`;
    }

    if (isNew) return `Create ${title}${trailer}`;

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
    let subject: string;
    if (parts.length === 0 || (parts.length === 1 && parts[0] === 'Update')) {
      subject = `Update ${title}`;
    } else {
      subject = `${parts.join(' + ')} for ${title}`;
    }
    return `${subject}${trailer}`;
  },

  buildGitHubUrl(slug: string, baseBranch: string): string {
    return `https://github.com/${GIT_OWNER}/${GIT_DATA_REPO}/blob/${baseBranch}/${CITY}/routes/${slug}/index.md`;
  },

  async afterCommit(result, database) {
    const mergedParked = result.mergedParked as ParkedPhotoEntry[] | undefined;
    if (mergedParked) {
      await upsertContentCache(database, {
        contentType: 'parked-photos',
        contentSlug: '__global',
        data: JSON.stringify(mergedParked),
        githubSha: 'n/a',
      });
    }

    // Update shared-keys map for added/removed media
    const addedKeys = result.addedMediaKeys as string[] | undefined;
    const removedKeys = result.removedMediaKeys as string[] | undefined;
    const routeSlug = result.slug as string;

    if (addedKeys?.length || removedKeys?.length) {
      const sharedKeysMap = await loadSharedKeysMap(sharedKeysData);
      for (const key of removedKeys || []) {
        updateSharedKeys(sharedKeysMap, key, { type: 'route', slug: routeSlug }, 'remove');
      }
      for (const key of addedKeys || []) {
        updateSharedKeys(sharedKeysMap, key, { type: 'route', slug: routeSlug }, 'add');
      }
      await upsertContentCache(database, {
        contentType: 'photo-shared-keys',
        contentSlug: '__global',
        data: serializeSharedKeys(sharedKeysMap),
        githubSha: 'n/a',
      });
    }
  },
};

export async function POST({ params, request, locals }: APIContext) {
  return saveContent(request, locals, params, 'routes', routeHandlers);
}
