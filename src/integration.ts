/**
 * Integration factory for bike-app-astro.
 *
 * External repos consume this package by spreading the returned array into
 * their Astro `integrations` config:
 *
 *   import { wheretoBike } from 'bike-app-astro';
 *   export default defineConfig({
 *     integrations: [preact(), ...wheretoBike({ contentDir: '.', city: 'blog' })],
 *   });
 *
 * When called without options (dogfooding from this repo's own astro.config.mjs),
 * it falls back to process.env values.
 */
import type { AstroIntegration } from 'astro';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { getCityConfig } from './lib/city-config';
import { CONTENT_DIR, CITY } from './lib/config';
import { sharedCspDirectives } from './lib/csp';
import { slugRedirectLines } from './lib/slug-redirects';
import { buildDataPlugin } from './build-data-plugin';
import { i18nRoutes } from './integrations/i18n-routes';
import { appRoutesIntegration } from './integrations/admin-routes';

/**
 * Returns CSP security config for use in defineConfig().
 * Astro's updateConfig() doesn't support the security field, so this must
 * be set directly in defineConfig() by the consumer.
 */
export function cspConfig() {
  return {
    csp: {
      directives: sharedCspDirectives(),
      styleDirective: {
        resources: ["'self'", "'unsafe-inline'"],
      },
    },
  };
}

export interface WheretoBikeOptions {
  /** Path to the content data directory. Defaults to process.env.CONTENT_DIR. */
  contentDir?: string;
  /** City slug to load. Defaults to process.env.CITY. */
  city?: string;
  /**
   * Root directory of the consuming project (for public/, .astro/, _cache/).
   * Defaults to the package root when not specified.
   */
  consumerRoot?: string;
}

function patchStaticCspStyles(rootDir: string) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      const html = fs.readFileSync(full, 'utf-8');
      const patched = html.replace(
        /(content="[^"]*?)style-src\s+[^;]+;([^"]*")/i,
        `$1style-src 'self' 'unsafe-inline';$2`,
      );
      if (patched !== html) {
        fs.writeFileSync(full, patched);
      }
    }
  }
}

/**
 * Auto-detect the city slug by scanning a content directory for subdirectories
 * containing config.yml. If exactly one is found, return it. This lets consumer
 * repos (blog, club) skip setting CITY= when the content layout is unambiguous.
 */
function detectCity(contentDir: string): string | null {
  if (!fs.existsSync(contentDir)) return null;
  const candidates = fs.readdirSync(contentDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(contentDir, e.name, 'config.yml')))
    .map(e => e.name);
  return candidates.length === 1 ? candidates[0] : null;
}

function detectBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Returns an array of Astro integrations that wire up the full whereto.bike
 * platform. Spread into your integrations config alongside preact().
 */
