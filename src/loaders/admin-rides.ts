// admin-rides.ts — Admin virtual module loader for blog rides.
//
// Reads ride files via ride-file-reader.ts (shared I/O layer),
// then computes content hashes, builds admin list/detail shapes,
// aggregates tour statistics, and produces data for virtual modules.
//
// Data flow:
//   ride-file-reader.ts → admin-rides.ts → build-data-plugin.ts
//     → virtual:bike-app/admin-routes (list, reused for rides on blog)
//     → virtual:bike-app/admin-route-detail (details)
//     → virtual:bike-app/tours (tour summaries)

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { cityDir } from '../lib/config/config.server';
import { renderMarkdownHtml } from '../lib/markdown/markdown-render';
import { computeRideContentHash } from '../lib/models/ride-model.server';
import type { RideDetail } from '../lib/models/ride-model';
import {
  detectTours,
  findGpxFiles,
  rideDateToIso,
  nameFromFilename,
  extractDateFromPath,
  adjustTourYears,
  buildSlug,
} from './rides';
import { readRideFile } from './ride-file-reader';
import { readContentCache, writeContentCache, type ContentCacheEntry } from '../lib/content/content-cache.server';
import { computeFileDigest } from '../lib/directory-digest.server';
import type { AdminRide } from '../types/admin';

export type { AdminRide };

interface CachedRideData {
  ride: AdminRide;
  detail: AdminRideDetail;
  tourAggData: { slug: string; date: string; distance_km: number; elevation_m: number; country?: string } | null;
}

const RIDE_CACHE_VERSION = 1;

function rideCachePath(): string {
  return path.join(process.cwd(), '.astro', 'cache', 'admin-rides-cache.json');
}

export interface AdminRideDetail extends RideDetail {
  gpxRelativePath?: string;
}

export interface AdminTour {
  slug: string;
  name: string;
  description?: string;
  renderedDescription?: string;
  total_distance_km: number;
  total_elevation_m: number;
  days: number;
  ride_count: number;
  countries: string[];
  start_date: string;
  end_date: string;
  rides: string[];
}

export interface RideStats {
  total_distance_km: number;
  total_elevation_m: number;
  total_rides: number;
  total_tours: number;
  total_days: number;
  countries: string[];
  by_year: Record<string, { rides: number; distance_km: number; elevation_m: number }>;
  by_country: Record<string, { rides: number; distance_km: number }>;
  records: {
    longest_ride?: { slug: string; name: string; distance_km: number; tour_slug?: string };
    most_elevation?: { slug: string; name: string; elevation_m: number; tour_slug?: string };
    longest_tour?: { slug: string; name: string; distance_km: number; days: number };
  };
}

interface AdminRideData {
  rides: AdminRide[];
  details: Record<string, AdminRideDetail>;
  tours: AdminTour[];
  stats: RideStats;
}

let cachedRideData: AdminRideData | null = null;

