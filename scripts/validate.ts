import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const goldenDir = path.resolve(process.env.GOLDEN_TESTS_DIR || '../bike-routes-golden-tests');

const expectedPages = [
  'index.html', 'about/index.html', 'calendar/index.html',
  'map/index.html', 'videos/index.html', 'guides/index.html',
  'sitemap.xml', 'robots.txt', 'calendar.ics',
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

// Check route pages from golden tests
const routesDir = path.join(goldenDir, 'routes');
if (fs.existsSync(routesDir)) {
  for (const f of fs.readdirSync(routesDir)) {
    if (!f.endsWith('.html') || f === 'index.html' || f.endsWith('-map.html')) continue;
    const slug = f.replace('.html', '');
    if (!fs.existsSync(path.join(distDir, 'routes', slug, 'index.html'))) {
      console.error(`MISSING ROUTE: /routes/${slug}`);
      errors++;
    }
  }
}

// Check guide pages from golden tests
const guidesDir = path.join(goldenDir, 'guides');
if (fs.existsSync(guidesDir)) {
  for (const f of fs.readdirSync(guidesDir)) {
    if (!f.endsWith('.html') || f === 'index.html') continue;
    const slug = f.replace('.html', '');
    if (!fs.existsSync(path.join(distDir, 'guides', slug, 'index.html'))) {
      console.error(`MISSING GUIDE: /guides/${slug}`);
      errors++;
    }
  }
}

console.log(`\nValidation: ${errors === 0 ? 'PASS' : `${errors} errors`}`);
process.exit(errors > 0 ? 1 : 0);
