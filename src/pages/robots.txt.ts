import type { APIRoute } from 'astro';

const disallow = import.meta.env.DISABLE_ANALYTICS === 'true';

export const GET: APIRoute = () => {
  if (disallow) {
    return new Response(`User-agent: *
Disallow: /
`);
  }

  return new Response(`User-agent: *
Allow: /

Sitemap: https://ottawabybike.ca/sitemap.xml
`);
};
