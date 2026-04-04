import { describe, it, expect } from 'vitest';
import { resolvePageForYmlSlug, buildYmlSlugIndex, resolvePageForYmlSlugIndexed } from '../src/lib/bike-paths/resolve-page';

interface MinimalPage {
  slug: string;
  name: string;
  memberOf?: string;
  length_km?: number;
  thumbnail_key?: string;
  standalone: boolean;
  translations: Record<string, { name?: string }>;
  ymlEntries: Array<{ slug: string }>;
}

function page(overrides: Partial<MinimalPage> & { slug: string; name: string }): MinimalPage {
  return {
    standalone: true,
    translations: {},
    ymlEntries: [{ slug: overrides.slug }],
    ...overrides,
  };
}

const pages: MinimalPage[] = [
  page({
    slug: 'ottawa-river-pathway',
    name: 'Ottawa River Pathway',
    memberOf: 'capital-pathway',
    length_km: 30,
    translations: { fr: { name: 'Sentier de la rivière des Outaouais' } },
  }),
  page({
    slug: 'prescott-russell-trail',
    name: 'Prescott-Russell Trail',
    length_km: 72,
  }),
  page({
    slug: 'grouped-parent',
    name: 'Grouped Parent',
    ymlEntries: [
      { slug: 'grouped-parent' },
      { slug: 'child-a' },
      { slug: 'child-b' },
    ],
  }),
];

describe('resolvePageForYmlSlug', () => {
  it('resolves a direct page slug', () => {
    const ref = resolvePageForYmlSlug('prescott-russell-trail', pages);
    expect(ref).toBeDefined();
    expect(ref!.slug).toBe('prescott-russell-trail');
    expect(ref!.name).toBe('Prescott-Russell Trail');
    expect(ref!.length_km).toBe(72);
    expect(ref!.standalone).toBe(true);
    expect(ref!.networkSlug).toBeUndefined();
  });

  it('resolves a network member with nested URL', () => {
    const ref = resolvePageForYmlSlug('ottawa-river-pathway', pages);
    expect(ref).toBeDefined();
    expect(ref!.url).toBe('/bike-paths/capital-pathway/ottawa-river-pathway/');
    expect(ref!.networkSlug).toBe('capital-pathway');
  });

  it('resolves absorbed child slug to parent page', () => {
    const ref = resolvePageForYmlSlug('child-a', pages);
    expect(ref).toBeDefined();
    expect(ref!.slug).toBe('grouped-parent');
    expect(ref!.name).toBe('Grouped Parent');
  });

  it('returns localized name when locale provided', () => {
    const ref = resolvePageForYmlSlug('ottawa-river-pathway', pages, 'fr');
    expect(ref).toBeDefined();
    expect(ref!.name).toBe('Sentier de la rivière des Outaouais');
  });

  it('returns undefined for unknown slug', () => {
    expect(resolvePageForYmlSlug('nonexistent', pages)).toBeUndefined();
  });
});

describe('buildYmlSlugIndex + resolvePageForYmlSlugIndexed', () => {
  const index = buildYmlSlugIndex(pages);

  it('builds an index that covers page slugs and ymlEntry slugs', () => {
    expect(index.has('ottawa-river-pathway')).toBe(true);
    expect(index.has('child-a')).toBe(true);
    expect(index.has('child-b')).toBe(true);
    expect(index.has('grouped-parent')).toBe(true);
  });

  it('resolves via indexed lookup', () => {
    const ref = resolvePageForYmlSlugIndexed('child-b', index);
    expect(ref).toBeDefined();
    expect(ref!.slug).toBe('grouped-parent');
  });
});
