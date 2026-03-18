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
import yaml from 'js-yaml';
import { cityDir } from '../lib/config/config.server';
import type { AdminEvent } from '../types/admin';
import { eventDetailFromGit, computeEventContentHash } from '../lib/models/event-model.server';
import type { EventDetail } from '../lib/models/event-model';

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

/** Load a flat .md event file. */
function loadFlatEvent(yearDir: string, slug: string, filePath: string): {
  event: AdminEvent;
  detail: EventDetail & { contentHash: string };
} {
  const id = `${yearDir}/${slug}`;
  const raw = fs.readFileSync(filePath, 'utf-8');
  const contentHash = computeEventContentHash(raw);
  const { data: fm, content: body } = matter(raw);

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
    previous_event: fm.previous_event as string | undefined,
    edition: fm.edition as string | undefined,
    event_url: fm.event_url as string | undefined,
    map_url: fm.map_url as string | undefined,
    mediaCount: 0,
    waypointCount: Array.isArray(fm.waypoints) ? fm.waypoints.length : 0,
    contentHash,
    is_series: !!fm.series,
    meet_time: fm.meet_time as string | undefined,
    series_label: buildSeriesLabel(fm.series),
  };

  const detail = eventDetailFromGit(id, fm, body.trim());
  return { event, detail: { ...detail, contentHash } };
}

/** Load a directory-based event (slug/ with index.md + optional media.yml). */
function loadDirectoryEvent(yearDir: string, slug: string, eventDir: string): {
  event: AdminEvent;
  detail: EventDetail & { contentHash: string };
} {
  const id = `${yearDir}/${slug}`;
  const indexPath = path.join(eventDir, 'index.md');
  const raw = fs.readFileSync(indexPath, 'utf-8');

  const mediaPath = path.join(eventDir, 'media.yml');
  let mediaYml: string | undefined;
  let mediaCount = 0;
  if (fs.existsSync(mediaPath)) {
    mediaYml = fs.readFileSync(mediaPath, 'utf-8');
    const parsed = yaml.load(mediaYml);
    if (Array.isArray(parsed)) mediaCount = parsed.length;
  }

  const contentHash = computeEventContentHash(raw, mediaYml);
  const { data: fm, content: body } = matter(raw);

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
    previous_event: fm.previous_event as string | undefined,
    edition: fm.edition as string | undefined,
    event_url: fm.event_url as string | undefined,
    map_url: fm.map_url as string | undefined,
    mediaCount,
    waypointCount: Array.isArray(fm.waypoints) ? fm.waypoints.length : 0,
    contentHash,
    is_series: !!fm.series,
    meet_time: fm.meet_time as string | undefined,
    series_label: buildSeriesLabel(fm.series),
  };

  const detail = eventDetailFromGit(id, fm, body.trim(), mediaYml);
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

        const { event, detail } = loadDirectoryEvent(yearDir, entry, entryPath);
        events.push(event);
        details[event.id] = detail;
      } else if (entry.endsWith('.md')) {
        // Flat .md event — skip translation files like event.fr.md
        const parts = entry.replace('.md', '').split('.');
        if (parts.length > 1) continue;

        const slug = entry.replace('.md', '');
        const { event, detail } = loadFlatEvent(yearDir, slug, entryPath);
        events.push(event);
        details[event.id] = detail;
      }
    }
  }

  // Sort by start_date descending (newest first)
  events.sort((a, b) => b.start_date.localeCompare(a.start_date));
  cachedEventData = { events, details };
  return cachedEventData;
}
