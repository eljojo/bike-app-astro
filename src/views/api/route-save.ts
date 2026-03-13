// AGENTS.md: See src/views/api/AGENTS.md for save pipeline rules.
// Key: always merge frontmatter, return new contentHash, cache stores blob SHAs (not commit SHAs).
import type { APIContext } from 'astro';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { z } from 'astro/zod';
import { serializeMdFile, serializeYamlFile } from '../../lib/file-serializers';
import { mergeMedia, mergeParkedPhotos, type ParkedPhotoEntry } from '../../lib/media-merge';
import { parseGpx } from '../../lib/gpx';
import { CITY } from '../../lib/config';
import { jsonError } from '../../lib/api-response';
import { saveContent } from '../../lib/content-save';
import type { SaveHandlers, BuildResult, CurrentFiles } from '../../lib/content-save';
import type { FileChange } from '../../lib/git-service';
import { commitGpxFile } from '../../lib/git-gpx';
import { env } from '../../lib/env';
import { buildFreshRouteData, computeRouteContentHashFromFiles, adminMediaItemSchema, adminVariantSchema } from '../../lib/models/route-model';
import { validateSlug } from '../../lib/slug';
import { supportedLocales, defaultLocale } from '../../lib/locale-utils';
import { updateRedirectsYaml } from '../../lib/redirects';
import { updatePhotoRegistryCache } from '../../lib/photo-parking';
import sharedKeysData from 'virtual:bike-app/photo-shared-keys';

export const prerender = false;

/** Variant with client-only upload fields. */
const variantPayloadSchema = adminVariantSchema.extend({
  isNew: z.boolean().optional(),
  gpxContent: z.string().optional(),
});

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
  media: z.array(adminMediaItemSchema).optional(),
  variants: z.array(variantPayloadSchema).min(1, 'At least one route option is required').optional(),
  parkedPhotos: z.array(adminMediaItemSchema).optional(),
  deletedParkedKeys: z.array(z.string()).optional(),
  newSlug: z.string().optional(),
  contentHash: z.string().optional(),
  translations: z.record(z.string(), z.object({
    name: z.string(),
    tagline: z.string(),
    body: z.string(),
  })).optional(),
});

export type RouteUpdate = z.infer<typeof routeUpdateSchema>;

interface RouteBuildResult extends BuildResult {
  mergedParked: ParkedPhotoEntry[] | undefined;
  addedMediaKeys: string[];
  removedMediaKeys: string[];
  slug: string;
}

export const routeHandlers: SaveHandlers<RouteUpdate, RouteBuildResult> = {
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
          if (track.points.length < 2) {
            return jsonError('GPX file must contain at least 2 track points', 400) as never;
          }
          entry.distance_km = Math.round(track.distance_m / 100) / 10;
        } else if (v.distance_km) {
          entry.distance_km = v.distance_km;
        }
        if (v.strava_url) entry.strava_url = v.strava_url;
        if (v.rwgps_url) entry.rwgps_url = v.rwgps_url;
        if (v.google_maps_url) entry.google_maps_url = v.google_maps_url;
        if (v.komoot_url) entry.komoot_url = v.komoot_url;
        return entry;
      });
      mergedFrontmatter.variants = variantMeta;

      const firstDistance = (variantMeta[0] as Record<string, unknown>)?.distance_km;
      if (firstDistance) {
        mergedFrontmatter.distance_km = firstDistance;
      }

      for (const v of update.variants) {
        if (v.isNew && v.gpxContent) {
          files.push(await commitGpxFile({
            path: `${basePath}/${v.gpx}`,
            content: v.gpxContent,
            token: env.GITHUB_TOKEN,
            owner: env.GIT_OWNER,
            repo: env.GIT_DATA_REPO,
          }));
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
    files.push({ path: `${basePath}/index.md`, content: serializeMdFile(mergedFrontmatter, update.body) });

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
          if (Object.keys(transFm).length > 0 || trans.body.trim()) {
            files.push({ path: transPath, content: serializeMdFile(transFm, trans.body) });
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
        files.push({ path: `${basePath}/media.yml`, content: serializeYamlFile(merged) });
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
      files.push({ path: parkedPath, content: serializeYamlFile(mergedParked) });
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
    return `https://github.com/${env.GIT_OWNER}/${env.GIT_DATA_REPO}/blob/${baseBranch}/${CITY}/routes/${slug}/index.md`;
  },

  async afterCommit(result, database) {
    const { mergedParked, addedMediaKeys, removedMediaKeys, slug: routeSlug } = result;
    const changes = [
      ...removedMediaKeys.map(key => ({ key, usage: { type: 'route' as const, slug: routeSlug }, action: 'remove' as const })),
      ...addedMediaKeys.map(key => ({ key, usage: { type: 'route' as const, slug: routeSlug }, action: 'add' as const })),
    ];
    await updatePhotoRegistryCache({ database, sharedKeysData, keyChanges: changes, mergedParked });
  },
};

export async function POST({ params, request, locals }: APIContext) {
  return saveContent(request, locals, params, 'routes', routeHandlers);
}
