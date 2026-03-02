import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { i18nRoutes } from './src/integrations/i18n-routes';
import { slugRedirectLines } from './src/lib/slug-redirects.ts';
import { buildDataPlugin, CONTENT_DIR, CITY } from './src/build-data-plugin';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const i18nConfig = {
  defaultLocale: 'en',
  locales: ['en', 'fr'],
  routing: {
    prefixDefaultLocale: false,
  },
};

export default defineConfig({
  site: 'https://ottawabybike.ca',
  adapter: cloudflare(),
  i18n: i18nConfig,
  build: {
    concurrency: 4,
  },
  integrations: [
    i18nRoutes(),
    {
      name: 'copy-map-cache',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          const cacheDir = path.resolve('_cache', 'maps');
          const outDir = path.join(dir.pathname, '_cache', 'maps');
          if (!fs.existsSync(cacheDir)) return;
          fs.cpSync(cacheDir, outDir, { recursive: true });
        }
      }
    },
    {
      name: 'copy-gpx-files',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          const routesDir = path.join(CONTENT_DIR, CITY, 'routes');
          if (!fs.existsSync(routesDir)) return;
          for (const slug of fs.readdirSync(routesDir)) {
            const routeDir = path.join(routesDir, slug);
            if (!fs.statSync(routeDir).isDirectory()) continue;
            // Copy main GPX files
            for (const file of fs.readdirSync(routeDir)) {
              if (!file.endsWith('.gpx')) continue;
              const outDir2 = path.join(dir.pathname, 'routes', slug);
              fs.mkdirSync(outDir2, { recursive: true });
              fs.copyFileSync(path.join(routeDir, file), path.join(outDir2, file));
            }
            // Copy variant GPX files
            const variantsDir = path.join(routeDir, 'variants');
            if (fs.existsSync(variantsDir)) {
              for (const file of fs.readdirSync(variantsDir)) {
                if (!file.endsWith('.gpx')) continue;
                const variantName = file.replace(/\.gpx$/, '');
                const outDir2 = path.join(dir.pathname, 'routes', slug, variantName);
                fs.mkdirSync(outDir2, { recursive: true });
                fs.copyFileSync(path.join(variantsDir, file), path.join(outDir2, `${variantName}.gpx`));
              }
            }
          }
        }
      }
    },
    {
      name: 'generate-redirects',
      hooks: {
        'astro:build:done': async ({ dir }) => {
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

          // Translated slug rewrites for non-default locales.
          // For each locale, scan for index.{locale}.md with a slug: field.
          // Generate rewrites (200) and redirects (301).
          const locales = i18nConfig.locales;
          const defaultLoc = i18nConfig.defaultLocale;
          const translatedRedirects = [];
          if (fs.existsSync(routesDir)) {
            for (const slug of fs.readdirSync(routesDir)) {
              for (const locale of locales) {
                if (locale === defaultLoc) continue;
                const localePath = path.join(routesDir, slug, `index.${locale}.md`);
                if (!fs.existsSync(localePath)) continue;
                const raw = fs.readFileSync(localePath, 'utf-8');
                const match = raw.match(/^slug:\s*(.+)$/m);
                if (!match) continue;
                const localeSlug = match[1].trim().replace(/^["']|["']$/g, '');
                translatedRedirects.push(...slugRedirectLines(slug, localeSlug, locale));
              }
            }
          }
          if (translatedRedirects.length > 0) {
            lines.push('');
            lines.push('# Translated slug rewrites and redirects');
            lines.push(...translatedRedirects);
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
    plugins: [buildDataPlugin()],
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
  },
});
