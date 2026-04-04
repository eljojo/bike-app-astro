import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { users } from '../../../db/schema';
import { buildSessionBatch, generateId, setSessionCookies } from '../../../lib/auth/auth';
import { generatePseudonym } from '../../../lib/auth/pseudonym';
import { isIpBanned } from '../../../lib/auth/ban-service';
import { checkRateLimit, recordAttempt } from '../../../lib/auth/rate-limit';
import { jsonResponse, jsonError } from '../../../lib/api-response';
import { withBatch } from '../../../db/transaction';
import { getInstanceFeatures } from '../../../lib/config/instance-features';

export const prerender = false;

const GUEST_SESSION_DURATION_MS = 90 * 24 * 60 * 60 * 1000;
const GUEST_SESSION_MAX_AGE = 90 * 24 * 60 * 60; // seconds

export async function POST({ cookies, request }: APIContext) {
  if (!getInstanceFeatures().allowsGuestAccess) {
    return new Response(null, { status: 404 });
  }
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

    const rateLimited = await checkRateLimit(database, 'guest-create', [`ip:${ip}`], 5);
    if (rateLimited) {
      return jsonError('Too many accounts created. Please try again later.', 429);
    }

    let token = '';
    await withBatch(database, (tx) => {
      const sessionPlan = buildSessionBatch(tx, userId, { durationMs: GUEST_SESSION_DURATION_MS });
      token = sessionPlan.token;

      return [
        tx.insert(users).values({
          id: userId,
          email: null,
          username,
          role: 'guest',
          createdAt: now,
          ipAddress: ip,
        }),
        ...sessionPlan.statements,
      ];
    });
    setSessionCookies(cookies, token, GUEST_SESSION_MAX_AGE);

    await recordAttempt(database, 'guest-create', [`ip:${ip}`]);

    return jsonResponse({ success: true, username });
  } catch (err: unknown) {
    console.error('guest creation error:', err);
    return jsonError('Failed to create guest account', 500);
  }
}
