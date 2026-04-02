import type { APIRoute } from 'astro';
import { getCityConfig } from '../lib/config/city-config';

export const prerender = true;

const disallow = import.meta.env.DISABLE_ANALYTICS === 'true';

export const GET: APIRoute = () => {
  if (disallow) {
    return new Response(`User-agent: *
Disallow: /
`);
  }

  const config = getCityConfig();
  return new Response(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /api

# LLM-readable site description
# See https://llmstxt.org/ for the specification
Allow: /llms.txt
Allow: /llms-full.txt

Sitemap: ${config.url}/sitemap.xml
`);
};
