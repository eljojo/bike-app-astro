/* eslint-disable bike-app/require-authorize-call -- public endpoint, excluded from auth middleware */
import type { APIContext } from 'astro';
import { jsonResponse } from '@/lib/api-response';
import { db } from '@/lib/get-db';
import { reactions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getOptionalUser } from '@/lib/auth/auth';
import { CITY } from '@/lib/config/config';
import { getInstanceFeatures } from '@/lib/config/instance-features';
import { VALID_CONTENT_TYPES } from '@/lib/reaction-types';

export const prerender = false;

export async function GET({ locals, url }: APIContext) {
  if (!getInstanceFeatures().allowsReactions) {
    return new Response(null, { status: 404 });
  }

  // Extract contentType from URL: /api/reactions/{contentType}/_starred
  const segments = url.pathname.split('/').filter(Boolean);
  const contentType = segments[2]; // ['api', 'reactions', '{contentType}', '_starred']
  if (!contentType || !(VALID_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return jsonResponse({ error: 'Invalid content type' }, 400);
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
        eq(reactions.contentType, contentType),
        eq(reactions.reactionType, 'star'),
      )
    );

  return jsonResponse({ starredSlugs: rows.map(r => r.contentSlug) });
}
