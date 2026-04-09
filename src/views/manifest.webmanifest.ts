import type { APIRoute } from 'astro';
import { getCityConfig } from '../lib/config/city-config';

export const prerender = true;

export const GET: APIRoute = () => {
  const config = getCityConfig();

  const manifest = {
    name: config.display_name,
    short_name: config.display_name,
    start_url: '/',
    display: 'standalone' as const,
    theme_color: '#fbfbfc',
    background_color: '#fbfbfc',
    icons: [
      { src: '/bicycle.png', sizes: '192x192', type: 'image/png' },
      { src: '/bicycle.png', sizes: '512x512', type: 'image/png' },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
};
