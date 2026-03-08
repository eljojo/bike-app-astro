import type { APIContext } from 'astro';
import { jsonResponse, jsonError } from '@/lib/api-response';
import { db } from '@/lib/get-db';
import { reactions } from '@/db/schema';
import { eq, and, count } from 'drizzle-orm';
import type { SessionUser } from '@/lib/auth';
import { CITY } from '@/lib/config';

export const prerender = false;

export async function GET({ params, locals }: APIContext) {
  const contentType = params.contentType;
  const contentSlug = params.contentSlug;

  if (!contentType || !contentSlug) {
    return jsonError('Missing contentType or contentSlug', 400);
  }

  const database = db();

  const counts = await database
    .select({
      reactionType: reactions.reactionType,
      total: count(reactions.id),
    })
    .from(reactions)
    .where(
      and(
        eq(reactions.city, CITY),
        eq(reactions.contentType, contentType),
        eq(reactions.contentSlug, contentSlug),
      )
    )
    .groupBy(reactions.reactionType);

  // User may or may not be authenticated (optional user loading in middleware)
  const user = (locals as any).user as SessionUser | undefined;
  let userReactions: string[] = [];
  if (user) {
    const own = await database
      .select({ reactionType: reactions.reactionType })
      .from(reactions)
      .where(
        and(
          eq(reactions.city, CITY),
          eq(reactions.userId, user.id),
          eq(reactions.contentType, contentType),
          eq(reactions.contentSlug, contentSlug),
        )
      );
    userReactions = own.map(r => r.reactionType);
  }

  return jsonResponse({
    counts: Object.fromEntries(counts.map(c => [c.reactionType, c.total])),
    userReactions,
  });
}
