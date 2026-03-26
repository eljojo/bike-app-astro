// route-file-reader.ts
//
// Reads a single route directory (routes/{slug}/) from disk.
// Returns parsed but untransformed data — frontmatter, media, GPX tracks,
// translations, and raw file contents (for content hash computation).
//
// Data flow:
//   route-file-reader.ts  →  routes.ts (public pages: digest, render, store)
//                          →  admin-routes.ts (admin UI: hash, difficulty, virtual module)
//
// This module has no Astro dependencies. It's pure filesystem + parsing.

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { parseGpx, type GpxTrack } from '../lib/gpx/parse';

/** A media entry (photo or video) attached to a route. */
export interface RouteMedia {
  type: 'photo' | 'video';
  key: string;
  handle: string;
  cover?: boolean;
  caption?: string;
  title?: string;
  score?: number;
  width?: number;
  height?: number;
  duration?: string;
  orientation?: string;
  lat?: number;
  lng?: number;
  uploaded_by?: string;
  captured_at?: string;
}

export interface ParsedRouteDir {
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
  media: RouteMedia[];
  gpxTracks: Record<string, GpxTrack>;
  translations: Record<string, { frontmatter: Record<string, unknown>; body: string }>;
  /** Raw file contents for content hash computation and model-layer parsing. */
  rawContents: {
    indexMd: string;
    mediaYml?: string;
    gpxFiles: Record<string, string>;
  };
}

/**
 * Read and parse all files in a route directory.
 * Returns null if index.md doesn't exist.
 *
 * The caller provides a list of locale codes to scan for translations.
 * If omitted, no translations are loaded (useful for tests).
 */
export function readRouteDir(
  routeAbsPath: string,
  slug: string,
  locales?: string[],
): ParsedRouteDir | null {
  const indexPath = path.join(routeAbsPath, 'index.md');
  if (!fs.existsSync(indexPath)) return null;

  // Read index.md
  const indexMd = fs.readFileSync(indexPath, 'utf-8');
  const { data: frontmatter, content: body } = matter(indexMd);

  // Read media.yml
  const mediaPath = path.join(routeAbsPath, 'media.yml');
  let media: RouteMedia[] = [];
  let mediaYml: string | undefined;
  if (fs.existsSync(mediaPath)) {
    mediaYml = fs.readFileSync(mediaPath, 'utf-8');
    media = (yaml.load(mediaYml) as RouteMedia[]) || [];
  }

  // Parse GPX tracks referenced in frontmatter variants.
  // If no variants are defined but main.gpx exists, infer a default variant.
  const gpxTracks: Record<string, GpxTrack> = {};
  const gpxFiles: Record<string, string> = {};
  let variants = (frontmatter.variants as Array<{ gpx: string; name?: string; distance_km?: number }>) || [];
  if (variants.length === 0 && fs.existsSync(path.join(routeAbsPath, 'main.gpx'))) {
    variants = [{ gpx: 'main.gpx', name: frontmatter.name as string || slug, distance_km: frontmatter.distance_km as number | undefined }];
    frontmatter.variants = variants;
  }
  for (const variant of variants) {
    const gpxPath = path.join(routeAbsPath, variant.gpx);
    if (fs.existsSync(gpxPath)) {
      try {
        const gpxXml = fs.readFileSync(gpxPath, 'utf-8');
        gpxFiles[variant.gpx] = gpxXml;
        gpxTracks[variant.gpx] = parseGpx(gpxXml);
      } catch {
        // Skip unparseable GPX — caller handles missing tracks
      }
    }
  }

  // Load locale translations
  const translations: ParsedRouteDir['translations'] = {};
  if (locales) {
    for (const locale of locales) {
      const localePath = path.join(routeAbsPath, `index.${locale}.md`);
      if (!fs.existsSync(localePath)) continue;
      const raw = fs.readFileSync(localePath, 'utf-8');
      const { data: fm, content: localeBody } = matter(raw);
      translations[locale] = {
        frontmatter: fm as Record<string, unknown>,
        body: localeBody.trim(),
      };
    }
  }

  return {
    slug,
    frontmatter,
    body: body.trim(),
    media,
    gpxTracks,
    translations,
    rawContents: { indexMd, mediaYml, gpxFiles },
  };
}
