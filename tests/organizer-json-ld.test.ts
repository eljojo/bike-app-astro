import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: () => ({
    name: 'Ottawa',
    display_name: 'whereto.bike Ottawa',
    url: 'https://example.com',
    author: { name: 'Test', url: 'https://example.com', twitter: '@example' },
  }),
}));

vi.mock('../src/lib/media/image-service', () => ({
  originalUrl: (key: string) => `https://cdn.example.com/${key}`,
}));

import { organizerJsonLd } from '../src/lib/json-ld';

describe('organizerJsonLd', () => {
  it('returns Organization for non-shop', () => {
    const ld = organizerJsonLd(
      { name: 'Bike Ottawa', tagline: 'Citywide rides' },
      { coverUrl: undefined, isShop: false, url: 'https://example.com/communities/bike-ottawa' },
    );
    expect(ld['@type']).toBe('Organization');
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld.name).toBe('Bike Ottawa');
    expect(ld.description).toBe('Citywide rides');
    expect(ld.url).toBe('https://example.com/communities/bike-ottawa');
    expect(ld.logo).toBeUndefined();
    expect(ld.image).toBeUndefined();
    expect(ld.sameAs).toBeUndefined();
  });

  it('returns BicycleStore for shop', () => {
    const ld = organizerJsonLd(
      { name: 'Velo Espresso' },
      { coverUrl: undefined, isShop: true, url: 'https://example.com/communities/velo-espresso' },
    );
    expect(ld['@type']).toBe('BicycleStore');
  });

  it('includes logo from photo_key, image from coverUrl, and deduped sameAs', () => {
    const ld = organizerJsonLd(
      {
        name: 'Bike Minds',
        photo_key: 'organizers/bike-minds/logo.jpg',
        website: 'https://bikeminds.ca',
        social_links: [
          { platform: 'instagram', url: 'https://instagram.com/bikeminds' },
          { platform: 'website', url: 'https://bikeminds.ca' }, // duplicate of website above
        ],
      },
      { coverUrl: 'https://cdn.example.com/cover.jpg?w=1200', isShop: false, url: 'https://example.com/x' },
    );
    expect(ld.logo).toBe('https://cdn.example.com/organizers/bike-minds/logo.jpg');
    expect(ld.image).toEqual(['https://cdn.example.com/cover.jpg?w=1200']);
    expect(ld.sameAs).toEqual([
      'https://bikeminds.ca',
      'https://instagram.com/bikeminds',
    ]);
  });

  it('omits sameAs when no website and no social_links', () => {
    const ld = organizerJsonLd(
      { name: 'Solo Org' },
      { coverUrl: undefined, isShop: false, url: 'https://example.com/x' },
    );
    expect(ld.sameAs).toBeUndefined();
  });
});
