import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { cityDir } from '../lib/config';
import type { AdminEvent } from '../types/admin';
import { eventDetailFromGit, computeEventContentHash, type EventDetail } from '../lib/models/event-model';

const CITY_DIR = cityDir;

interface AdminEventData {
  events: AdminEvent[];
  details: Record<string, EventDetail & { contentHash: string }>;
}

let cachedEventData: AdminEventData | null = null;

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

    for (const file of fs.readdirSync(yearPath)) {
      if (!file.endsWith('.md')) continue;
      // Skip translation files like event.fr.md
      const parts = file.replace('.md', '').split('.');
      if (parts.length > 1) continue;

      const slug = file.replace('.md', '');
      const id = `${yearDir}/${slug}`;
      const filePath = path.join(yearPath, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const contentHash = computeEventContentHash(raw);
      const { data: fm, content: body } = matter(raw);

      events.push({
        id,
        slug,
        year: yearDir,
        name: fm.name as string,
        start_date: fm.start_date as string,
        end_date: fm.end_date as string | undefined,
        organizer: fm.organizer as string | { name: string; website?: string; instagram?: string } | undefined,
        poster_key: fm.poster_key as string | undefined,
        contentHash,
      });

      const detail = eventDetailFromGit(id, fm, body.trim());
      details[id] = { ...detail, contentHash };
    }
  }

  // Sort by start_date descending (newest first)
  events.sort((a, b) => b.start_date.localeCompare(a.start_date));
  cachedEventData = { events, details };
  return cachedEventData;
}

