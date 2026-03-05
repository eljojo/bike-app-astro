import 'dotenv/config';
// E2E test guard: if CONTENT_DIR is a git repo, reset working tree to the
// initial commit. Prevents stale modifications from previous test runs whose
// async git operations may race with the next build.
import { execSync as _execSync } from 'node:child_process';
import { existsSync as _existsSync } from 'node:fs';
if (process.env.CONTENT_DIR && _existsSync(process.env.CONTENT_DIR + '/.git')) {
  try {
    const _root = _execSync('git rev-list --max-parents=0 HEAD', { cwd: process.env.CONTENT_DIR }).toString().trim();
    _execSync(`git reset --hard ${_root}`, { cwd: process.env.CONTENT_DIR, stdio: 'ignore' });
  } catch { /* not a git repo or no HEAD */ }
}
import { defineConfig } from 'astro/config';
import { getAdapter } from './src/lib/adapter';
import preact from '@astrojs/preact';
import { i18nRoutes } from './src/integrations/i18n-routes';
import { adminRoutesIntegration } from './src/integrations/admin-routes';
import { slugRedirectLines } from './src/lib/slug-redirects.ts';
import { buildDataPlugin } from './src/build-data-plugin';
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
  site: process.env.SITE_URL || 'https://ottawabybike.ca',
  adapter: await getAdapter(process.env.RUNTIME),
  i18n: i18nConfig,
  build: {
    concurrency: 4,
  },
  integrations: [
    preact(),
    i18nRoutes(),
    adminRoutesIntegration(),
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
    build: {
      rollupOptions: {
        // When RUNTIME=local, the 'cloudflare:workers' dynamic import in env.ts
        // is dead code, but Rollup still tries to resolve it. Mark it external.
        external: process.env.RUNTIME === 'local' ? ['cloudflare:workers'] : [],
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
  },
});
