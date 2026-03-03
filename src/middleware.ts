import { defineMiddleware } from 'astro:middleware';
import { validateSession } from './lib/auth';
import { db } from './lib/get-db';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Only protect admin pages and non-auth API routes
  const isProtected =
    pathname.startsWith('/admin') ||
    (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/'));

  if (!isProtected) return next();

  const database = db();
  const token = context.cookies.get('session_token')?.value;

  if (!token) {
    // API routes get 401, pages get redirected
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const returnTo = encodeURIComponent(pathname);
    return context.redirect(`/gate?returnTo=${returnTo}`);
  }

  const user = await validateSession(database, token);
  if (!user) {
    // Clear stale cookies
    context.cookies.delete('session_token', { path: '/' });
    context.cookies.delete('logged_in', { path: '/' });

    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const returnTo = encodeURIComponent(pathname);
    return context.redirect(`/gate?returnTo=${returnTo}`);
  }

  // Make user available to page/API handlers
  context.locals.user = user;
  return next();
});
