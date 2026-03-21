/* eslint-disable bike-app/require-authorize-call -- public endpoint, excluded from auth middleware */
import type { APIContext } from 'astro';
import { jsonResponse, jsonError } from '@/lib/api-response';
import { db } from '@/lib/get-db';
import { reactions } from '@/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { getOptionalUser } from '@/lib/auth/auth';
import { CITY } from '@/lib/config/config';
import { VALID_CONTENT_TYPES } from '@/lib/reaction-types';
import { getInstanceFeatures } from '@/lib/config/instance-features';

export const prerender = false;

export async function GET({ params, locals }: APIContext) {
  if (!getInstanceFeatures().allowsReactions) {
    return new Response(null, { status: 404 });
  }
  const contentType = params.contentType;
  const contentSlug = params.contentSlug;

  if (!contentType || !contentSlug) {
    return jsonError('Missing contentType or contentSlug', 400);
  }

  if (!(VALID_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return jsonError('Invalid content type', 400);
  }

  const database = db();

  let counts: { reactionType: string; total: number }[];
  try {
    counts = await database
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
  } catch {
    // Table may not exist yet (migrations pending)
    return jsonResponse({ counts: {}, userReactions: [] });
  }

  const user = getOptionalUser(locals);
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

  const response = jsonResponse({
    counts: Object.fromEntries(counts.map(c => [c.reactionType, c.total])),
    userReactions,
  });
  // Short cache for public counts; personalized responses (with user) skip cache
  if (!user) {
    response.headers.set('Cache-Control', 'public, max-age=60');
  }
  return response;
}