export async function loadAdminRideData(): Promise<AdminRideData> {
  if (cachedRideData) return cachedRideData;

  const ridesDir = path.join(cityDir, 'rides');
  if (!fs.existsSync(ridesDir)) {
    cachedRideData = {
      rides: [],
      details: {},
      tours: [],
      stats: emptyStats(),
    };
    return cachedRideData;
  }

  const gpxPaths = findGpxFiles(ridesDir);
  if (gpxPaths.length === 0) {
    cachedRideData = {
      rides: [],
      details: {},
      tours: [],
      stats: emptyStats(),
    };
    return cachedRideData;
  }

  // Detect tours
  const tours = detectTours(gpxPaths);
  const tourByGpxPath = new Map<string, { slug: string; dirPath: string }>();
  for (const tour of tours) {
    for (const ridePath of tour.ridePaths) {
      tourByGpxPath.set(ridePath, { slug: tour.slug, dirPath: tour.dirPath });
    }
  }

  // Adjust years for multi-year tours (e.g. Dec 2022 → Jan 2023)
  const adjustedDates = new Map<string, { year: number; month: number; day: number }>();
  for (const tour of tours) {
    const tourDates: { gpxPath: string; date: { year: number; month: number; day: number } }[] = [];
    for (const ridePath of tour.ridePaths) {
      const date = extractDateFromPath(ridePath);
      if (date) tourDates.push({ gpxPath: ridePath, date });
    }
    adjustTourYears(tourDates.map(td => td.date));
    for (const td of tourDates) {
      adjustedDates.set(td.gpxPath, td.date);
    }
  }

  // Load tour-level metadata
  const tourMeta = new Map<string, { name: string; description?: string; renderedDescription?: string; country?: string }>();
  for (const tour of tours) {
    const indexPath = path.join(ridesDir, tour.dirPath, 'index.md');
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, 'utf-8');
      const { data: fm, content } = matter(raw);
      const description = content.trim() || undefined;
      const renderedDescription = description ? await renderMarkdownHtml(description) : undefined;
      tourMeta.set(tour.slug, {
        name: (fm.name as string) || tour.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description,
        renderedDescription,
        country: fm.country as string | undefined,
      });
    } else {
      tourMeta.set(tour.slug, {
        name: tour.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      });
    }
  }

  const rides: AdminRide[] = [];
  const details: Record<string, AdminRideDetail> = {};

  // Track per-ride data for tour aggregation
  const ridesByTour = new Map<string, Array<{ slug: string; date: string; distance_km: number; elevation_m: number; country?: string }>>();

  // Load persistent disk cache
  const diskCache = readContentCache<CachedRideData>(rideCachePath(), RIDE_CACHE_VERSION);
  const updatedEntries: Record<string, ContentCacheEntry<CachedRideData>> = {};
  let cacheHits = 0;

  for (const gpxRelPath of gpxPaths) {
    const tourInfo = tourByGpxPath.get(gpxRelPath);

    // Compute file digest for cache lookup
    const gpxAbsPath = path.join(ridesDir, gpxRelPath);
    const sidecarPath = gpxAbsPath.replace(/\.gpx$/i, '.md');
    const mediaYmlPath = gpxAbsPath.replace(/\.gpx$/i, '-media.yml');
    const digest = computeFileDigest([gpxAbsPath, sidecarPath, mediaYmlPath]);

    // Compute slug early for cache key
    const date = adjustedDates.get(gpxRelPath) || extractDateFromPath(gpxRelPath);
    if (!date) continue;
    const gpxFilename = path.basename(gpxRelPath);
    const slug = buildSlug(date, gpxFilename, !!tourInfo);

    // Check disk cache
    const cached = diskCache.entries[slug];
    if (cached && cached.digest === digest) {
      rides.push(cached.data.ride);
      details[slug] = cached.data.detail;
      if (cached.data.tourAggData && tourInfo) {
        if (!ridesByTour.has(tourInfo.slug)) ridesByTour.set(tourInfo.slug, []);
        ridesByTour.get(tourInfo.slug)!.push(cached.data.tourAggData);
      }
      updatedEntries[slug] = cached;
      cacheHits++;
      continue;
    }

    // Cache miss — parse the ride
    const parsed = readRideFile(ridesDir, gpxRelPath, tourInfo?.slug);
    if (!parsed) continue;

    const isoDate = rideDateToIso(date);

    // Compute content hash from raw file contents
    const contentHash = computeRideContentHash(
      parsed.rawContents.sidecarMd || '',
      parsed.rawContents.gpxXml,
      parsed.rawContents.mediaYml,
    );

    // Tour info
    const tourSlug = tourInfo?.slug;
    const tourData = tourSlug ? tourMeta.get(tourSlug) : undefined;

    const name = (parsed.frontmatter.name as string) || nameFromFilename(gpxFilename);
    const status = (parsed.frontmatter.status as string) || 'published';
    const country = (parsed.frontmatter.country as string)
      || (tourData?.country)
      || undefined;
    const highlight = typeof parsed.frontmatter.highlight === 'boolean'
      ? parsed.frontmatter.highlight
      : undefined;
    const tags = Array.isArray(parsed.frontmatter.tags) ? parsed.frontmatter.tags : [];

    const distance_km = Math.round(parsed.gpxTrack.distance_m / 100) / 10;
    const elevation_m = Math.round(parsed.gpxTrack.elevation_gain_m);

    // Include all media (photos and videos)
    const media = parsed.media.map(m => {
      const item: AdminRideDetail['media'][0] = { key: m.key };
      if (m.type != null) item.type = m.type;
      if (m.caption != null) item.caption = m.caption;
      if (m.cover != null) item.cover = m.cover;
      if (m.width != null) item.width = m.width;
      if (m.height != null) item.height = m.height;
      if (m.lat != null) item.lat = m.lat;
      if (m.lng != null) item.lng = m.lng;
      if (m.title != null) item.title = m.title;
      if (m.handle != null) item.handle = m.handle;
      if (m.duration != null) item.duration = m.duration;
      if (m.orientation != null) item.orientation = m.orientation;
      return item;
    });

    const ride: AdminRide = {
      slug: parsed.slug,
      name,
      date: isoDate,
      distance_km,
      elevation_m,
      country,
      tour_slug: tourSlug,
      highlight,
      status,
      contentHash,
    };

    const detail: AdminRideDetail = {
      slug: parsed.slug,
      name,
      tagline: (parsed.frontmatter.tagline as string) || '',
      tags,
      status,
      body: parsed.body,
      media,
      variants: [{
        name,
        gpx: gpxFilename,
        distance_km,
      }],
      contentHash,
      ride_date: isoDate,
      country,
      tour_slug: tourSlug,
      highlight,
      elapsed_time_s: parsed.gpxTrack.elapsed_time_s || undefined,
      moving_time_s: parsed.gpxTrack.moving_time_s || undefined,
      average_speed_kmh: parsed.gpxTrack.average_speed_kmh || undefined,
      gpxRelativePath: gpxRelPath,
    };

    rides.push(ride);
    details[parsed.slug] = detail;

    // Collect data for tour aggregation
    const tourAggData = tourSlug
      ? { slug: parsed.slug, date: isoDate, distance_km, elevation_m, country }
      : null;
    if (tourSlug) {
      if (!ridesByTour.has(tourSlug)) {
        ridesByTour.set(tourSlug, []);
      }
      ridesByTour.get(tourSlug)!.push(tourAggData!);
    }

    // Store in updated cache
    updatedEntries[slug] = { digest, data: { ride, detail, tourAggData } };
  }

  // Persist updated cache
  writeContentCache(rideCachePath(), RIDE_CACHE_VERSION, updatedEntries);
  const total = Object.keys(updatedEntries).length;
  if (total > 0) {
    console.log(`admin-rides: ${cacheHits}/${total} cache hits (${total - cacheHits} parsed)`);
  }

  // Sort rides by date descending (newest first)
  rides.sort((a, b) => b.date.localeCompare(a.date));

  // Build tour aggregates
  const adminTours: AdminTour[] = [];
  for (const tour of tours) {
    const tourRides = ridesByTour.get(tour.slug) || [];
    if (tourRides.length === 0) continue;

    const meta = tourMeta.get(tour.slug)!;
    const sortedRides = [...tourRides].sort((a, b) => a.date.localeCompare(b.date));
    const countries = [...new Set(sortedRides.map(r => r.country).filter((c): c is string => !!c))];

    const startDate = sortedRides[0].date;
    const endDate = sortedRides[sortedRides.length - 1].date;

    // Count unique dates for days
    const uniqueDates = new Set(sortedRides.map(r => r.date));

    adminTours.push({
      slug: tour.slug,
      name: meta.name,
      description: meta.description,
      renderedDescription: meta.renderedDescription,
      total_distance_km: Math.round(sortedRides.reduce((sum, r) => sum + r.distance_km, 0) * 10) / 10,
      total_elevation_m: sortedRides.reduce((sum, r) => sum + r.elevation_m, 0),
      days: uniqueDates.size,
      ride_count: sortedRides.length,
      countries,
      start_date: startDate,
      end_date: endDate,
      rides: sortedRides.map(r => r.slug),
    });
  }

  // Sort tours by start_date descending
  adminTours.sort((a, b) => b.start_date.localeCompare(a.start_date));

  // Build stats
  const stats = buildStats(rides, adminTours, details);

  cachedRideData = { rides, details, tours: adminTours, stats };
  return cachedRideData;
}

