import 'dotenv/config';
import { defineConfig } from 'astro/config';
import { getAdapter } from './src/lib/adapter';
import preact from '@astrojs/preact';
import { wheretoBike, cspConfig } from './src/integration.ts';

export default defineConfig({
  site: process.env.SITE_URL || 'https://ottawabybike.ca',
  adapter: await getAdapter(process.env.RUNTIME),
  security: cspConfig(),
  build: {
    concurrency: 4,
    // Inline all CSS into <style> tags in the HTML response.
    //
    // Why: Astro SSR places external stylesheets for server-rendered pages
    // in dist/server/_astro/, but @astrojs/node's static file handler only
    // serves from dist/client/_astro/. This means any CSS that Astro emits
    // as a <link> tag for an SSR page (admin pages, API endpoints) will 404
    // — the browser requests it, the static handler can't find it in the
    // client directory, the SSR handler doesn't know how to serve raw files,
    // and the request falls through to a 404.
    //
    // With 'always', Astro embeds CSS directly in <style> tags in the HTML.
    // No external file requests, no 404s, no split between server/client dirs.
    //
    // This affects all pages (static and SSR), but static pages are prerendered
    // to HTML files anyway, so the inline styles just travel with the document.
    // The trade-off is slightly larger HTML responses (no separate cached CSS
    // files), but for an admin interface this is negligible.
    inlineStylesheets: 'always',
  },
  integrations: [
    preact(),
    ...wheretoBike(),
  ],
});
