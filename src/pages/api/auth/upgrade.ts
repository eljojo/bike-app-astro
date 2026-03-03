import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { users } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { normalizeEmail } from '../../../lib/auth';

export const prerender = false;

export async function POST({ request, locals }: APIContext) {
  const user = locals.user;
  if (!user || user.role !== 'guest') {
    return new Response(JSON.stringify({ error: 'Only guests can upgrade' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { email: rawEmail, displayName } = await request.json();
  if (!rawEmail) {
    return new Response(JSON.stringify({ error: 'Email is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const database = db();
  const email = normalizeEmail(rawEmail);

  // Check email not already taken
  const existing = await database.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return new Response(JSON.stringify({ error: 'Email already registered' }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Upgrade: set email, role, optionally displayName
  const updates: Record<string, unknown> = { email, role: 'editor' };
  if (displayName) updates.displayName = displayName;

  await database.update(users).set(updates).where(eq(users.id, user.id));

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
