/**
 * Spot-check contested bikepaths.yml entries against live Overpass. For each
 * slug, fetch the OSM tags of its backing relation (or first way) and print
 * what OSM actually says — useful for resolving "is this really MTB?", "does
 * this allow bikes?", "is this a hiking route masquerading as cycling?".
 *
 * Usage:
 *   npx tsx scripts/overpass-spotcheck.ts
 */
import yaml from 'js-yaml';
import fs from 'node:fs';

interface BpEntry {
  slug: string;
  name: string;
  type?: string;
  path_type?: string;
  highway?: string;
  bicycle?: string;
  surface?: string;
  osm_relations?: number[];
  osm_way_ids?: number[];
}
interface BikePathsYml { bike_paths?: BpEntry[] }

const bp = yaml.load(fs.readFileSync('/home/dev/code/bike-routes/ottawa/bikepaths.yml', 'utf-8')) as BikePathsYml;
const bySlug = new Map<string, BpEntry>();
for (const e of bp.bike_paths ?? []) bySlug.set(e.slug, e);

const CHECK_SLUGS = [
  'hunt-club-road', 'nepean-trail', 'trim-road-1', 'the-greely-loop', 'chief-william-commanda-bridge',
  'chemin-jean-paul-lemieux', 'sia-6-route-dacces-amqui', 'cheminduquebec-5-st-jean-farnham',
  'riverside-drive-1', 'carling-avenue', 'byron-richmond-path', 'parc-de-la-gatineau-1',
  'confederation-pathway', 'sentier-le-portage', 'rue-lafrance',
  'jack-pine-trail', 'beaver-trail', 'dewberry-trail', 'arboretum-loop', 'monkey-trail',
  'coulicou-trails', 'landsdowne-natural-heritage-park',
  'the-beast-trail', 'the-beast-trail-trails',
];

const ENDPOINT = 'https://overpass.whereto.bike/api/interpreter';
const KEY_TAGS = ['highway', 'bicycle', 'surface', 'name', 'name:en', 'name:fr', 'route', 'network', 'cycleway', 'cycleway:both', 'cycleway:right', 'cycleway:left', 'access', 'foot', 'lcn', 'rcn', 'ncn', 'mtb:scale', 'operator'];

async function queryTags(kind: 'way' | 'relation', id: number): Promise<Record<string, string>> {
  const body = `data=[out:json][timeout:25];${kind}(id:${id});out tags;`;
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = (await res.json()) as { elements?: Array<{ tags?: Record<string, string> }> };
  return data.elements?.[0]?.tags ?? {};
}

for (const slug of CHECK_SLUGS) {
  const e = bySlug.get(slug);
  if (!e) { console.log(`${slug}: NOT IN bikepaths.yml`); continue; }
  const rel = e.osm_relations?.[0];
  const way = e.osm_way_ids?.[0];
  let tags: Record<string, string> = {};
  let qk = '';
  if (rel !== undefined) { tags = await queryTags('relation', rel); qk = `rel:${rel}`; }
  else if (way !== undefined) { tags = await queryTags('way', way); qk = `way:${way}`; }
  else { console.log(`${slug}: no OSM id`); continue; }
  const lines = KEY_TAGS.filter((t) => tags[t]).map((t) => `${t}=${tags[t]}`);
  console.log(`\n${slug}  (${qk}, pipeline has: ${e.highway ?? '-'}/${e.bicycle ?? '-'}/${e.surface ?? '-'}/${e.path_type}/${e.type})`);
  console.log(`  OSM: ${lines.join(' ') || '(no tags)'}`);
}
