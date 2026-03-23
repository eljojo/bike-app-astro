export const prerender = false;

import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { findUserByIdentifier, normalizeEmail } from '../../../lib/auth/auth';
import { checkRateLimit, recordAttempt } from '../../../lib/auth/rate-limit';
import { sendMagicLinkEmail } from '../../../lib/auth/magic-link.server';
import { jsonResponse, jsonError } from '../../../lib/api-response';

const MAX_TOKENS_PER_HOUR = 3;

export async function POST(context: APIContext): Promise<Response> {
  const body = await context.request.json().catch(() => null);
  if (!body?.email || typeof body.email !== 'string') {
    return jsonError('Email is required', 400);
  }

  const email = normalizeEmail(body.email);
  if (!email.includes('@')) {
    return jsonError('Invalid email address', 400);
  }

  const database = db();

  // Rate limit: max 3 tokens per email per hour
  const rateLimited = await checkRateLimit(database, 'email-login', [email], MAX_TOKENS_PER_HOUR);
  if (rateLimited) {
    return jsonError('Too many login attempts. Please try again later.', 429);
  }

  // Check if user exists
  const user = await findUserByIdentifier(database, email);
  if (!user) {
    // Don't reveal whether the email exists — always return success
    return jsonResponse({ success: true });
  }

  await sendMagicLinkEmail(database, email, user.id, context.url.origin);

  // Record rate limit attempt
  await recordAttempt(database, 'email-login', [email]);

  return jsonResponse({ success: true });
}
