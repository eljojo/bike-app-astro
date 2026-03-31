import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildSitemapEntries, renderSitemapXml } from '../lib/sitemap';

export const prerender = true;

export const GET: APIRoute = async () => {
  const routes = await getCollection('routes');
  const guides = await getCollection('guides');
  const events = await getCollection('events').catch(() => []);
  const entries = buildSitemapEntries({ routes, guides, events });
  const xml = renderSitemapXml(entries);
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
