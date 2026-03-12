export const prerender = false;

import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { credentials } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { validateSession } from '../../../lib/auth';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export async function GET({ cookies }: APIContext): Promise<Response> {
  // Under /api/auth/ which middleware skips — validate session manually.
  const database = db();
  const token = cookies.get('session_token')?.value;
  const user = token ? await validateSession(database, token) : null;
  if (!user) return jsonError('Unauthorized', 401);
  const rows = await database
    .select({
      id: credentials.id,
      credentialId: credentials.credentialId,
      createdAt: credentials.createdAt,
    })
    .from(credentials)
    .where(eq(credentials.userId, user.id));

  return jsonResponse({
    passkeys: rows.map(r => ({
      id: r.id,
      credentialId: r.credentialId,
      createdAt: r.createdAt,
    })),
  });
}
