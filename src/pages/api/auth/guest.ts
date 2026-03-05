import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { users } from '../../../db/schema';
import { generateId, createSessionWithCookies } from '../../../lib/auth';
import { generatePseudonym } from '../../../lib/pseudonym';
import { isIpBanned } from '../../../lib/ban-service';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

export async function POST({ cookies, request }: APIContext) {
  try {
    const database = db();
    const userId = generateId();
    const username = generatePseudonym();
    const now = new Date().toISOString();
    const ip = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';

    if (await isIpBanned(database, ip)) {
      return jsonError('Unable to create account', 403);
    }

    await database.insert(users).values({
      id: userId,
      email: null,
      username,
      role: 'guest',
      createdAt: now,
      ipAddress: ip,
    });

    await createSessionWithCookies(database, userId, cookies);

    return jsonResponse({ success: true, username });
  } catch (err: unknown) {
    console.error('guest creation error:', err);
    return jsonError('Failed to create guest account', 500);
  }
}