export function wheretoBike(options?: WheretoBikeOptions): AstroIntegration[] {
  // Set env vars from options BEFORE anything reads them (city-config, config.ts).
  if (options?.contentDir) {
    process.env.CONTENT_DIR = options.contentDir;
  }
  if (options?.city) {
    process.env.CITY = options.city;
  }

  // Auto-detect CITY for consumer repos: scan the content directory for a single
  // city folder containing config.yml. Blog repos always have blog/config.yml,
  // club repos have their club folder — no need to set CITY explicitly.
  if (!process.env.CITY && options?.consumerRoot) {
    const contentDir = process.env.CONTENT_DIR || options.consumerRoot;
    const detected = detectCity(contentDir);
    if (detected) {
      process.env.CITY = detected;
    }
  }

  const consumerRoot = options?.consumerRoot;

  // Derive i18n config from city config.yml (same logic as previous astro.config.mjs).
  const cityConfig = getCityConfig();
  const cityLocales = (cityConfig.locales || [cityConfig.locale]).map(
    (l: string) => l.split('-')[0],
  );
  const i18nConfig = {
    defaultLocale: cityLocales[0] as string,
    locales: cityLocales as string[],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
      fallbackType: 'redirect' as const,
    },
  };

  const setupIntegration: AstroIntegration = {
    name: 'whereto-bike-setup',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          i18n: i18nConfig,
          vite: {
            resolve: {
              alias: {
                '@/': path.join(import.meta.dirname, '/'),
              },
            },
            define: {
              __APP_BRANCH__: JSON.stringify(detectBranch()),
              __CITY__: JSON.stringify(CITY),
            },
            plugins: [buildDataPlugin({ consumerRoot })],
            build: {
              rollupOptions: {
                // When RUNTIME=local, the 'cloudflare:workers' dynamic import in env.ts
                // is dead code, but Rollup still tries to resolve it. Mark it external.
                external: process.env.RUNTIME === 'local' ? ['cloudflare:workers'] : [],
              },
            },
            // Ensure Preact JSX transform works for components inside node_modules.
            // @preact/preset-vite excludes node_modules by default; this fallback
            // makes Vite's esbuild transform use Preact for any files the plugin skips.
            esbuild: {
              jsx: 'automatic',
              jsxImportSource: 'preact',
            },
          },
        });
      },
    },
  };

  const copyPublicAssets: AstroIntegration = {
    name: 'copy-public-assets',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const packagePublic = path.join(import.meta.dirname, '..', 'public');
        if (!fs.existsSync(packagePublic)) return;
        // Copy fonts (and any other public assets) from the package into build output
        for (const entry of fs.readdirSync(packagePublic, { withFileTypes: true })) {
          const src = path.join(packagePublic, entry.name);
          const dest = path.join(dir.pathname, entry.name);
          if (entry.isDirectory()) {
            fs.cpSync(src, dest, { recursive: true, force: false });
          } else if (entry.isFile() && !fs.existsSync(dest)) {
            fs.copyFileSync(src, dest);
          }
        }
      },
    },
  };

  const copyMapCache: AstroIntegration = {
    name: 'copy-map-cache',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const cacheDir = path.join(consumerRoot || process.cwd(), '_cache', 'maps');
        const outDir = path.join(dir.pathname, '_cache', 'maps');
        if (!fs.existsSync(cacheDir)) return;
        fs.cpSync(cacheDir, outDir, { recursive: true });
      },
    },
  };

  const generateRedirects: AstroIntegration = {
    name: 'generate-redirects',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const redirectsPath = path.join(CONTENT_DIR, CITY, 'redirects.yml');
        const data = fs.existsSync(redirectsPath)
          ? (yaml.load(fs.readFileSync(redirectsPath, 'utf-8')) as Record<string, unknown>) || {}
          : {};
        const lines = ['# Generated from redirects.yml + per-route redirects'];
        const sections: Record<string, string> = {
          routes: '/routes/',
          guides: '/guides/',
          videos: '/videos/',
          tours: '/tours/',
        };
        for (const [key, prefix] of Object.entries(sections)) {
          const entries = data[key] as Array<{ from: string; to: string }> | undefined;
          if (entries) {
            for (const r of entries) lines.push(`${prefix}${r.from}  ${prefix}${r.to}  301`);
          }
        }

        // Ride redirects are handled by middleware (virtual:bike-app/ride-redirects)
        const shortUrls = data.short_urls as Array<{ from: string; to: string }> | undefined;
        if (shortUrls) {
          for (const r of shortUrls) lines.push(`/${r.from}  ${r.to}  301`);
        }

        // Per-route redirects from each route's redirects.yml
        const routesDir = path.join(CONTENT_DIR, CITY, 'routes');
        if (fs.existsSync(routesDir)) {
          for (const slug of fs.readdirSync(routesDir)) {
            const routeRedirects = path.join(routesDir, slug, 'redirects.yml');
            if (!fs.existsSync(routeRedirects)) continue;
            const routeEntries = yaml.load(fs.readFileSync(routeRedirects, 'utf-8'));
            if (Array.isArray(routeEntries)) {
              for (const from of routeEntries) lines.push(`${from}  /routes/${slug}  301`);
            }
          }
        }

        // Translated slug rewrites for non-default locales.
        const locales = i18nConfig.locales;
        const defaultLoc = i18nConfig.defaultLocale;
        const translatedRedirects: string[] = [];
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
      },
    },
  };

  // Astro SSR places external stylesheets for server-rendered pages in
  // dist/server/_astro/, but @astrojs/node's static file handler only serves
  // from dist/client/_astro/. Any CSS that Astro emits as a <link> tag for
  // an SSR page (admin pages, API endpoints) will 404 — the browser requests
  // it, the static handler can't find it in the client directory, and the
  // request falls through to a 404.
  //
  // This integration copies CSS files from server to client after the build,
  // so @astrojs/node can serve them. Only files that don't already exist in
  // client are copied (static page CSS is already there).
  const copyServerCssToClient: AstroIntegration = {
    name: 'copy-server-css-to-client',
    hooks: {
      'astro:build:done': async () => {
        const serverAssets = path.join(process.cwd(), 'dist', 'server', '_astro');
        const clientAssets = path.join(process.cwd(), 'dist', 'client', '_astro');
        if (!fs.existsSync(serverAssets)) {
          console.log('[copy-server-css] No server assets dir:', serverAssets);
          return;
        }
        const cssFiles = fs.readdirSync(serverAssets).filter(f => f.endsWith('.css'));
        console.log(`[copy-server-css] Found ${cssFiles.length} CSS files in server/_astro`);
        if (!fs.existsSync(clientAssets)) fs.mkdirSync(clientAssets, { recursive: true });
        for (const file of fs.readdirSync(serverAssets)) {
          if (!file.endsWith('.css')) continue;
          const dest = path.join(clientAssets, file);
          if (!fs.existsSync(dest)) {
            fs.copyFileSync(path.join(serverAssets, file), dest);
          }
        }
      },
    },
  };

  const patchCspStyleSrc: AstroIntegration = {
    name: 'patch-static-csp-style-src',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        patchStaticCspStyles(dir.pathname);
      },
    },
  };

  return [
    setupIntegration,
    i18nRoutes(),
    appRoutesIntegration(),
    copyPublicAssets,
    copyMapCache,
    generateRedirects,
    copyServerCssToClient,
    patchCspStyleSrc,
  ];
}
