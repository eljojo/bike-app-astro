import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { cityDir } from '../lib/config';
import type { AdminPlace } from '../types/admin';
import { placeDetailFromGit, computePlaceContentHash, type PlaceDetail } from '../lib/models/place-model';

const CITY_DIR = cityDir;

interface AdminPlaceData {
  places: AdminPlace[];
  details: Record<string, PlaceDetail & { contentHash: string }>;
}

let cachedPlaceData: AdminPlaceData | null = null;

export async function loadAdminPlaceData(): Promise<AdminPlaceData> {
  if (cachedPlaceData) return cachedPlaceData;

  const placesDir = path.join(CITY_DIR, 'places');
  if (!fs.existsSync(placesDir)) {
    cachedPlaceData = { places: [], details: {} };
    return cachedPlaceData;
  }

  const places: AdminPlace[] = [];
  const details: Record<string, PlaceDetail & { contentHash: string }> = {};

  for (const file of fs.readdirSync(placesDir)) {
    if (!file.endsWith('.md')) continue;
    // Skip translation files like place.fr.md
    const parts = file.replace('.md', '').split('.');
    if (parts.length > 1) continue;

    const id = file.replace('.md', '');
    const filePath = path.join(placesDir, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const contentHash = computePlaceContentHash(raw);
    const { data: fm } = matter(raw);

    places.push({
      id,
      name: fm.name as string,
      category: fm.category as string,
      lat: fm.lat as number,
      lng: fm.lng as number,
      contentHash,
    });

    const detail = placeDetailFromGit(id, fm);
    details[id] = { ...detail, contentHash };
  }

  // Sort by name
  places.sort((a, b) => a.name.localeCompare(b.name));
  cachedPlaceData = { places, details };
  return cachedPlaceData;
}
