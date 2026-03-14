import type { APIContext } from 'astro';
import { db } from '../../../lib/get-db';
import { destroySession, clearSessionCookies } from '../../../lib/auth/auth';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

export async function POST({ request, cookies }: APIContext) {
  try {
    const database = db();
    const token = cookies.get('session_token')?.value;

    if (token) {
      await destroySession(database, token);
    }

    clearSessionCookies(cookies);

    // Support both HTML form submissions (redirect) and fetch API (JSON)
    const accept = request.headers.get('accept') || '';
    if (accept.includes('application/json')) {
      return jsonResponse({ success: true });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: '/login' },
    });
  } catch (err) {
    console.error('logout error:', err);
    return jsonError('Internal server error', 500);
  }
}
