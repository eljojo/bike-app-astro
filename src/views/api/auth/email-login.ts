export const prerender = false;

import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { emailTokens } from '../../../db/schema';
import { findUserByIdentifier, generateId, normalizeEmail } from '../../../lib/auth';
import { checkRateLimit, recordAttempt } from '../../../lib/rate-limit';
import { createEmailService } from '../../../lib/external/email';
import { jsonResponse, jsonError } from '../../../lib/api-response';
import { getCityConfig } from '../../../lib/city-config';
import { env } from '../../../lib/env';

const TOKEN_EXPIRY_MINUTES = 15;
const MAX_TOKENS_PER_HOUR = 3;

function generateToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

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

  // Generate token
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

  await database.insert(emailTokens).values({
    id: generateId(),
    userId: user.id,
    email,
    token,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });

  // Record rate limit attempt
  await recordAttempt(database, 'email-login', [email]);

  // Build magic link
  const origin = context.url.origin;
  const magicLink = `${origin}/auth/verify?token=${token}`;

  // Send email
  const config = getCityConfig();
  const emailService = createEmailService(env);
  await emailService.send(
    email,
    `Sign in to ${config.display_name}`,
    `Click this link to sign in:\n\n${magicLink}\n\nThis link expires in ${TOKEN_EXPIRY_MINUTES} minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
  );

  return jsonResponse({ success: true });
}
