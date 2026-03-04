import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { users } from '../../../db/schema';
import { generateId, createSessionWithCookies } from '../../../lib/auth';
import { generatePseudonym } from '../../../lib/pseudonym';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

export async function POST({ cookies }: APIContext) {
  try {
    const database = db();
    const userId = generateId();
    const displayName = generatePseudonym();
    const now = new Date().toISOString();

    await database.insert(users).values({
      id: userId,
      email: null,
      displayName,
      role: 'guest',
      createdAt: now,
    });

    await createSessionWithCookies(database, userId, cookies);

    return jsonResponse({ success: true, displayName });
  } catch (err: any) {
    console.error('guest creation error:', err);
    return jsonError('Failed to create guest account', 500);
  }
}
