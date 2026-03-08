import type { APIContext } from 'astro';
import { jsonResponse } from '@/lib/api-response';
import { db } from '@/lib/get-db';
import { reactions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import type { SessionUser } from '@/lib/auth';
import { CITY } from '@/lib/config';

export const prerender = false;

/** Returns the current user's starred route slugs. Public — returns empty if not logged in. */
export async function GET({ locals }: APIContext) {
  const user = (locals as any).user as SessionUser | undefined;
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
