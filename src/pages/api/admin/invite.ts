import type { APIContext } from 'astro';
import { getDb } from '../../../db';
import { inviteCodes } from '../../../db/schema';
import { generateId } from '../../../lib/auth';

export const prerender = false;

function randomCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % 36]).join('');
}

export async function POST({ locals }: APIContext) {
  const user = (locals as any).user;

  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const env = (locals as any).runtime.env;
    const db = getDb(env.DB);
    const code = randomCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(inviteCodes).values({
      id: generateId(),
      code,
      createdBy: user.id,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    });

    return new Response(JSON.stringify({ code }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('invite error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
