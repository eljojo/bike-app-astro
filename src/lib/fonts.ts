import fs from 'node:fs';
import path from 'node:path';

let cached: string[] | null = null;

export function getFontPreloads(): string[] {
  if (cached) return cached;
  const webfontsPath = path.resolve('src/styles/_webfonts.scss');
  const content = fs.readFileSync(webfontsPath, 'utf-8');
  const latinRegex = /\/\* latin \*\/\s*@font-face\s*\{[^}]*url\('([^']+)'\)/g;
  const urls: string[] = [];
  let match;
  while ((match = latinRegex.exec(content)) !== null) {
    urls.push(match[1]);
  }
  cached = [...new Set(urls)];
  return cached;
}
