import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildSitemapEntries, renderSitemapXml } from '../lib/sitemap';
import { loadBikePathData } from '../lib/bike-paths/bike-path-data.server';

export const prerender = true;

export const GET: APIRoute = async () => {
  const routes = await getCollection('routes');
  const guides = await getCollection('guides');
  const events = await getCollection('events').catch(() => []);
  const { pages: bikePaths } = await loadBikePathData();
  const entries = buildSitemapEntries({ routes, guides, events, bikePaths });
  const xml = renderSitemapXml(entries);
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
