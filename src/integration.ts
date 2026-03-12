/**
 * Integration factory for bike-app-astro.
 *
 * External repos consume this package by spreading the returned array into
 * their Astro `integrations` config:
 *
 *   import { wheretoBike } from 'bike-app-astro';
 *   export default defineConfig({
 *     integrations: [preact(), ...wheretoBike({ contentDir: '.', city: 'jose' })],
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
import { sharedCspDirectives } from './lib/csp';
import { slugRedirectLines } from './lib/slug-redirects';
import { buildDataPlugin } from './build-data-plugin';
import { i18nRoutes } from './integrations/i18n-routes';
import { appRoutesIntegration } from './integrations/admin-routes';
import { isBlogInstance } from './lib/city-config';
import { findGpxFiles, extractDateFromPath, buildSlug, detectTours } from './loaders/rides';
import matter from 'gray-matter';

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

  const consumerRoot = options?.consumerRoot;

  // Derive i18n config from city config.yml (same logic as previous astro.config.mjs).
  const cityConfig = getCityConfig();
  const cityLocales = (cityConfig.locales || [cityConfig.locale]).map(
    (l: string) => l.split('-')[0],
  );
  const multiLocale = cityLocales.length > 1;
  const i18nConfig = {
    defaultLocale: cityLocales[0] as string,
    locales: cityLocales as string[],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: multiLocale,
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
        const contentDir = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
        const city = process.env.CITY || 'ottawa';
        const redirectsPath = path.join(contentDir, city, 'redirects.yml');
        const data = fs.existsSync(redirectsPath)
          ? (yaml.load(fs.readFileSync(redirectsPath, 'utf-8')) as Record<string, unknown>) || {}
          : {};
        const lines = ['# Generated from redirects.yml + per-route redirects'];
        const sections: Record<string, string> = {
          routes: '/routes/',
          guides: '/guides/',
          videos: '/videos/',
          rides: '/rides/',
          tours: '/tours/',
        };
        for (const [key, prefix] of Object.entries(sections)) {
          const entries = data[key] as Array<{ from: string; to: string }> | undefined;
          if (entries) {
            for (const r of entries) lines.push(`${prefix}${r.from}  ${prefix}${r.to}  301`);
          }
        }
        const shortUrls = data.short_urls as Array<{ from: string; to: string }> | undefined;
        if (shortUrls) {
          for (const r of shortUrls) lines.push(`/${r.from}  ${r.to}  301`);
        }

        // Per-route redirects from each route's redirects.yml
        const routesDir = path.join(contentDir, city, 'routes');
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

        // Blog ride redirects: date-prefixed → name-only, /rides/ → /tours/ for tour rides
        if (isBlogInstance()) {
          const ridesDir = path.join(contentDir, city, 'rides');
          if (fs.existsSync(ridesDir)) {
            const gpxPaths = findGpxFiles(ridesDir);
            const tours = detectTours(gpxPaths);
            const tourByGpxPath = new Map<string, string>();
            for (const tour of tours) {
              for (const ridePath of tour.ridePaths) {
                tourByGpxPath.set(ridePath, tour.slug);
              }
            }

            const rideRedirects: string[] = [];
            for (const gpxRelPath of gpxPaths) {
              const date = extractDateFromPath(gpxRelPath);
              if (!date) continue;

              const gpxFilename = path.basename(gpxRelPath);
              const gpxAbsPath = path.join(ridesDir, gpxRelPath);

              // Read sidecar for handle
              let handle: string | undefined;
              const sidecarPath = gpxAbsPath.replace(/\.gpx$/i, '.md');
              if (fs.existsSync(sidecarPath)) {
                const { data: fm } = matter(fs.readFileSync(sidecarPath, 'utf-8'));
                handle = fm.handle as string | undefined;
              }

              const newSlug = buildSlug(date, gpxFilename, handle);
              const tourSlug = tourByGpxPath.get(gpxRelPath);

              // Compute old date-prefixed slug using the same date-aware stripping
              const mm = String(date.month).padStart(2, '0');
              const dd = String(date.day).padStart(2, '0');
              const oldSlug = `${date.year}-${mm}-${dd}-${newSlug}`;

              const canonicalUrl = tourSlug
                ? `/tours/${tourSlug}/${newSlug}`
                : `/rides/${newSlug}`;

              // Redirect old date-prefixed URL → canonical
              if (oldSlug !== newSlug) {
                rideRedirects.push(`/rides/${oldSlug}  ${canonicalUrl}  301`);
                rideRedirects.push(`/rides/${oldSlug}/map  ${canonicalUrl}/map  301`);
              }

              // Redirect /rides/{slug} → /tours/{tour}/{slug} for tour rides
              if (tourSlug) {
                rideRedirects.push(`/rides/${newSlug}  /tours/${tourSlug}/${newSlug}  301`);
                rideRedirects.push(`/rides/${newSlug}/map  /tours/${tourSlug}/${newSlug}/map  301`);
              }
            }

            // Deduplicate redirects (multiple rides can share a slug after name stripping)
            const uniqueRedirects = [...new Set(rideRedirects)];
            if (uniqueRedirects.length > 0) {
              lines.push('');
              lines.push('# Ride redirects: date-prefixed → name-only, standalone → tour-nested');
              lines.push(...uniqueRedirects);
            }
          }
        }

        const content = lines.join('\n');
        if (content) {
          fs.writeFileSync(path.join(dir.pathname, '_redirects'), content);
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
    patchCspStyleSrc,
  ];
}
