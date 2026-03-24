import type { Database } from '../../db';
import { statsCache } from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Read a cached stats response. Returns null if missing or stale.
 */
export async function readStatsCache(
  db: Database,
  city: string,
  cacheKey: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db.select()
    .from(statsCache)
    .where(and(eq(statsCache.city, city), eq(statsCache.cacheKey, cacheKey)))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  const age = Date.now() - new Date(row.updatedAt).getTime();
  if (age > CACHE_TTL_MS) return null;

  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Write a stats response to the cache.
 */
export async function writeStatsCache(
  db: Database,
  city: string,
  cacheKey: string,
  data: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(statsCache)
    .values({ city, cacheKey, data: JSON.stringify(data), updatedAt: now })
    .onConflictDoUpdate({
      target: [statsCache.city, statsCache.cacheKey],
      set: {
        data: sql`excluded.data`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .run();
}

/**
 * Invalidate all stats cache entries for a city.
 * Called after sync completes.
 */
export async function invalidateStatsCache(db: Database, city: string): Promise<void> {
  await db.delete(statsCache).where(eq(statsCache.city, city)).run();
}
