import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * This test validates that the French homepage shows translated route
 * names and taglines from index.fr.md files, not the English originals.
 *
 * Bug: The homepage RouteCard receives route.data.name and route.data.tagline
 * directly without consulting route.data.translations for the current locale.
 * The route detail page ([slug].astro) correctly uses translations, but the
 * homepage index.astro does not.
 */
describe('French routes index', () => {
  const distDir = path.resolve('dist');
  const frIndexPath = path.join(distDir, 'fr', 'index.html');
  const frIndexExists = fs.existsSync(frIndexPath);

  it.skipIf(!frIndexExists)('should show French taglines on the French homepage, not English ones', () => {
    const html = fs.readFileSync(frIndexPath, 'utf-8');

    // The Aylmer route has a French translation with tagline "Parcours de l'année : 2022"
    // If the homepage is correctly using translations, we should NOT see the English tagline
    expect(html).not.toContain('Ride of the Year: 2022');

    // And we SHOULD see the French tagline (apostrophes may be HTML-encoded)
    expect(html).toMatch(/Parcours de l(&#39;|')année/);
  });

  it.skipIf(!frIndexExists)('should link route cards to French URLs on the French homepage', () => {
    const html = fs.readFileSync(frIndexPath, 'utf-8');

    // Route card links should go to /fr/parcours/slug (translated path), not /routes/slug
    expect(html).toContain('href="/fr/parcours/');
    expect(html).not.toMatch(/href="\/routes\/[^"]+"/);
  });
});
