// ride-file-reader.ts
//
// Reads one ride's files: GPX + optional sidecar .md + optional -media.yml.
// Called per-ride in a loop — never accumulates all rides in memory.
//
// Data flow:
//   ride-file-reader.ts  →  rides.ts (public pages: privacy filter, downsample, store)
//                         →  admin-rides.ts (admin UI: hash, stats, virtual module)
//
// Memory constraint: With 600+ rides, raw GPX XML exhausts the heap if
// accumulated. Each call parses one ride's GPX at full resolution. The caller
// downsamples or discards as needed — no accumulation across rides.
//
// This module has no Astro dependencies. It's pure filesystem + parsing.

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { parseGpx, type GpxTrack } from '../lib/gpx/parse';
import type { RouteMedia } from './route-file-reader';
import {
  extractDateFromPath,
  buildSlug,
  type RideDate,
} from './rides';

export type { RideDate };

export interface ParsedRideFile {
  slug: string;
  date: RideDate;
  /** Present when this ride belongs to a tour. Absent for standalone rides. */
  tourSlug?: string;
  gpxRelativePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  media: RouteMedia[];
  gpxTrack: GpxTrack;
  /** Raw file contents for content hash computation. */
  rawContents: {
    sidecarMd?: string;
    gpxXml: string;
    mediaYml?: string;
  };
}

/**
 * Read and parse one ride's files.
 *
 * @param ridesDir - Absolute path to the rides/ directory
 * @param gpxRelPath - Path to the GPX file relative to ridesDir (e.g. "2026/01/23-ride.gpx")
 * @param tourSlug - If this ride belongs to a tour, the tour's slug. Affects slug format.
 * @returns Parsed ride data, or null if the date can't be extracted or GPX has no track data.
 */
export function readRideFile(
  ridesDir: string,
  gpxRelPath: string,
  tourSlug?: string,
): ParsedRideFile | null {
  const date = extractDateFromPath(gpxRelPath);
  if (!date) return null;

  const gpxFilename = path.basename(gpxRelPath);
  const gpxAbsPath = path.join(ridesDir, gpxRelPath);

  // Parse GPX
  let gpxTrack: GpxTrack;
  let gpxXml: string;
  try {
    gpxXml = fs.readFileSync(gpxAbsPath, 'utf-8');
    gpxTrack = parseGpx(gpxXml);
  } catch {
    return null;
  }

  // A ride with 0 track points is meaningless — treat as failed parse
  if (gpxTrack.points.length === 0) return null;

  // Load optional sidecar .md
  const sidecarPath = gpxAbsPath.replace(/\.gpx$/i, '.md');
  let frontmatter: Record<string, unknown> = {};
  let body = '';
  let sidecarMd: string | undefined;
  if (fs.existsSync(sidecarPath)) {
    sidecarMd = fs.readFileSync(sidecarPath, 'utf-8');
    const parsed = matter(sidecarMd);
    frontmatter = parsed.data;
    body = parsed.content.trim();
  }

  // Load optional -media.yml
  const mediaYmlPath = gpxAbsPath.replace(/\.gpx$/i, '-media.yml');
  let media: RouteMedia[] = [];
  let mediaYml: string | undefined;
  if (fs.existsSync(mediaYmlPath)) {
    mediaYml = fs.readFileSync(mediaYmlPath, 'utf-8');
    media = (yaml.load(mediaYml) as RouteMedia[]) || [];
  }

  const slug = buildSlug(date, gpxFilename, !!tourSlug);

  return {
    slug,
    date,
    tourSlug,
    gpxRelativePath: gpxRelPath,
    frontmatter,
    body,
    media,
    gpxTrack,
    rawContents: { sidecarMd, gpxXml, mediaYml },
  };
}
