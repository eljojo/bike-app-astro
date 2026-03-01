import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  build: {
    concurrency: 4,
  },
  integrations: [
    {
      name: 'copy-map-cache',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const cacheDir = path.resolve('_cache', 'maps');
          const outDir = path.join(dir.pathname, '_cache', 'maps');
          if (!fs.existsSync(cacheDir)) return;
          fs.cpSync(cacheDir, outDir, { recursive: true });
        }
      }
    },
    {
      name: 'generate-redirects',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const yaml = await import('js-yaml');
          const contentDir = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
          const city = process.env.CITY || 'ottawa';
          const redirectsPath = path.join(contentDir, city, 'redirects.yml');
          if (!fs.existsSync(redirectsPath)) return;

          const data = fs.existsSync(redirectsPath)
            ? yaml.load(fs.readFileSync(redirectsPath, 'utf-8')) || {}
            : {};
          const lines = ['# Generated from redirects.yml + per-route redirects'];
          const sections = { routes: '/routes/', guides: '/guides/', videos: '/videos/' };
          for (const [key, prefix] of Object.entries(sections)) {
            if (data[key]) {
              for (const r of data[key]) lines.push(`${prefix}${r.from}  ${prefix}${r.to}  301`);
            }
          }
          if (data.short_urls) {
            for (const r of data.short_urls) lines.push(`/${r.from}  ${r.to}  301`);
          }

          // Per-route redirects from each route's redirects.yml
          const routesDir = path.join(contentDir, city, 'routes');
          if (fs.existsSync(routesDir)) {
            for (const slug of fs.readdirSync(routesDir)) {
              const routeRedirects = path.join(routesDir, slug, 'redirects.yml');
              if (!fs.existsSync(routeRedirects)) continue;
              const entries = yaml.load(fs.readFileSync(routeRedirects, 'utf-8'));
              if (Array.isArray(entries)) {
                for (const from of entries) lines.push(`${from}  /routes/${slug}  301`);
              }
            }
          }
          const content = lines.join('\n');
          if (content) {
            fs.writeFileSync(path.join(dir.pathname, '_redirects'), content);
          }
        }
      }
    }
  ],
  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
  },
});
