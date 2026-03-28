// admin-bike-paths.ts — Admin virtual module loader for bike paths.
//
// Reads bike-path .md files from the content directory, parses frontmatter,
// and produces data for the virtual module system.
//
// Data flow:
//   content files → admin-bike-paths.ts → build-data-plugin.ts
//     → virtual:bike-app/admin-bike-paths (list)
//     → virtual:bike-app/admin-bike-path-detail (details)

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { cityDir } from '../lib/config/config.server';
import type { AdminBikePath } from '../types/admin';
import type { BikePathDetail } from '../lib/models/bike-path-model';

const CITY_DIR = cityDir;

interface AdminBikePathData {
  bikePaths: AdminBikePath[];
  details: Record<string, BikePathDetail & { contentHash: string }>;
}

let cachedData: AdminBikePathData | null = null;

function computeContentHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export async function loadAdminBikePathData(): Promise<AdminBikePathData> {
  if (cachedData) return cachedData;

  const bikePathsDir = path.join(CITY_DIR, 'bike-paths');
  if (!fs.existsSync(bikePathsDir)) {
    cachedData = { bikePaths: [], details: {} };
    return cachedData;
  }

  const bikePaths: AdminBikePath[] = [];
  const details: Record<string, BikePathDetail & { contentHash: string }> = {};

  for (const file of fs.readdirSync(bikePathsDir)) {
    if (!file.endsWith('.md')) continue;
    // Skip translation files like path.fr.md
    const parts = file.replace('.md', '').split('.');
    if (parts.length > 1) continue;

    const id = file.replace('.md', '');
    const filePath = path.join(bikePathsDir, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const contentHash = computeContentHash(raw);
    const { data: fm, content: body } = matter(raw);

    bikePaths.push({
      id,
      name: (fm.name as string) || id,
      vibe: fm.vibe as string | undefined,
      hidden: (fm.hidden as boolean) || false,
      includes: (fm.includes as string[]) || [],
      tags: (fm.tags as string[]) || [],
      contentHash,
    });

    details[id] = {
      id,
      name: fm.name as string | undefined,
      name_fr: fm.name_fr as string | undefined,
      vibe: fm.vibe as string | undefined,
      hidden: (fm.hidden as boolean) || false,
      stub: (fm.stub as boolean) || false,
      featured: (fm.featured as boolean) || false,
      includes: (fm.includes as string[]) || [],
      photo_key: fm.photo_key as string | undefined,
      tags: (fm.tags as string[]) || [],
      body: body.trim(),
      contentHash,
    };
  }

  // Sort by name
  bikePaths.sort((a, b) => a.name.localeCompare(b.name));
  cachedData = { bikePaths, details };
  return cachedData;
}
