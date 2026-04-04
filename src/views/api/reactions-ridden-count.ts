/* eslint-disable bike-app/require-authorize-call -- public endpoint, returns 0 for unauthenticated */
import type { APIContext } from 'astro';
import { jsonResponse } from '@/lib/api-response';
import { db } from '@/lib/get-db';
import { reactions } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getOptionalUser } from '@/lib/auth/auth';
import { CITY } from '@/lib/config/config';
import { getInstanceFeatures } from '@/lib/config/instance-features';

export const prerender = false;

export async function GET({ locals }: APIContext) {
  if (!getInstanceFeatures().allowsReactions) {
    return new Response(null, { status: 404 });
  }

  const user = getOptionalUser(locals);
  if (!user) {
    return jsonResponse({ riddenCount: 0 });
  }

  const database = db();

  try {
    const result = await database
      .select({
        riddenCount: sql<number>`COUNT(DISTINCT ${reactions.contentSlug})`,
      })
      .from(reactions)
      .where(
        and(
          eq(reactions.city, CITY),
          eq(reactions.userId, user.id),
          eq(reactions.contentType, 'route'),
          eq(reactions.reactionType, 'ridden'),
        )
      );

    return jsonResponse({ riddenCount: result[0]?.riddenCount ?? 0 });
  } catch {
    // Table may not exist yet (migrations pending)
    return jsonResponse({ riddenCount: 0 });
  }
}
