import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { cityDir } from '../src/lib/config/config.server';
import { loadBikePathEntries } from '../src/lib/bike-paths/bike-path-entries.server';

// Cloudflare adapter outputs to dist/client/, plain Astro to dist/
const base = path.resolve('dist');
const distDir = fs.existsSync(path.join(base, 'client')) ? path.join(base, 'client') : base;

const expectedPages = [
  'index.html', 'about/index.html', 'calendar/index.html',
  'map/index.html', 'videos/index.html', 'guides/index.html',
  'sitemap.xml', 'robots.txt', 'calendar.ics', 'rss.xml', 'llms.txt',
];

let errors = 0;

for (const page of expectedPages) {
  const pagePath = path.join(distDir, page);
  if (!fs.existsSync(pagePath)) {
    console.error(`MISSING: ${page}`);
    errors++;
  } else {
    console.log(`OK: ${page}`);
  }
}

// Check route pages exist for every route directory in the data repo
const routesDir = path.join(cityDir, 'routes');
if (fs.existsSync(routesDir)) {
  for (const slug of fs.readdirSync(routesDir)) {
    const indexPath = path.join(routesDir, slug, 'index.md');
    if (!fs.statSync(path.join(routesDir, slug)).isDirectory()) continue;
    if (!fs.existsSync(indexPath)) continue;
    if (!fs.existsSync(path.join(distDir, 'routes', slug, 'index.html'))) {
      console.error(`MISSING ROUTE: /routes/${slug}`);
      errors++;
    }
  }
}

// Check GPX downloads exist for routes that have variant GPX files
if (fs.existsSync(routesDir)) {
  for (const slug of fs.readdirSync(routesDir)) {
    const routeDir = path.join(routesDir, slug);
    if (!fs.statSync(routeDir).isDirectory()) continue;
    const variantsDir = path.join(routeDir, 'variants');
    const gpxFiles = fs.existsSync(variantsDir)
      ? fs.readdirSync(variantsDir).filter(f => f.endsWith('.gpx'))
      : fs.readdirSync(routeDir).filter(f => f.endsWith('.gpx'));
    for (const gpx of gpxFiles) {
      const variantSlug = gpx.replace(/\.gpx$/i, '');
      const gpxPath = path.join(distDir, 'routes', slug, `${variantSlug}.gpx`);
      if (!fs.existsSync(gpxPath)) {
        console.error(`MISSING GPX: /routes/${slug}/${variantSlug}.gpx`);
        errors++;
      }
    }
  }
}

// Check guide pages exist for every guide in the data repo
const guidesDir = path.join(cityDir, 'guides');
if (fs.existsSync(guidesDir)) {
  for (const f of fs.readdirSync(guidesDir)) {
    if (!f.endsWith('.md')) continue;
    // Skip translation files (e.g. bike-crash.fr.md) — only validate base language
    if (/\.\w{2}\.md$/.test(f)) continue;
    const slug = f.replace('.md', '');
    if (!fs.existsSync(path.join(distDir, 'guides', slug, 'index.html'))) {
      console.error(`MISSING GUIDE: /guides/${slug}`);
      errors++;
    }
  }
}

// Check bike path detail pages exist for every standalone entry. `standalone` is
// the single source of truth for "does this have a page" (see bike-path-entries.server.ts)
// — it already encodes the isDestination rule (type, markdown overrides, network
// aggregation eligibility), so we don't hand-roll type-based filtering here.
// Members of a network live at /bike-paths/<network>/<slug>; everything else
// (standalone paths and network pages themselves) is flat at /bike-paths/<slug>.
const bikepathsYmlPath = path.join(cityDir, 'bikepaths.yml');
let bikePathCount = 0;
if (fs.existsSync(bikepathsYmlPath)) {
  const { pages: bikePathPages } = loadBikePathEntries();
  const standalonePages = bikePathPages.filter(p => p.standalone);
  bikePathCount = standalonePages.length;
  for (const page of standalonePages) {
    const urlPath = page.memberOf ? `bike-paths/${page.memberOf}/${page.slug}` : `bike-paths/${page.slug}`;
    if (!fs.existsSync(path.join(distDir, urlPath, 'index.html'))) {
      console.error(`MISSING BIKE PATH: /${urlPath}`);
      errors++;
    }
  }
}

const routeCount = fs.existsSync(routesDir) ? fs.readdirSync(routesDir).filter(s => fs.statSync(path.join(routesDir, s)).isDirectory() && fs.existsSync(path.join(routesDir, s, 'index.md'))).length : 0;
const guideCount = fs.existsSync(guidesDir) ? fs.readdirSync(guidesDir).filter(f => f.endsWith('.md') && !/\.\w{2}\.md$/.test(f)).length : 0;
const gpxCount = fs.existsSync(distDir) ? fs.readdirSync(path.join(distDir, 'routes'), { recursive: true }).filter(f => String(f).endsWith('.gpx')).length : 0;
console.log(`Checked ${expectedPages.length} pages, ${routeCount} routes, ${guideCount} guides, ${gpxCount} GPX files, ${bikePathCount} bike paths`);
console.log(`\nValidation: ${errors === 0 ? 'PASS' : `FAIL — ${errors} errors`}`);
process.exit(errors > 0 ? 1 : 0);
