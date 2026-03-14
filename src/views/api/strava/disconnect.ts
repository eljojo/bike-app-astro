import type { APIContext } from 'astro';
import { eq } from 'drizzle-orm';
import { authorize } from '@/lib/authorize';
import { jsonResponse } from '@/lib/api-response';
import { db } from '@/lib/get-db';
import { stravaTokens } from '@/db/schema';

export const prerender = false;

export async function POST({ locals }: APIContext) {
  const user = authorize(locals, 'strava-connect');
  if (user instanceof Response) return user;

  const database = db();
  await database.delete(stravaTokens).where(eq(stravaTokens.userId, user.id));

  return jsonResponse({ disconnected: true });
}
