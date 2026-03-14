import { defineMiddleware } from 'astro:middleware';
import { validateSession } from './lib/auth';
import { jsonError } from './lib/api-response';
import { db } from './lib/get-db';
import { buildNonceCspHeader, createCspNonce } from './lib/csp';
import rideRedirects from 'virtual:bike-app/ride-redirects';

const NONCE_CSP_PATHS = new Set(['/login', '/register', '/setup', '/gate', '/auth/verify']);

function needsNonceCsp(pathname: string): boolean {
  return pathname.startsWith('/admin') || NONCE_CSP_PATHS.has(pathname);
}

function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get('Content-Type') || '';
  return contentType.includes('text/html');
}

function addNonceToScripts(html: string, nonce: string): string {
  return html.replace(
    /<script\b(?![^>]*\bnonce=)([^>]*)>/gi,
    (_full, attrs: string) => `<script nonce="${nonce}"${attrs}>`
  );
}

async function applyNonceCsp(response: Response, nonce: string): Promise<Response> {
  if (!isHtmlResponse(response)) return response;

  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', buildNonceCspHeader(nonce));
  // Body size changed after script nonce injection.
  headers.delete('content-length');

  return new Response(addNonceToScripts(body, nonce), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Ride redirects: old slugs → canonical URLs (from redirects.yml + tour mappings)
  const rideTarget = rideRedirects[pathname];
  if (rideTarget) {
    return context.redirect(rideTarget, 301);
  }

  const withNonceCsp = needsNonceCsp(pathname);

  if (withNonceCsp) {
    context.locals.cspNonce = createCspNonce();
  }

  // Only protect admin pages and non-auth API routes
  const isProtected =
    pathname.startsWith('/admin') ||
    (pathname.startsWith('/api/') &&
     !pathname.startsWith('/api/auth/') &&
     !pathname.startsWith('/api/reactions/') &&
     pathname !== '/api/event' &&
     !pathname.startsWith('/api/tiles/'));

  if (!isProtected) {
    // For reactions GET, optionally load user for personalized responses
    if (pathname.startsWith('/api/reactions/')) {
      const token = context.cookies.get('session_token')?.value;
      if (token) {
        const database = db();
        const optionalUser = await validateSession(database, token);
        if (optionalUser && !optionalUser.bannedAt) {
          context.locals.user = optionalUser;
        }
      }
    }
    const response = await next();
    if (withNonceCsp && context.locals.cspNonce) {
      return applyNonceCsp(response, context.locals.cspNonce);
    }
    return response;
  }

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
  const response = await next();
  if (withNonceCsp && context.locals.cspNonce) {
    return applyNonceCsp(response, context.locals.cspNonce);
  }
  return response;
});
