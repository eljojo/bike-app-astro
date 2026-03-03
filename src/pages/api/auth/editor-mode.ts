import type { APIContext } from 'astro';

export const prerender = false;

export async function POST({ request, cookies, locals }: APIContext) {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
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

  return new Response(JSON.stringify({ success: true, editorMode: !!enabled }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
