import { defineMiddleware } from 'astro:middleware';
import { validateSession } from './lib/auth';
import { jsonError } from './lib/api-response';
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
      return jsonError('Unauthorized', 401);
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
      return jsonError('Unauthorized', 401);
    }
    const returnTo = encodeURIComponent(pathname);
    return context.redirect(`/gate?returnTo=${returnTo}`);
  }

  // Ban enforcement
  if (user.bannedAt) {
    if (pathname.startsWith('/api/')) {
      return jsonError('Forbidden', 403);
    }
    return context.redirect('/gate');
  }

  // Make user available to page/API handlers
  context.locals.user = user;
  return next();
});
