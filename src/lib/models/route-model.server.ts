import yaml from 'js-yaml';
import matter from 'gray-matter';
import { computeHashFromParts } from './content-hash.server';
import { routeDetailToCache } from './route-model';
import type { RouteDetail, AdminMediaItem, AdminVariant, RouteGitFiles } from './route-model';

/** Compute content hash for route conflict detection. Hashes primary + media + translation content. */
export function computeRouteContentHash(primaryContent: string, mediaContent: string | undefined, translationContents?: Record<string, string>): string {
  const sortedTranslations = translationContents
    ? Object.keys(translationContents).sort().map((k) => translationContents[k])
    : [];
  return computeHashFromParts(primaryContent, mediaContent, ...sortedTranslations);
}

/** Compute route hash directly from git file snapshots used by the save pipeline. */
export function computeRouteContentHashFromFiles(currentFiles: RouteGitFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot compute route hash without primary file content');
  }

  const auxFiles = currentFiles.auxiliaryFiles || {};
  const mediaPath = Object.keys(auxFiles).find((p) => p.endsWith('media.yml'));
  const mediaContent = mediaPath ? auxFiles[mediaPath]?.content : undefined;
  const translationContents: Record<string, string> = {};

  for (const [p, f] of Object.entries(auxFiles)) {
    const match = p.match(/index\.(\w+)\.md$/);
    if (match && f) translationContents[match[1]] = f.content;
  }

  return computeRouteContentHash(
    currentFiles.primaryFile.content,
    mediaContent,
    Object.keys(translationContents).length > 0 ? translationContents : undefined,
  );
}

/**
 * Parse raw git content (frontmatter + body + media.yml) into canonical RouteDetail.
 * Includes all media types (photos and videos).
 */
export function routeDetailFromGit(
  slug: string,
  frontmatter: Record<string, unknown>,
  body: string,
  mediaYml?: string,
  translations?: Record<string, { name?: string; tagline?: string; body?: string }>,
): RouteDetail {
  let media: AdminMediaItem[] = [];
  if (mediaYml) {
    const rawMedia = (yaml.load(mediaYml) as Array<Record<string, unknown>>) || [];
    media = rawMedia.map((m) => {
      const item: AdminMediaItem = { key: m.key as string };
      if (m.type === 'video') item.type = 'video';
      if (m.caption != null) item.caption = m.caption as string;
      if (m.cover != null) item.cover = m.cover as boolean;
      if (m.lat != null) item.lat = m.lat as number;
      if (m.lng != null) item.lng = m.lng as number;
      if (m.uploaded_by != null) item.uploaded_by = m.uploaded_by as string;
      if (m.captured_at != null) item.captured_at = m.captured_at as string;
      if (m.width != null) item.width = m.width as number;
      if (m.height != null) item.height = m.height as number;
      if (m.title != null) item.title = m.title as string;
      if (m.handle != null) item.handle = m.handle as string;
      if (m.duration != null) item.duration = m.duration as string;
      if (m.orientation != null) item.orientation = m.orientation as string;
      return item;
    });
  }

  return {
    slug,
    name: frontmatter.name as string,
    tagline: (frontmatter.tagline as string) || '',
    tags: (frontmatter.tags as string[]) || [],
    distance: (frontmatter.distance_km as number) || 0,
    status: (frontmatter.status as string) || 'draft',
    body: body.trim(),
    media,
    variants: (frontmatter.variants as AdminVariant[]) || [],
    translations: translations || {},
  };
}

/** Build fresh route cache JSON directly from git file snapshots used by the save pipeline. */
export function buildFreshRouteData(slug: string, currentFiles: RouteGitFiles): string {
  if (!currentFiles.primaryFile) {
    throw new Error('Cannot build route cache data without primary file content');
  }

  const { data: ghFrontmatter, content: ghBody } = matter(currentFiles.primaryFile.content);
  const auxFiles = currentFiles.auxiliaryFiles || {};
  const mediaPath = Object.keys(auxFiles).find((p) => p.endsWith('media.yml'));
  const currentMedia = mediaPath ? auxFiles[mediaPath] : null;

  const translations: Record<string, { name?: string; tagline?: string; body?: string }> = {};
  for (const [p, f] of Object.entries(auxFiles)) {
    const match = p.match(/index\.(\w+)\.md$/);
    if (!match || !f) continue;
    const { data: tFm, content: tBody } = matter(f.content);
    translations[match[1]] = {
      name: tFm.name as string | undefined,
      tagline: tFm.tagline as string | undefined,
      body: tBody.trim() || undefined,
    };
  }

  const detail = routeDetailFromGit(slug, ghFrontmatter, ghBody, currentMedia?.content, translations);
  return routeDetailToCache(detail);
}
