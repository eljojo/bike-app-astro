export const prerender = false;

import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { credentials } from '../../../db/schema';
import { eq, and } from 'drizzle-orm';
import { validateSession } from '../../../lib/auth';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export async function POST({ request, cookies }: APIContext): Promise<Response> {
  // Under /api/auth/ which middleware skips — validate session manually.
  const database = db();
  const token = cookies.get('session_token')?.value;
  const user = token ? await validateSession(database, token) : null;
  if (!user) return jsonError('Unauthorized', 401);

  const body = await request.json().catch(() => null);
  if (!body?.id || typeof body.id !== 'string') {
    return jsonError('Passkey ID is required', 400);
  }

  // Count existing passkeys
  const existing = await database
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.userId, user.id));

  // Prevent removing last passkey if user has no email set
  if (existing.length <= 1 && !user.email) {
    return jsonError('Cannot remove your only passkey without an email address set. Add an email first.', 400);
  }

  // Delete the passkey (only if it belongs to the user)
  const result = await database
    .delete(credentials)
    .where(
      and(
        eq(credentials.id, body.id),
        eq(credentials.userId, user.id),
      ),
    );

  return jsonResponse({ success: true });
}
