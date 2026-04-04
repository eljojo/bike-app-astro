import type { APIContext } from 'astro';
import { authorize } from '@/lib/auth/authorize';
import { jsonResponse, jsonError } from '@/lib/api-response';
import { db } from '@/lib/get-db';
import { reactions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { CITY } from '@/lib/config/config';
import { reactionSchema } from '@/lib/reaction-types';
import { checkRateLimit, recordAttempt, cleanupOldAttempts } from '@/lib/auth/rate-limit';
import { getInstanceFeatures } from '@/lib/config/instance-features';

export const prerender = false;

export async function POST({ request, locals }: APIContext) {
  if (!getInstanceFeatures().allowsReactions) {
    return new Response(null, { status: 404 });
  }
  const user = authorize(locals, 'add-reaction');
  if (user instanceof Response) return user;

  let body;
  try {
    body = reactionSchema.parse(await request.json());
  } catch {
    return jsonError('Invalid request body', 400);
  }

  const database = db();

  // Rate limit: 60 reactions per hour per user
  const identifiers = [`user:${user.id}`];
  const overLimit = await checkRateLimit(database, 'reaction', identifiers, 60);
  if (overLimit) {
    return jsonError('Reaction rate limit exceeded', 429);
  }
  await recordAttempt(database, 'reaction', identifiers);
  cleanupOldAttempts(database, 'reaction').catch(() => {});

  // Check if reaction already exists
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
    // Remove existing reaction (toggle off)
    await database.delete(reactions).where(eq(reactions.id, existing[0].id));
    return jsonResponse({ action: 'removed' });
  }

  // Add new reaction — ON CONFLICT guards against rare race with another insert
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
    })
    .onConflictDoNothing({ target: [reactions.city, reactions.userId, reactions.contentType, reactions.contentSlug, reactions.reactionType] });

  return jsonResponse({ action: 'added' });
}
