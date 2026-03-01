import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
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

          const data = yaml.load(fs.readFileSync(redirectsPath, 'utf-8'));
          const lines = ['# Generated from redirects.yml'];
          const sections = { routes: '/routes/', guides: '/guides/', videos: '/videos/' };
          for (const [key, prefix] of Object.entries(sections)) {
            if (data[key]) {
              for (const r of data[key]) lines.push(`${prefix}${r.from}  ${prefix}${r.to}  301`);
            }
          }
          if (data.short_urls) {
            for (const r of data.short_urls) lines.push(`/${r.from}  ${r.to}  301`);
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
