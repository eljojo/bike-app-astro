// admin-events.ts — Admin virtual module loader for events.
//
// Reads event files (flat .md or directory-based year/slug/) from the
// content directory, parses frontmatter and media, and produces data
// for the virtual module system.
//
// Data flow:
//   content files → admin-events.ts → build-data-plugin.ts
//     → virtual:bike-app/admin-events (list)
//     → virtual:bike-app/admin-event-detail (details)
//
// Events use Astro's built-in glob loader for public pages, so there is
// no shared file reader — the admin loader reads files directly.

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import * as yaml from 'js-yaml';
import { cityDir } from '../lib/config/config.server';
import type { AdminEvent } from '../types/admin';
import { eventDetailFromGit, computeEventContentHash } from '../lib/models/event-model.server';
import type { EventDetail, EventSeries } from '../lib/models/event-model';

const CITY_DIR = cityDir;

function buildSeriesLabel(series: unknown): string | undefined {
  if (!series || typeof series !== 'object') return undefined;
  const s = series as Record<string, unknown>;
  if (s.recurrence && s.recurrence_day) {
    const day = String(s.recurrence_day);
    const capitalized = day.charAt(0).toUpperCase() + day.slice(1);
    const prefix = s.recurrence === 'biweekly' ? 'Every other' : 'Every';
    return `${prefix} ${capitalized}`;
  }
  if (Array.isArray(s.schedule) && s.schedule.length > 0) {
    return `${s.schedule.length} dates`;
  }
  return undefined;
}

interface AdminEventData {
  events: AdminEvent[];
  details: Record<string, EventDetail & { contentHash: string }>;
}

let cachedEventData: AdminEventData | null = null;

/** Load a flat .md event file. Returns null when the frontmatter is unparseable. */
function loadFlatEvent(yearDir: string, slug: string, filePath: string): {
  event: AdminEvent;
  detail: EventDetail & { contentHash: string };
} | null {
  const id = `${yearDir}/${slug}`;
  const raw = fs.readFileSync(filePath, 'utf-8');
  const contentHash = computeEventContentHash(raw);
  let fm: Record<string, unknown>;
  let body: string;
  try {
    // `{}` bypasses gray-matter's cache: it caches the file object BEFORE
    // parsing, so a string that threw once later returns an empty shell
    // instead of re-throwing — which would silently defeat this catch.
    const parsed = matter(raw, {});
    fm = parsed.data;
    body = parsed.content;
  } catch (err) {
    // Malformed community-edited frontmatter degrades to one skipped event,
    // not a dead build. IO errors are not caught here.
    console.error(
      `[admin-event-loader] Malformed frontmatter in event "${id}" (${filePath}): ${(err as Error).message} — skipping event`,
    );
    return null;
  }

  const event: AdminEvent = {
    id,
    slug,
    year: yearDir,
    name: fm.name as string,
    start_date: fm.start_date as string,
    end_date: fm.end_date as string | undefined,
    status: fm.status as string | undefined,
    routes: (fm.routes as string[]) ?? [],
    organizer: fm.organizer as string | { name: string; website?: string; instagram?: string } | undefined,
    poster_key: fm.poster_key as string | undefined,
    poster_width: fm.poster_width as number | undefined,
    poster_height: fm.poster_height as number | undefined,
    tags: (fm.tags as string[]) ?? [],
    past_slugs: Array.isArray(fm.past_slugs) ? fm.past_slugs as string[] : undefined,
    previous_event: fm.previous_event as string | undefined,
    edition: fm.edition as string | undefined,
    ics_uid: fm.ics_uid as string | undefined,
    event_url: fm.event_url as string | undefined,
    map_url: fm.map_url as string | undefined,
    hasBody: body.trim().length > 50,
    mediaCount: 0,
    waypointCount: Array.isArray(fm.waypoints) ? fm.waypoints.length : 0,
    contentHash,
    is_series: !!fm.series,
    meet_time: fm.meet_time as string | undefined,
    series_label: buildSeriesLabel(fm.series),
    series: fm.series as EventSeries | undefined,
  };

  const detail = eventDetailFromGit(id, fm, body.trim());
  return { event, detail: { ...detail, contentHash } };
}

/**
 * Load a directory-based event (slug/ with index.md + optional media.yml).
 * Returns null when index.md's frontmatter is unparseable.
 */
