import type { APIRoute } from 'astro';
import { db } from '../../../lib/get-db';
import { contentEdits } from '../../../db/schema';
import { eq, and } from 'drizzle-orm';
import { CITY } from '../../../lib/config/config';
import { bikePathDetailFromCache } from '../../../lib/models/bike-path-model';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return new Response(null, { status: 404 });

  const database = db();
  const cached = await database.select().from(contentEdits)
    .where(and(
      eq(contentEdits.city, CITY),
      eq(contentEdits.contentType, 'bike-paths'),
      eq(contentEdits.contentSlug, id),
    ))
    .get();

  if (!cached) return new Response(null, { status: 404 });

  try {
    const detail = bikePathDetailFromCache(cached.data);
    return new Response(JSON.stringify(detail), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
};
