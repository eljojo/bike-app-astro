/**
 * Migration script: date-prefix all standalone ride slugs.
 *
 * Usage: npx tsx scripts/migrate-ride-slugs.ts [--dry-run] [rides-dir]
 *
 * - Sets handle: YYYY-MM-DD-clean-name in sidecar .md files
 * - Replaces rides: section in redirects.yml with all needed redirects
 * - Skips tour rides
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { findGpxFiles, extractDateFromPath, buildSlug, detectTours } from '../src/loaders/rides';
import { cleanSlugName } from '../src/lib/clean-slug-name';

export interface RideDate {
  year: number;
  month: number;
  day: number;
}

export interface RideInfo {
  gpxRelPath: string;
  date: RideDate;
  currentSlug: string;
  isTour: boolean;
}

export interface MigrationEntry {
  gpxRelPath: string;
  newSlug: string;
  handle: string;
  redirects: Array<{ from: string; to: string }>;
}

function formatDate(date: RideDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
}

export function computeMigrationPlan(rides: RideInfo[]): MigrationEntry[] {
  const results: MigrationEntry[] = [];
  const usedSlugs = new Set<string>();

  for (const ride of rides) {
    if (ride.isTour) continue;

    const cleanName = cleanSlugName(ride.currentSlug);
    const datePrefix = formatDate(ride.date);
    // If the slug already starts with this date prefix, don't double-prefix
    let newSlug = cleanName.startsWith(`${datePrefix}-`)
      ? cleanName
      : `${datePrefix}-${cleanName}`;

    // Collision handling: if slug already used, keep the original suffix
    if (usedSlugs.has(newSlug)) {
      // Fall back to date + currentSlug (cleaned of leading dashes only)
      const fallbackName = ride.currentSlug.replace(/^-+/, '');
      newSlug = `${datePrefix}-${fallbackName}`;
    }
    usedSlugs.add(newSlug);

    // Compute all old URL forms that need redirecting
    const redirects: Array<{ from: string; to: string }> = [];
    const oldForms = new Set<string>();

    // 1. Current canonical slug
    oldForms.add(ride.currentSlug);

    // 2. Without leading dash (if current has one)
    if (ride.currentSlug.startsWith('-')) {
      oldForms.add(ride.currentSlug.replace(/^-+/, ''));
    }

    // 3. Old auto-generated date-prefixed form (what integration.ts used to generate)
    // Skip if slug is already date-prefixed (would produce nonsensical double-prefix)
    const strippedSlug = ride.currentSlug.replace(/^-+/, '');
    if (!strippedSlug.startsWith(`${datePrefix}-`)) {
      oldForms.add(`${datePrefix}-${strippedSlug}`);
    }

    // 4. The leading-dash + date form (in case anyone hit that URL)
    if (ride.currentSlug.startsWith('-')) {
      oldForms.add(`${datePrefix}-${ride.currentSlug}`);
    }

    for (const oldSlug of oldForms) {
      if (oldSlug !== newSlug && oldSlug !== '') {
        redirects.push({ from: oldSlug, to: newSlug });
      }
    }

    results.push({
      gpxRelPath: ride.gpxRelPath,
      newSlug,
      handle: newSlug,
      redirects,
    });
  }

  return results;
}

// --- Filesystem operations (only run when script is executed directly) ---

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const ridesDir = args.find(a => !a.startsWith('--')) || path.join(process.cwd(), 'blog/rides');
  const cityDir = path.dirname(ridesDir);

  if (!fs.existsSync(ridesDir)) {
    console.error(`Rides directory not found: ${ridesDir}`);
    process.exit(1);
  }

  console.log(`Processing rides in: ${ridesDir}`);
  console.log(`Dry run: ${dryRun}`);

  // Discover all rides
  const gpxPaths = findGpxFiles(ridesDir);
  const tours = detectTours(gpxPaths);
  const tourGpxPaths = new Set<string>();
  for (const tour of tours) {
    for (const ridePath of tour.ridePaths) {
      tourGpxPaths.add(ridePath);
    }
  }

  // Build ride info list
  const rides: RideInfo[] = [];
  for (const gpxRelPath of gpxPaths) {
    const date = extractDateFromPath(gpxRelPath);
    if (!date) continue;

    const gpxFilename = path.basename(gpxRelPath);
    const gpxAbsPath = path.join(ridesDir, gpxRelPath);

    let handle: string | undefined;
    const sidecarPath = gpxAbsPath.replace(/\.gpx$/i, '.md');
    if (fs.existsSync(sidecarPath)) {
      const { data: fm } = matter(fs.readFileSync(sidecarPath, 'utf-8'));
      handle = fm.handle as string | undefined;
    }

    const currentSlug = buildSlug(date, gpxFilename, handle);
    rides.push({
      gpxRelPath,
      date,
      currentSlug,
      isTour: tourGpxPaths.has(gpxRelPath),
    });
  }

  const plan = computeMigrationPlan(rides);
  console.log(`\nMigration plan: ${plan.length} standalone rides to update`);

  // Summary
  const totalRedirects = plan.reduce((sum, e) => sum + e.redirects.length, 0);
  console.log(`Total redirect entries: ${totalRedirects}`);

  if (dryRun) {
    for (const entry of plan.slice(0, 20)) {
      console.log(`\n  ${entry.gpxRelPath}`);
      console.log(`    handle: ${entry.handle}`);
      for (const r of entry.redirects) {
        console.log(`    redirect: ${r.from} → ${r.to}`);
      }
    }
    if (plan.length > 20) console.log(`  ... and ${plan.length - 20} more`);
    return;
  }

  // Write handle fields to sidecar files
  let created = 0;
  let updated = 0;
  for (const entry of plan) {
    const gpxAbsPath = path.join(ridesDir, entry.gpxRelPath);
    const sidecarPath = gpxAbsPath.replace(/\.gpx$/i, '.md');

    if (fs.existsSync(sidecarPath)) {
      const raw = fs.readFileSync(sidecarPath, 'utf-8');
      const parsed = matter(raw);
      parsed.data.handle = entry.handle;
      const output = matter.stringify(parsed.content, parsed.data);
      fs.writeFileSync(sidecarPath, output);
      updated++;
    } else {
      const output = matter.stringify('', { handle: entry.handle });
      fs.writeFileSync(sidecarPath, output);
      created++;
    }
  }
  console.log(`\nSidecar files: ${updated} updated, ${created} created`);

  // Replace rides: section in redirects.yml
  const redirectsPath = path.join(cityDir, 'redirects.yml');
  const existingContent = fs.existsSync(redirectsPath)
    ? fs.readFileSync(redirectsPath, 'utf-8')
    : '';
  const data = (existingContent ? yaml.load(existingContent) : {}) as Record<string, unknown> || {};

  // Replace rides section entirely
  const allRedirects: Array<{ from: string; to: string }> = [];
  for (const entry of plan) {
    for (const r of entry.redirects) {
      allRedirects.push(r);
    }
  }
  data.rides = allRedirects;

  const newContent = yaml.dump(data, { lineWidth: -1 });
  fs.writeFileSync(redirectsPath, newContent);
  console.log(`Wrote ${allRedirects.length} redirect entries to redirects.yml`);
}

// Run main only when executed directly (not imported for tests)
const isDirectRun = process.argv[1]?.endsWith('migrate-ride-slugs.ts') ||
                    process.argv[1]?.endsWith('migrate-ride-slugs.js');
if (isDirectRun) {
  main();
}