function loadDirectoryEvent(yearDir: string, slug: string, eventDir: string): {
  event: AdminEvent;
  detail: EventDetail & { contentHash: string };
} | null {
  const id = `${yearDir}/${slug}`;
  const indexPath = path.join(eventDir, 'index.md');
  const raw = fs.readFileSync(indexPath, 'utf-8');

  const mediaPath = path.join(eventDir, 'media.yml');
  let mediaYml: string | undefined;
  // Withheld from eventDetailFromGit when unparseable — it would throw there
  // too. The raw text still feeds the hash, so conflict detection keeps
  // matching what the save pipeline computes off the same bytes.
  let parseableMediaYml: string | undefined;
  let mediaCount = 0;
  if (fs.existsSync(mediaPath)) {
    mediaYml = fs.readFileSync(mediaPath, 'utf-8');
    try {
      const parsed = yaml.load(mediaYml);
      if (Array.isArray(parsed)) mediaCount = parsed.length;
      parseableMediaYml = mediaYml;
    } catch (err) {
      console.error(
        `[admin-event-loader] Malformed media.yml in event "${id}" (${mediaPath}): ${(err as Error).message} — ignoring media`,
      );
    }
  }

  const contentHash = computeEventContentHash(raw, mediaYml);
  let fm: Record<string, unknown>;
  let body: string;
  try {
    // `{}` bypasses gray-matter's cache: it caches the file object BEFORE
    // parsing, so a string that threw once later returns an empty shell
    // instead of re-throwing — which would silently defeat this catch.
    const parsed = matter(raw, {});
    fm = parsed.data;
    body = parsed.content;
  } catch (err) {
    console.error(
      `[admin-event-loader] Malformed frontmatter in event "${id}" (${indexPath}): ${(err as Error).message} — skipping event`,
    );
    return null;
  }

  const event: AdminEvent = {
    id,
    slug,
    year: yearDir,
    name: fm.name as string,
    start_date: fm.start_date as string,
    end_date: fm.end_date as string | undefined,
    status: fm.status as string | undefined,
    routes: (fm.routes as string[]) ?? [],
    organizer: fm.organizer as string | { name: string; website?: string; instagram?: string } | undefined,
    poster_key: fm.poster_key as string | undefined,
    poster_width: fm.poster_width as number | undefined,
    poster_height: fm.poster_height as number | undefined,
    tags: (fm.tags as string[]) ?? [],
    past_slugs: Array.isArray(fm.past_slugs) ? fm.past_slugs as string[] : undefined,
    previous_event: fm.previous_event as string | undefined,
    edition: fm.edition as string | undefined,
    ics_uid: fm.ics_uid as string | undefined,
    event_url: fm.event_url as string | undefined,
    map_url: fm.map_url as string | undefined,
    hasBody: body.trim().length > 50,
    mediaCount,
    waypointCount: Array.isArray(fm.waypoints) ? fm.waypoints.length : 0,
    contentHash,
    is_series: !!fm.series,
    meet_time: fm.meet_time as string | undefined,
    series_label: buildSeriesLabel(fm.series),
    series: fm.series as EventSeries | undefined,
  };

  const detail = eventDetailFromGit(id, fm, body.trim(), parseableMediaYml);
  return { event, detail: { ...detail, contentHash } };
}

export async function loadAdminEventData(): Promise<AdminEventData> {
  if (cachedEventData) return cachedEventData;

  const eventsDir = path.join(CITY_DIR, 'events');
  if (!fs.existsSync(eventsDir)) {
    cachedEventData = { events: [], details: {} };
    return cachedEventData;
  }

  const events: AdminEvent[] = [];
  const details: Record<string, EventDetail & { contentHash: string }> = {};

  for (const yearDir of fs.readdirSync(eventsDir).sort().reverse()) {
    const yearPath = path.join(eventsDir, yearDir);
    if (!fs.statSync(yearPath).isDirectory()) continue;

    for (const entry of fs.readdirSync(yearPath)) {
      const entryPath = path.join(yearPath, entry);
      const stat = fs.statSync(entryPath);

      if (stat.isDirectory()) {
        // Directory-based event: slug/ with index.md
        const indexPath = path.join(entryPath, 'index.md');
        if (!fs.existsSync(indexPath)) continue;

        const loaded = loadDirectoryEvent(yearDir, entry, entryPath);
        if (!loaded) continue;
        events.push(loaded.event);
        details[loaded.event.id] = loaded.detail;
      } else if (entry.endsWith('.md')) {
        // Flat .md event — skip translation files like event.fr.md
        const parts = entry.replace('.md', '').split('.');
        if (parts.length > 1) continue;

        const slug = entry.replace('.md', '');
        const loaded = loadFlatEvent(yearDir, slug, entryPath);
        if (!loaded) continue;
        events.push(loaded.event);
        details[loaded.event.id] = loaded.detail;
      }
    }
  }

  // Sort by start_date descending (newest first). Coerced because an unquoted
  // `start_date: 2026-05-01` parses as a Date, not a string — one such file
  // would otherwise take down the whole build here.
  events.sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  cachedEventData = { events, details };
  return cachedEventData;
}
