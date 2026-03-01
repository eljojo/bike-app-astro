import { describe, it, expect } from 'vitest';
import { slugRedirectLines } from '../src/lib/slug-redirects';

describe('slugRedirectLines', () => {
  it('returns empty array when locale slug matches default slug', () => {
    expect(slugRedirectLines('wakefield', 'wakefield', 'fr')).toEqual([]);
  });

  it('generates rewrite and redirect lines for translated slug', () => {
    const lines = slugRedirectLines('easy-loop-around-the-canal', 'boucle-facile-autour-du-canal', 'fr');
    expect(lines).toHaveLength(4);

    // 200 rewrite: French slug → English slug page (invisible proxy)
    expect(lines[0]).toBe('/fr/parcours/boucle-facile-autour-du-canal  /fr/parcours/easy-loop-around-the-canal/  200');
    // 200 rewrite for map subpage
    expect(lines[1]).toBe('/fr/parcours/boucle-facile-autour-du-canal/carte  /fr/parcours/easy-loop-around-the-canal/carte/  200');
    // 301 redirect: English slug → French slug
    expect(lines[2]).toBe('/fr/parcours/easy-loop-around-the-canal  /fr/parcours/boucle-facile-autour-du-canal  301');
    // 301 redirect for map subpage
    expect(lines[3]).toBe('/fr/parcours/easy-loop-around-the-canal/carte  /fr/parcours/boucle-facile-autour-du-canal/carte  301');
  });

  it('200 rewrite targets always have trailing slashes', () => {
    const lines = slugRedirectLines('east-end-petrie-island', 'est-ile-petrie', 'fr');
    const rewrites = lines.filter(l => l.endsWith('200'));
    for (const line of rewrites) {
      // target is the second field — must end with /
      const target = line.split(/\s{2,}/)[1];
      expect(target).toMatch(/\/$/);
    }
  });

  it('301 redirect targets do NOT have trailing slashes', () => {
    const lines = slugRedirectLines('east-end-petrie-island', 'est-ile-petrie', 'fr');
    const redirects = lines.filter(l => l.endsWith('301'));
    for (const line of redirects) {
      const target = line.split(/\s{2,}/)[1];
      expect(target).not.toMatch(/\/$/);
    }
  });

  it('translates path segments correctly for French', () => {
    const lines = slugRedirectLines('my-route', 'mon-parcours', 'fr');
    // "routes" → "parcours", "map" → "carte" for fr locale
    expect(lines[0]).toContain('/fr/parcours/mon-parcours');
    expect(lines[1]).toContain('/carte');
  });
});
