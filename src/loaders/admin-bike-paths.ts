// admin-bike-paths.ts — Admin virtual module loader for bike paths.
//
// Derives admin data from the canonical loadBikePathEntries() merge function,
// plus reads raw files for content hashes (needed for save conflict detection).
//
// Data flow:
//   loadBikePathEntries() → admin-bike-paths.ts → build-data-plugin.ts
//     → virtual:bike-app/admin-bike-paths (list)
//     → virtual:bike-app/admin-bike-path-detail (details)

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { cityDir } from '../lib/config/config.server';
import { loadBikePathEntries } from '../lib/bike-paths/bike-path-entries.server';
import { computeBikePathContentHash } from '../lib/models/bike-path-model.server';
import { supportedLocales, defaultLocale } from '../lib/i18n/locale-utils';
import type { AdminBikePath } from '../types/admin';
import type { BikePathDetail } from '../lib/models/bike-path-model';

interface AdminBikePathData {
  bikePaths: AdminBikePath[];
  details: Record<string, BikePathDetail & { contentHash: string }>;
}

let cachedData: AdminBikePathData | null = null;

export async function loadAdminBikePathData(): Promise<AdminBikePathData> {
  if (cachedData) return cachedData;

  const bikePathsDir = path.join(cityDir, 'bike-paths');

  // Get canonical pages (excludes hidden)
  const { pages } = loadBikePathEntries();

  const bikePaths: AdminBikePath[] = [];
  const details: Record<string, BikePathDetail & { contentHash: string }> = {};

  // Process pages that have markdown files
  for (const page of pages) {
    if (!page.hasMarkdown) continue;

    // Read raw file for content hash (conflict detection on save)
    const filePath = path.join(bikePathsDir, `${page.slug}.md`);
    const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    const contentHash = computeBikePathContentHash(raw);

    bikePaths.push({
      id: page.slug,
      name: page.name,
      vibe: page.vibe,
      hidden: false, // hidden pages are filtered by loadBikePathEntries
      stub: page.stub || !page.body || page.body.length < 50,
      hasGeometry: page.geoFiles.length > 0,
      includes: page.ymlEntries.map(e => e.slug),
      tags: page.tags,
      contentHash,
    });

    // Spread secondary locale names as name_{locale} keys (e.g. name_fr, name_nl)
    const localeNames: Record<string, string> = {};
    for (const [locale, trans] of Object.entries(page.translations)) {
      if (trans.name) localeNames[`name_${locale}`] = trans.name;
    }

    details[page.slug] = {
      id: page.slug,
      name: page.name,
      ...localeNames,
      vibe: page.vibe,
      hidden: false,
      stub: page.stub,
      featured: page.featured,
      includes: page.ymlEntries.map(e => e.slug),
      photo_key: page.photo_key,
      tags: page.tags,
      body: page.body ?? '',
      contentHash,
    };
  }

  // Also include hidden markdown files (loadBikePathEntries filters them,
  // but admin needs to see and edit them)
  if (fs.existsSync(bikePathsDir)) {
    for (const file of fs.readdirSync(bikePathsDir)) {
      if (!file.endsWith('.md')) continue;
      const parts = file.replace('.md', '').split('.');
      if (parts.length > 1) continue; // skip translation files

      const id = file.replace('.md', '');
      if (details[id]) continue; // already added from canonical pages

      const filePath = path.join(bikePathsDir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data: fm, content: body } = matter(raw);

      if (!fm.hidden) continue; // not hidden = should have been in canonical pages

      const contentHash = computeBikePathContentHash(raw);

      bikePaths.push({
        id,
        name: (fm.name as string) || id,
        vibe: fm.vibe as string | undefined,
        hidden: true,
        stub: (fm.stub as boolean) || !body.trim() || body.trim().length < 50,
        hasGeometry: false, // hidden pages are not in canonical entries, no geometry available
        includes: (fm.includes as string[]) || [],
        tags: (fm.tags as string[]) || [],
        contentHash,
      });

      // Spread secondary locale names from frontmatter
      const hiddenLocaleNames: Record<string, string> = {};
      for (const locale of supportedLocales().filter(l => l !== defaultLocale())) {
        const val = fm[`name_${locale}`];
        if (typeof val === 'string' && val) hiddenLocaleNames[`name_${locale}`] = val;
      }

      details[id] = {
        id,
        name: fm.name as string | undefined,
        ...hiddenLocaleNames,
        vibe: fm.vibe as string | undefined,
        hidden: true,
        stub: (fm.stub as boolean) || false,
        featured: (fm.featured as boolean) || false,
        includes: (fm.includes as string[]) || [],
        photo_key: fm.photo_key as string | undefined,
        tags: (fm.tags as string[]) || [],
        body: body.trim(),
        contentHash,
      };
    }
  }

  bikePaths.sort((a, b) => a.name.localeCompare(b.name));
  cachedData = { bikePaths, details };
  return cachedData;
}
