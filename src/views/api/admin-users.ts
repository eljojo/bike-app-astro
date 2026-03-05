import type { APIContext } from 'astro';
import { db } from '../../lib/get-db';
import { users } from '../../db/schema';
import { desc } from 'drizzle-orm';
import { requireAdmin } from '../../lib/auth';
import { banUser, unbanUser } from '../../lib/ban-service';
import { jsonResponse, jsonError } from '../../lib/api-response';

export const prerender = false;

export async function GET({ locals }: APIContext) {
  try {
    requireAdmin(locals.user);
  } catch {
    return jsonError('Unauthorized', 401);
  }

  const database = db();
  const allUsers = await database.select({
    id: users.id,
    username: users.username,
    role: users.role,
    createdAt: users.createdAt,
    bannedAt: users.bannedAt,
    ipAddress: users.ipAddress,
  }).from(users).orderBy(desc(users.createdAt));

  return jsonResponse({ users: allUsers });
}

export async function POST({ request, locals }: APIContext) {
  try {
    requireAdmin(locals.user);
  } catch {
    return jsonError('Unauthorized', 401);
  }

  const { action, userId } = await request.json();
  if (!action || !userId) {
    return jsonError('Missing action or userId');
  }

  const database = db();

  try {
    if (action === 'ban') {
      await banUser(database, userId);
      return jsonResponse({ success: true });
    } else if (action === 'unban') {
      await unbanUser(database, userId);
      return jsonResponse({ success: true });
    } else {
      return jsonError('Invalid action');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to process action';
    return jsonError(message, 500);
  }
}
