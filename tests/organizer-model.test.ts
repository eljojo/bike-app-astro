import { describe, it, expect } from 'vitest';
import type { CollectionEntry } from 'astro:content';
import { hasDetailPage } from '../src/lib/models/organizer-model';

type Org = CollectionEntry<'organizers'>;

function makeOrg(overrides: {
  body?: string;
  data?: Partial<Org['data']>;
} = {}): Org {
  return {
    id: 'test-org',
    body: overrides.body ?? '',
    data: {
      name: 'Test Org',
      tags: [],
      featured: false,
      hidden: false,
      social_links: [],
      media: [],
      ...overrides.data,
    },
  } as unknown as Org;
}

describe('hasDetailPage', () => {
  it('returns false when hidden, regardless of other fields', () => {
    expect(hasDetailPage(makeOrg({
      body: 'lots of content',
      data: { hidden: true, featured: true, tagline: 'hi' },
    }))).toBe(false);
  });

  it('returns true when body has content', () => {
    expect(hasDetailPage(makeOrg({ body: 'A real bio' }))).toBe(true);
  });

  it('returns false when body is whitespace only', () => {
    expect(hasDetailPage(makeOrg({ body: '   \n  \t ' }))).toBe(false);
  });

  it('returns true when tagline is set', () => {
    expect(hasDetailPage(makeOrg({ data: { tagline: 'A friendly club' } }))).toBe(true);
  });

  it('returns true when media is non-empty', () => {
    expect(hasDetailPage(makeOrg({
      data: { media: [{ key: 'x', type: 'photo' }] as Org['data']['media'] },
    }))).toBe(true);
  });

  it('returns true when featured', () => {
    expect(hasDetailPage(makeOrg({ data: { featured: true } }))).toBe(true);
  });

  it('returns false for empty community organizer with no story', () => {
    expect(hasDetailPage(makeOrg())).toBe(false);
  });

  it('returns false for community organizer that only has photo_key', () => {
    expect(hasDetailPage(makeOrg({
      data: { photo_key: 'abc123' },
    }))).toBe(false);
  });

  it('returns false for community organizer that only has social_links', () => {
    expect(hasDetailPage(makeOrg({
      data: { social_links: [{ platform: 'website', url: 'https://x.com' }] },
    }))).toBe(false);
  });

  describe('bike shops', () => {
    it('qualifies when bike-shop has photo_key', () => {
      expect(hasDetailPage(makeOrg({
        data: { tags: ['bike-shop'], photo_key: 'abc123' },
      }))).toBe(true);
    });

    it('qualifies when bike-shop has social_links', () => {
      expect(hasDetailPage(makeOrg({
        data: {
          tags: ['bike-shop'],
          social_links: [{ platform: 'website', url: 'https://shop.example' }],
        },
      }))).toBe(true);
    });

    it('does not qualify when bike-shop has nothing useful', () => {
      expect(hasDetailPage(makeOrg({
        data: { tags: ['bike-shop'] },
      }))).toBe(false);
    });

    it('respects hidden flag even with photo_key', () => {
      expect(hasDetailPage(makeOrg({
        data: { tags: ['bike-shop'], photo_key: 'abc', hidden: true },
      }))).toBe(false);
    });
  });
});
