import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { users } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { jsonResponse, jsonError } from '../../../lib/api-response';
import { normalizeEmail, validateSession } from '../../../lib/auth/auth';
import { isValidUsername } from '../../../lib/username';
import { sendMagicLinkEmail } from '../../../lib/auth/magic-link.server';
import { getInstanceFeatures } from '../../../lib/config/instance-features';

export const prerender = false;

export async function POST({ request, cookies, url }: APIContext) {
  if (!getInstanceFeatures().allowsRegistration) {
    return new Response(null, { status: 404 });
  }

  // Manually validate session — middleware skips /api/auth/ routes
  const token = cookies.get('session_token')?.value;
  if (!token) return jsonError('Unauthorized', 401);

  const database = db();
  const user = await validateSession(database, token);
  if (!user) return jsonError('Unauthorized', 401);

  if (user.role !== 'guest') {
    return jsonError('Only guest accounts can upgrade', 400);
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body', 400);
  }

  const { email: rawEmail, username } = body;
  if (!rawEmail) return jsonError('Email is required', 400);
  if (!username || !isValidUsername(username)) return jsonError('Invalid username', 400);

  const email = normalizeEmail(rawEmail);

  // Check email uniqueness
  const emailTaken = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (emailTaken.length > 0) return jsonError('Email is already registered', 409);

  // Check username uniqueness
  const usernameTaken = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (usernameTaken.length > 0) return jsonError('Username is already taken', 409);

  // Store previous username
  const previousUsernames = user.username ? JSON.stringify([user.username]) : null;

  // Update user — don't change role yet (verify.astro does that)
  await database
    .update(users)
    .set({
      email,
      username,
      previousUsernames,
      emailVerified: 0,
      ipAddress: null,
    })
    .where(eq(users.id, user.id));

  // Send verification magic link
  await sendMagicLinkEmail(database, email, user.id, url.origin);

  return jsonResponse({ success: true });
}
