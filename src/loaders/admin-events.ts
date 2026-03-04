import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { cityDir } from '../lib/config';
import type { AdminEvent, AdminEventDetail, AdminOrganizerRef } from '../types/admin';

const CITY_DIR = cityDir;

export async function loadAdminEvents(): Promise<AdminEvent[]> {
  const eventsDir = path.join(CITY_DIR, 'events');
  if (!fs.existsSync(eventsDir)) return [];

  const events: AdminEvent[] = [];

  for (const yearDir of fs.readdirSync(eventsDir).sort().reverse()) {
    const yearPath = path.join(eventsDir, yearDir);
    if (!fs.statSync(yearPath).isDirectory()) continue;

    for (const file of fs.readdirSync(yearPath)) {
      if (!file.endsWith('.md')) continue;
      // Skip translation files like event.fr.md
      const parts = file.replace('.md', '').split('.');
      if (parts.length > 1) continue;

      const slug = file.replace('.md', '');
      const filePath = path.join(yearPath, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const contentHash = createHash('md5').update(raw).digest('hex');
      const { data: fm } = matter(raw);

      events.push({
        id: `${yearDir}/${slug}`,
        slug,
        year: yearDir,
        name: fm.name as string,
        start_date: fm.start_date as string,
        end_date: fm.end_date as string | undefined,
        organizer: fm.organizer as string | AdminOrganizerRef | undefined,
        poster_key: fm.poster_key as string | undefined,
        contentHash,
      });
    }
  }

  // Sort by start_date descending (newest first)
  events.sort((a, b) => b.start_date.localeCompare(a.start_date));
  return events;
}

export async function loadAdminEventDetails(): Promise<Record<string, AdminEventDetail>> {
  const eventsDir = path.join(CITY_DIR, 'events');
  if (!fs.existsSync(eventsDir)) return {};

  const details: Record<string, AdminEventDetail> = {};

  for (const yearDir of fs.readdirSync(eventsDir)) {
    const yearPath = path.join(eventsDir, yearDir);
    if (!fs.statSync(yearPath).isDirectory()) continue;

    for (const file of fs.readdirSync(yearPath)) {
      if (!file.endsWith('.md')) continue;
      const parts = file.replace('.md', '').split('.');
      if (parts.length > 1) continue;

      const slug = file.replace('.md', '');
      const id = `${yearDir}/${slug}`;
      const filePath = path.join(yearPath, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const contentHash = createHash('md5').update(raw).digest('hex');
      const { data: fm, content: body } = matter(raw);

      details[id] = {
        id,
        slug,
        year: yearDir,
        name: fm.name as string,
        start_date: fm.start_date as string,
        start_time: fm.start_time as string | undefined,
        end_date: fm.end_date as string | undefined,
        end_time: fm.end_time as string | undefined,
        registration_url: fm.registration_url as string | undefined,
        distances: fm.distances as string | undefined,
        location: fm.location as string | undefined,
        review_url: fm.review_url as string | undefined,
        organizer: fm.organizer as string | AdminOrganizerRef | undefined,
        poster_key: fm.poster_key as string | undefined,
        poster_content_type: fm.poster_content_type as string | undefined,
        body: body.trim(),
        contentHash,
      };
    }
  }

  return details;
}