function emptyStats(): RideStats {
  return {
    total_distance_km: 0,
    total_elevation_m: 0,
    total_rides: 0,
    total_tours: 0,
    total_days: 0,
    countries: [],
    by_year: {},
    by_country: {},
    records: {},
  };
}

function buildStats(
  rides: AdminRide[],
  tours: AdminTour[],
  details: Record<string, AdminRideDetail>,
): RideStats {
  if (rides.length === 0) return emptyStats();

  const totalDistance = Math.round(rides.reduce((sum, r) => sum + r.distance_km, 0) * 10) / 10;
  const totalElevation = rides.reduce((sum, r) => sum + r.elevation_m, 0);
  const uniqueDates = new Set(rides.map(r => r.date));
  const countries = [...new Set(rides.map(r => r.country).filter((c): c is string => !!c))].sort();

  const byYear: Record<string, { rides: number; distance_km: number; elevation_m: number }> = {};
  const byCountry: Record<string, { rides: number; distance_km: number }> = {};

  for (const ride of rides) {
    const year = ride.date.slice(0, 4);
    if (!byYear[year]) {
      byYear[year] = { rides: 0, distance_km: 0, elevation_m: 0 };
    }
    byYear[year].rides++;
    byYear[year].distance_km = Math.round((byYear[year].distance_km + ride.distance_km) * 10) / 10;
    byYear[year].elevation_m += ride.elevation_m;

    if (ride.country) {
      if (!byCountry[ride.country]) {
        byCountry[ride.country] = { rides: 0, distance_km: 0 };
      }
      byCountry[ride.country].rides++;
      byCountry[ride.country].distance_km = Math.round((byCountry[ride.country].distance_km + ride.distance_km) * 10) / 10;
    }
  }

  // Records
  const longestRide = rides.reduce((max, r) => r.distance_km > (max?.distance_km || 0) ? r : max, rides[0]);
  const mostElevation = rides.reduce((max, r) => r.elevation_m > (max?.elevation_m || 0) ? r : max, rides[0]);
  const longestTour = tours.length > 0
    ? tours.reduce((max, t) => t.total_distance_km > (max?.total_distance_km || 0) ? t : max, tours[0])
    : undefined;

  return {
    total_distance_km: totalDistance,
    total_elevation_m: totalElevation,
    total_rides: rides.length,
    total_tours: tours.length,
    total_days: uniqueDates.size,
    countries,
    by_year: byYear,
    by_country: byCountry,
    records: {
      longest_ride: longestRide ? { slug: longestRide.slug, name: longestRide.name, distance_km: longestRide.distance_km, tour_slug: longestRide.tour_slug } : undefined,
      most_elevation: mostElevation ? { slug: mostElevation.slug, name: mostElevation.name, elevation_m: mostElevation.elevation_m, tour_slug: mostElevation.tour_slug } : undefined,
      longest_tour: longestTour ? { slug: longestTour.slug, name: longestTour.name, distance_km: longestTour.total_distance_km, days: longestTour.days } : undefined,
    },
  };
}
