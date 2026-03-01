import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const contentDir = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
const city = process.env.CITY || 'ottawa';
const cityDir = path.join(contentDir, city);

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

// Check guide pages exist for every guide in the data repo
const guidesDir = path.join(cityDir, 'guides');
if (fs.existsSync(guidesDir)) {
  for (const f of fs.readdirSync(guidesDir)) {
    if (!f.endsWith('.md')) continue;
    const slug = f.replace('.md', '');
    if (!fs.existsSync(path.join(distDir, 'guides', slug, 'index.html'))) {
      console.error(`MISSING GUIDE: /guides/${slug}`);
      errors++;
    }
  }
}

const routeCount = fs.existsSync(routesDir) ? fs.readdirSync(routesDir).filter(s => fs.statSync(path.join(routesDir, s)).isDirectory() && fs.existsSync(path.join(routesDir, s, 'index.md'))).length : 0;
const guideCount = fs.existsSync(guidesDir) ? fs.readdirSync(guidesDir).filter(f => f.endsWith('.md')).length : 0;
console.log(`Checked ${expectedPages.length} pages, ${routeCount} routes, ${guideCount} guides`);
console.log(`\nValidation: ${errors === 0 ? 'PASS' : `FAIL — ${errors} errors`}`);
process.exit(errors > 0 ? 1 : 0);
