/* eslint-disable bike-app/require-authorize-call -- authorize() called inside shared handleContentDetailRequest */
import type { APIContext } from 'astro';
import { handleContentDetailRequest } from '../../lib/stats/detail-handler.server';

export const prerender = false;

export async function GET(ctx: APIContext) {
  return handleContentDetailRequest(ctx.locals, ctx.url, ctx.params, false, 'route');
}

export async function POST(ctx: APIContext) {
  return handleContentDetailRequest(ctx.locals, ctx.url, ctx.params, true, 'route');
}
