import type { APIRoute } from 'astro';
import { db } from '../../../lib/get-db';
import { contentEdits } from '../../../db/schema';
import { eq, and } from 'drizzle-orm';
import { CITY } from '../../../lib/config/config';
import { bikePathDetailFromCache } from '../../../lib/models/bike-path-model';

export const prerender = false;

export const GET: APIRoute = async () => {
  const database = db();
  const cached = await database.select().from(contentEdits)
    .where(and(eq(contentEdits.city, CITY), eq(contentEdits.contentType, 'bike-paths')))
    .all();

  const items = cached.flatMap(e => {
    try {
      const detail = bikePathDetailFromCache(e.data);
      return [{
        id: e.contentSlug,
        name: detail.name || e.contentSlug,
        vibe: detail.vibe,
        hidden: detail.hidden,
        includes: detail.includes,
        tags: detail.tags,
        contentHash: e.githubSha || '',
      }];
    } catch {
      return [];
    }
  });

  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json' },
  });
};
