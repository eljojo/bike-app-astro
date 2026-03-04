import type { APIContext } from 'astro';
import { requireAdmin } from '../../../lib/auth';
import { jsonResponse, jsonError } from '../../../lib/api-response';

export const prerender = false;

export async function POST({ request, cookies, locals }: APIContext) {
  try {
    requireAdmin(locals.user);
  } catch {
    return jsonError('Unauthorized', 401);
  }

  const { enabled } = await request.json();

  if (enabled) {
    cookies.set('editor_mode', '1', {
      httpOnly: false,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
  } else {
    cookies.delete('editor_mode', { path: '/' });
  }

  return jsonResponse({ success: true, editorMode: !!enabled });
}
