import 'dotenv/config';
import { defineConfig } from 'astro/config';
import { getAdapter } from './src/lib/env/adapter';
import preact from '@astrojs/preact';
import { wheretoBike, cspConfig } from './src/integration.ts';

export default defineConfig({
  site: process.env.SITE_URL || 'https://ottawabybike.ca',
  adapter: await getAdapter(process.env.RUNTIME),
  security: cspConfig(),
  build: {
    concurrency: 4,
  },
  integrations: [
    preact(),
    ...wheretoBike(),
  ],
});
