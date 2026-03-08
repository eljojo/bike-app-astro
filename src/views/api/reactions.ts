import type { APIContext } from 'astro';
import { authorize } from '@/lib/authorize';
import { jsonResponse, jsonError } from '@/lib/api-response';
import { db } from '@/lib/get-db';
import { reactions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { CITY } from '@/lib/config';

export const prerender = false;

const reactionSchema = z.object({
  contentType: z.enum(['route', 'event']),
  contentSlug: z.string().min(1),
  reactionType: z.enum(['ridden', 'thumbs-up', 'star']),
});

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'add-reaction');
  if (user instanceof Response) return user;

  let body;
  try {
    body = reactionSchema.parse(await request.json());
  } catch {
    return jsonError('Invalid request body', 400);
  }

  const database = db();

  // Check if reaction already exists (toggle off)
  const existing = await database
    .select({ id: reactions.id })
    .from(reactions)
    .where(
      and(
        eq(reactions.city, CITY),
        eq(reactions.userId, user.id),
        eq(reactions.contentType, body.contentType),
        eq(reactions.contentSlug, body.contentSlug),
        eq(reactions.reactionType, body.reactionType),
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await database
      .delete(reactions)
      .where(eq(reactions.id, existing[0].id));

    return jsonResponse({ action: 'removed' });
  }

  await database
    .insert(reactions)
    .values({
      id: crypto.randomUUID(),
      city: CITY,
      userId: user.id,
      contentType: body.contentType,
      contentSlug: body.contentSlug,
      reactionType: body.reactionType,
      createdAt: new Date().toISOString(),
    });

  return jsonResponse({ action: 'added' });
}
