// admin-organizers.ts — Admin virtual module loader for organizers.
//
// Reads organizer .md files from the content directory, parses frontmatter,
// and produces data for the virtual module system.
//
// Data flow:
//   content files → admin-organizers.ts → build-data-plugin.ts
//     → virtual:bike-app/admin-organizers (list)
//     → virtual:bike-app/admin-organizer-detail (detail)

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { cityDir } from '../lib/config/config.server';
import { computeOrganizerContentHash, parseOrganizerFile } from '../lib/models/organizer-model.server';
import type { OrganizerDetail } from '../lib/models/organizer-model';
import type { AdminOrganizer } from '../types/admin';

const CITY_DIR = cityDir;

export async function loadAdminOrganizers(): Promise<{
  list: AdminOrganizer[];
  details: Record<string, OrganizerDetail>;
}> {
  const orgDir = path.join(CITY_DIR, 'organizers');
  if (!fs.existsSync(orgDir)) return { list: [], details: {} };

  const organizers: AdminOrganizer[] = [];
  const details: Record<string, OrganizerDetail> = {};

  for (const file of fs.readdirSync(orgDir)) {
    if (!file.endsWith('.md')) continue;
    const parts = file.replace('.md', '').split('.');
    if (parts.length > 1) continue;

    const slug = file.replace('.md', '');
    const raw = fs.readFileSync(path.join(orgDir, file), 'utf-8');
    const contentHash = computeOrganizerContentHash(raw);
    const { data: fm, content: body } = matter(raw);

    organizers.push({
      slug,
      name: fm.name as string,
      tagline: fm.tagline as string | undefined,
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      featured: !!fm.featured,
      website: fm.website as string | undefined,
      instagram: fm.instagram as string | undefined,
      ics_url: fm.ics_url as string | undefined,
      photo_key: fm.photo_key as string | undefined,
      photo_content_type: fm.photo_content_type as string | undefined,
      photo_width: fm.photo_width as number | undefined,
      photo_height: fm.photo_height as number | undefined,
      hasBody: body.trim().length > 50,
      social_links: Array.isArray(fm.social_links) ? fm.social_links as Array<{ platform: string; url: string }> : undefined,
      contentHash,
    });

    const detail = parseOrganizerFile(slug, raw);
    details[slug] = { ...detail, contentHash };
  }

  organizers.sort((a, b) => a.name.localeCompare(b.name));
  return { list: organizers, details };
}
