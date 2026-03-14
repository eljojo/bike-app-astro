/* eslint-disable bike-app/require-authorize-call -- public endpoint, excluded from auth middleware */
import type { APIContext } from 'astro';
import { jsonResponse } from '@/lib/api-response';
import { db } from '@/lib/get-db';
import { reactions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getOptionalUser } from '@/lib/auth/auth';
import { CITY } from '@/lib/config/config';
import { getInstanceFeatures } from '@/lib/config/instance-features';

export const prerender = false;

/** Returns the current user's starred route slugs. Public — returns empty if not logged in. */
export async function GET({ locals }: APIContext) {
  if (!getInstanceFeatures().allowsReactions) {
    return new Response(null, { status: 404 });
  }
  const user = getOptionalUser(locals);
  if (!user) {
    return jsonResponse({ starredSlugs: [] });
  }

  const database = db();
  const rows = await database
    .select({ contentSlug: reactions.contentSlug })
    .from(reactions)
    .where(
      and(
        eq(reactions.city, CITY),
        eq(reactions.userId, user.id),
        eq(reactions.contentType, 'route'),
        eq(reactions.reactionType, 'star'),
      )
    );

  return jsonResponse({ starredSlugs: rows.map(r => r.contentSlug) });
}
