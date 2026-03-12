import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { cityDir } from '../lib/config';
import { parseGpx } from '../lib/gpx';
import { renderMarkdownHtml } from '../lib/markdown-render';
import type { RouteMedia } from './routes';
import { computeRideContentHash } from '../lib/models/ride-model';
import {
  extractDateFromPath,
  detectTours,
  findGpxFiles,
  buildSlug,
  rideDateToIso,
  nameFromFilename,
} from './rides';

const CITY_DIR = cityDir;

export interface AdminRide {
  slug: string;
  name: string;
  date: string;
  distance_km: number;
  elevation_m: number;
  country?: string;
  tour_slug?: string;
  highlight?: boolean;
  contentHash: string;
}

export interface AdminRideDetail {
  slug: string;
  name: string;
  tagline: string;
  tags: string[];
  status: string;
  body: string;
  media: Array<{ key: string; caption?: string; cover?: boolean; width?: number; height?: number; lat?: number; lng?: number }>;
  variants: Array<{ name: string; gpx: string; distance_km?: number }>;
  contentHash: string;
  ride_date: string;
  country?: string;
  tour_slug?: string;
  highlight?: boolean;
  elapsed_time_s?: number;
  moving_time_s?: number;
  average_speed_kmh?: number;
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
    longest_ride?: { slug: string; name: string; distance_km: number };
    most_elevation?: { slug: string; name: string; elevation_m: number };
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

  const ridesDir = path.join(CITY_DIR, 'rides');
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

  for (const gpxRelPath of gpxPaths) {
    const date = extractDateFromPath(gpxRelPath);
    if (!date) continue;

    const gpxFilename = path.basename(gpxRelPath);
    const gpxAbsPath = path.join(ridesDir, gpxRelPath);
    const isoDate = rideDateToIso(date);

    // Load optional sidecar .md (needed before slug generation for handle field)
    const sidecarPath = gpxAbsPath.replace(/\.gpx$/i, '.md');
    let sidecarFrontmatter: Record<string, unknown> = {};
    let body = '';
    let sidecarContent: string | undefined;
    if (fs.existsSync(sidecarPath)) {
      sidecarContent = fs.readFileSync(sidecarPath, 'utf-8');
      const parsed = matter(sidecarContent);
      sidecarFrontmatter = parsed.data;
      body = parsed.content.trim();
    }

    const slug = buildSlug(date, gpxFilename, sidecarFrontmatter.handle as string | undefined);

    // Parse GPX
    let gpxContent: string;
    try {
      gpxContent = fs.readFileSync(gpxAbsPath, 'utf-8');
    } catch {
      continue;
    }

    let gpxTrack;
    try {
      gpxTrack = parseGpx(gpxContent);
    } catch {
      continue;
    }

    // Load optional -media.yml
    const mediaYmlPath = gpxAbsPath.replace(/\.gpx$/i, '-media.yml');
    let media: RouteMedia[] = [];
    let mediaContent: string | undefined;
    if (fs.existsSync(mediaYmlPath)) {
      mediaContent = fs.readFileSync(mediaYmlPath, 'utf-8');
      media = (yaml.load(mediaContent) as RouteMedia[]) || [];
    }

    // Tour info
    const tourInfo = tourByGpxPath.get(gpxRelPath);
    const tourSlug = tourInfo?.slug;
    const tourData = tourSlug ? tourMeta.get(tourSlug) : undefined;


    const name = (sidecarFrontmatter.name as string) || nameFromFilename(gpxFilename);
    const status = (sidecarFrontmatter.status as string) || 'published';
    const country = (sidecarFrontmatter.country as string)
      || (tourData?.country)
      || undefined;
    const highlight = typeof sidecarFrontmatter.highlight === 'boolean'
      ? sidecarFrontmatter.highlight
      : undefined;
    const tags = Array.isArray(sidecarFrontmatter.tags) ? sidecarFrontmatter.tags : [];

    const distance_km = Math.round(gpxTrack.distance_m / 100) / 10;
    const elevation_m = Math.round(gpxTrack.elevation_gain_m);

    const contentHash = computeRideContentHash(sidecarContent || '', gpxContent, mediaContent);

    // Filter media to photos only (matching route pattern)
    const photoMedia = media
      .filter(m => m.type === 'photo')
      .map(m => {
        const item: AdminRideDetail['media'][0] = { key: m.key };
        if (m.caption != null) item.caption = m.caption;
        if (m.cover != null) item.cover = m.cover;
        if (m.width != null) item.width = m.width;
        if (m.height != null) item.height = m.height;
        if (m.lat != null) item.lat = m.lat;
        if (m.lng != null) item.lng = m.lng;
        return item;
      });

    rides.push({
      slug,
      name,
      date: isoDate,
      distance_km,
      elevation_m,
      country,
      tour_slug: tourSlug,
      highlight,
      contentHash,
    });

    details[slug] = {
      slug,
      name,
      tagline: (sidecarFrontmatter.tagline as string) || '',
      tags,
      status,
      body,
      media: photoMedia,
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
      elapsed_time_s: gpxTrack.elapsed_time_s || undefined,
      moving_time_s: gpxTrack.moving_time_s || undefined,
      average_speed_kmh: gpxTrack.average_speed_kmh || undefined,
      gpxRelativePath: gpxRelPath,
    };

    // Collect data for tour aggregation
    if (tourSlug) {
      if (!ridesByTour.has(tourSlug)) {
        ridesByTour.set(tourSlug, []);
      }
      ridesByTour.get(tourSlug)!.push({ slug, date: isoDate, distance_km, elevation_m, country });
    }
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
      longest_ride: longestRide ? { slug: longestRide.slug, name: longestRide.name, distance_km: longestRide.distance_km } : undefined,
      most_elevation: mostElevation ? { slug: mostElevation.slug, name: mostElevation.name, elevation_m: mostElevation.elevation_m } : undefined,
      longest_tour: longestTour ? { slug: longestTour.slug, name: longestTour.name, distance_km: longestTour.total_distance_km, days: longestTour.days } : undefined,
    },
  };
}
