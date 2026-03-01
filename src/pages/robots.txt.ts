import type { APIRoute } from 'astro';
import { getCityConfig } from '../lib/city-config';

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

Sitemap: ${config.url}/sitemap.xml
`);
};
