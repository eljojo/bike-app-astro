import type { APIContext } from 'astro';
import { getDb } from '../../../db';
import { destroySession, clearSessionCookies } from '../../../lib/auth';

export const prerender = false;

export async function POST({ request, cookies, locals }: APIContext) {
  try {
    const env = locals.runtime.env;
    const db = getDb(env.DB);
    const token = cookies.get('session_token')?.value;

    if (token) {
      await destroySession(db, token);
    }

    clearSessionCookies(cookies);

    // Support both HTML form submissions (redirect) and fetch API (JSON)
    const accept = request.headers.get('accept') || '';
    if (accept.includes('application/json')) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: '/login' },
    });
  } catch (err) {
    console.error('logout error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
