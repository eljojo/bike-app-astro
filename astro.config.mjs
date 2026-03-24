import 'dotenv/config';
import { defineConfig } from 'astro/config';
import { getAdapter } from './src/lib/env/adapter';
import preact from '@astrojs/preact';
import { wheretoBike, cspConfig } from './src/integration.ts';

const devHost = process.env.DEV_HOST;

export default defineConfig({
  site: process.env.SITE_URL || 'https://ottawabybike.ca',
  adapter: await getAdapter(process.env.RUNTIME),
  security: cspConfig(),
  build: {
    concurrency: 4,
  },
  server: devHost ? { host: '0.0.0.0' } : {},
  vite: devHost ? { server: { allowedHosts: [devHost] } } : {},
  integrations: [
    preact(),
    ...wheretoBike(),
  ],
});
