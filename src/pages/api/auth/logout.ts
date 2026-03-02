import type { APIContext } from 'astro';
import { getDb } from '../../../db';
import { destroySession, clearSessionCookies } from '../../../lib/auth';

export const prerender = false;

export async function POST({ cookies, locals }: APIContext) {
  try {
    const env = (locals as any).runtime.env;
    const db = getDb(env.DB);
    const token = cookies.get('session_token')?.value;

    if (token) {
      await destroySession(db, token);
    }

    clearSessionCookies(cookies);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('logout error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
