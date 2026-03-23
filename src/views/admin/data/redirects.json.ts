import type { APIRoute } from 'astro';
import { cityDir } from '../../../lib/config/config.server';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const prerender = true;

/** Prerendered JSON of the route redirect map from redirects.yml. */
export const GET: APIRoute = () => {
  const redirectsPath = path.join(cityDir, 'redirects.yml');
  const redirectMap: Record<string, string> = {};

  if (fs.existsSync(redirectsPath)) {
    const data = yaml.load(fs.readFileSync(redirectsPath, 'utf-8')) as Record<string, Array<{ from: string; to: string }>> | null;
    if (data?.routes) {
      for (const r of data.routes) {
        redirectMap[r.from] = r.to;
      }
    }
  }

  return new Response(JSON.stringify(redirectMap), {
    headers: { 'Content-Type': 'application/json' },
  });
};
