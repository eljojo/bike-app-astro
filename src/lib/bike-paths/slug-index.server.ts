/**
 * Slug index loader — reads slug-index.json for map image proxy URL generation.
 * Memoized: reads from disk once, returns cached result on subsequent calls.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface SlugIndexEntry {
  tiles: string[];
  hash: string;
}

let cached: Record<string, SlugIndexEntry> | null = null;

/** Load the slug index mapping slugs to tile IDs and geometry hashes. */
export function loadSlugIndex(): Record<string, SlugIndexEntry> {
  if (cached) return cached;
  const indexPath = path.join(process.cwd(), 'public', 'bike-paths', 'geo', 'tiles', 'slug-index.json');
  if (!fs.existsSync(indexPath)) {
    cached = {};
    return cached;
  }
  cached = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  return cached!;
}
