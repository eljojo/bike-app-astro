// admin-organizers.ts — Admin virtual module loader for organizers.
//
// Reads organizer .md files from the content directory, parses frontmatter,
// and produces data for the virtual module system.
//
// Data flow:
//   content files → admin-organizers.ts → build-data-plugin.ts
//     → virtual:bike-app/admin-organizers (list)

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { cityDir } from '../lib/config/config.server';
import type { AdminOrganizer } from '../types/admin';

const CITY_DIR = cityDir;

export async function loadAdminOrganizers(): Promise<AdminOrganizer[]> {
  const orgDir = path.join(CITY_DIR, 'organizers');
  if (!fs.existsSync(orgDir)) return [];

  const organizers: AdminOrganizer[] = [];

  for (const file of fs.readdirSync(orgDir)) {
    if (!file.endsWith('.md')) continue;
    const parts = file.replace('.md', '').split('.');
    if (parts.length > 1) continue;

    const slug = file.replace('.md', '');
    const raw = fs.readFileSync(path.join(orgDir, file), 'utf-8');
    const { data: fm } = matter(raw);

    organizers.push({
      slug,
      name: fm.name as string,
      website: fm.website as string | undefined,
      instagram: fm.instagram as string | undefined,
    });
  }

  organizers.sort((a, b) => a.name.localeCompare(b.name));
  return organizers;
}
