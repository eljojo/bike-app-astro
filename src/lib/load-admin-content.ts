import { db as getDb } from './get-db';
import { contentEdits } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export interface AdminContentResult<T> {
  data: T | null;
}

/**
 * Two-tier data loading for admin detail pages:
 * 1. D1 content_edits cache
 * 2. Build-time virtual module data
 */
export async function loadAdminContent<T>(opts: {
  contentType: string;
  contentSlug: string;
  virtualModuleData: Record<string, T>;
}): Promise<AdminContentResult<T>> {
  const database = getDb();
  let data: T | null = null;

  // Tier 1: D1 cache
  const cached = await database.select().from(contentEdits)
    .where(and(
      eq(contentEdits.contentType, opts.contentType),
      eq(contentEdits.contentSlug, opts.contentSlug),
    ))
    .get();

  if (cached) {
    data = JSON.parse(cached.data) as T;
  }

  // Tier 2: Virtual module fallback
  if (!data) {
    data = opts.virtualModuleData[opts.contentSlug] ?? null;
  }

  return { data };
}
