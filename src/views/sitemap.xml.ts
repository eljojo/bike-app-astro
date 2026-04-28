import type { APIRoute } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { buildSitemapEntries, renderSitemapXml } from '../lib/sitemap';
import { loadBikePathData } from '../lib/bike-paths/bike-path-data.server';
import { getInstanceFeatures } from '../lib/config/instance-features';
import { hasDetailPage } from '../lib/models/organizer-model';

export const prerender = true;

export const GET: APIRoute = async () => {
  const routes = await getCollection('routes');
  const guides = await getCollection('guides');
  const events = await getCollection('events').catch((): CollectionEntry<'events'>[] => []);
  const organizers = await getCollection('organizers').catch((): CollectionEntry<'organizers'>[] => []);
  const features = getInstanceFeatures();
  const bikePaths = features.hasPaths
    ? (await loadBikePathData()).pages.filter(bp => bp.standalone)
    : undefined;
  // All organizers with detail pages (communities + bike shops)
  const communities = organizers
    .filter(o => hasDetailPage(o) && !o.data.hidden)
    .map(o => ({ slug: o.id }));
  const entries = buildSitemapEntries({ routes, guides, events, bikePaths, communities });
  const xml = renderSitemapXml(entries);
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
