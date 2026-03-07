import type { APIRoute } from 'astro';
import { getCityConfig } from '../lib/city-config';

export const prerender = true;

export const GET: APIRoute = () => {
  const config = getCityConfig();
  const manifest = {
    name: config.display_name,
    short_name: config.display_name,
    start_url: '/',
    display: 'browser',
    icons: [{ src: '/bicycle.png', sizes: '180x180', type: 'image/png' }],
    theme_color: '#350091',
    background_color: '#ffffff',
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
};
