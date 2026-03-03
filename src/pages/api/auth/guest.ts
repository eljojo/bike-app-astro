import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { users } from '../../../db/schema';
import { generateId, createSession, setSessionCookies } from '../../../lib/auth';
import { generatePseudonym } from '../../../lib/pseudonym';

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

    const token = await createSession(database, userId);
    setSessionCookies(cookies, token);

    return new Response(JSON.stringify({ success: true, displayName }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('guest creation error:', err);
    return new Response(JSON.stringify({ error: 'Failed to create guest account' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
