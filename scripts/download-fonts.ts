import fs from 'node:fs';
import path from 'node:path';

const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,400;0,700;1,400&family=Source+Sans+Pro:wght@400;700&display=swap';
// Use a modern browser UA to get woff2 responses
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FONTS_DIR = path.resolve('public/fonts');
const CSS_PATH = path.resolve('src/styles/_webfonts.scss');

async function main() {
  console.log(`Downloading fonts from ${FONTS_URL}`);

  const res = await fetch(FONTS_URL, { headers: { 'User-Agent': USER_AGENT } });
  let css = await res.text();

  fs.mkdirSync(FONTS_DIR, { recursive: true });

  // Find all font URLs and download them
  const urlRegex = /url\((https?:\/\/[^)]+\.woff2)\)/gi;
  const urls = new Set<string>();
  let match;
  while ((match = urlRegex.exec(css)) !== null) {
    urls.add(match[1]);
  }

  for (const url of urls) {
    const name = path.basename(new URL(url).pathname);
    console.log(`  - ${name}`);
    const fontRes = await fetch(url);
    const buffer = Buffer.from(await fontRes.arrayBuffer());
    fs.writeFileSync(path.join(FONTS_DIR, name), buffer);
  }

  // Rewrite CSS to use local paths
  css = css.replace(/url\((https?:\/\/[^)]+\.woff2)\)/gi, (_match, url) => {
    const name = path.basename(new URL(url).pathname);
    return `url('/fonts/${name}')`;
  });

  fs.writeFileSync(CSS_PATH, css);
  console.log(`\nWrote ${CSS_PATH}`);
  console.log(`Downloaded ${urls.size} font files to ${FONTS_DIR}`);
}

main();
