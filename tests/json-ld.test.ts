import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/config/city-config', () => ({
  getCityConfig: vi.fn(() => ({
    name: 'Ottawa', // eslint-disable-line bike-app/no-hardcoded-city-locale -- display name fixture
    display_name: 'Ottawa by Bike',
    url: 'https://ottawabybike.ca',
    author: {
      name: 'José Albornoz',
      url: 'https://ottawabybike.ca/about',
    },
  })),
}));

import {
  routeJsonLd, eventJsonLd, guideJsonLd, breadcrumbJsonLd,
  rideJsonLd, touristAttractionJsonLd, routeMapJsonLd, webPageJsonLd,
  parsePrice,
} from '../src/lib/json-ld';

describe('routeJsonLd', () => {
  it('returns BlogPosting with dates and author', () => {
    const result = routeJsonLd({
      name: 'Ottawa River Pathway',
      tagline: 'Classic route along the river',
      distance_km: 31,
      id: 'ottawa-river-pathway',
      created_at: '2023-05-15',
      updated_at: '2025-01-20',
    }, 'https://cdn.ottawabybike.ca/cover.jpg');

    expect(result['@type']).toBe('BlogPosting');
    expect(result.headline).toBe('Ottawa River Pathway');
    expect(result.datePublished).toBe('2023-05-15');
    expect(result.dateModified).toBe('2025-01-20');
    expect(result.author).toEqual([{
      '@type': 'Person',
      name: 'José Albornoz',
      url: 'https://ottawabybike.ca/about',
    }]);
    expect(result.image).toEqual(['https://cdn.ottawabybike.ca/cover.jpg']);
    expect(result.url).toBe('https://ottawabybike.ca/routes/ottawa-river-pathway');
  });

  it('omits image when no cover URL', () => {
    const result = routeJsonLd({
      name: 'Test Route',
      distance_km: 10,
      id: 'test',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });
    expect(result.image).toBeUndefined();
  });
});

describe('eventJsonLd', () => {
  it('returns basic event schema', () => {
    const result = eventJsonLd({ name: 'Ottawa Marathon', start_date: '2025-05-25' });
    expect(result['@context']).toBe('https://schema.org');
    expect(result['@type']).toBe('SportsEvent');
    expect(result.name).toBe('Ottawa Marathon');
    expect(result.startDate).toBe('2025-05-25');
    expect(result.sport).toBe('Cycling');
  });

  it('includes organizer when provided', () => {
    const result = eventJsonLd({
      name: 'Race', start_date: '2025-06-01',
      organizer_name: 'Bike Club', organizer_url: 'https://bikeclub.ca',
    });
    expect(result.organizer).toEqual({
      '@type': 'Organization', name: 'Bike Club', url: 'https://bikeclub.ca',
    });
  });

  it('includes start time in startDate when provided', () => {
    const result = eventJsonLd({ name: 'Race', start_date: '2025-06-01', start_time: '08:00' });
    expect(result.startDate).toBe('2025-06-01T08:00');
  });

  it('includes image when poster_key provided', () => {
    const result = eventJsonLd({ name: 'Race', start_date: '2025-06-01', poster_key: 'events/poster.jpg' });
    expect(result.image).toBeDefined();
    expect(result.image).toContain('events/poster.jpg');
  });

  it('sets EventScheduled for upcoming events', () => {
    const result = eventJsonLd({ name: 'Race', start_date: '2025-06-01' });
    expect(result.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode');
    expect(result.eventStatus).toBe('https://schema.org/EventScheduled');
  });

  it('sets EventCompleted for past events', () => {
    const result = eventJsonLd({ name: 'Race', start_date: '2024-01-01', isPast: true });
    expect(result.eventStatus).toBe('https://schema.org/EventCompleted');
  });

  it('maps tags to specific sport strings', () => {
    expect(eventJsonLd({ name: 'R', start_date: '2025-01-01', tags: ['gravel'] }).sport).toBe('Gravel Cycling');
    expect(eventJsonLd({ name: 'R', start_date: '2025-01-01', tags: ['triathlon'] }).sport).toBe('Triathlon');
    expect(eventJsonLd({ name: 'R', start_date: '2025-01-01', tags: ['duathlon'] }).sport).toBe('Duathlon');
    expect(eventJsonLd({ name: 'R', start_date: '2025-01-01', tags: ['bikepacking'] }).sport).toBe('Bikepacking');
    expect(eventJsonLd({ name: 'R', start_date: '2025-01-01', tags: ['social'] }).sport).toBe('Cycling');
  });

  it('includes description when provided', () => {
    const result = eventJsonLd({ name: 'Race', start_date: '2025-06-01', description: 'A fun ride' });
    expect(result.description).toBe('A fun ride');
  });

  it('builds offers with numeric price for upcoming event', () => {
    const result = eventJsonLd({
      name: 'Race', start_date: '2025-06-01',
      registration_url: 'https://reg.example.com',
      price: '$25',
    });
    expect(result.offers).toEqual({
      '@type': 'Offer',
      url: 'https://reg.example.com',
      availability: 'https://schema.org/InStock',
      price: 25,
      priceCurrency: 'USD',
    });
  });

  it('builds offers with SoldOut for past event', () => {
    const result = eventJsonLd({
      name: 'Race', start_date: '2024-01-01',
      registration_url: 'https://reg.example.com',
      isPast: true,
    });
    expect(result.offers?.availability).toBe('https://schema.org/SoldOut');
  });

  it('falls back to description for unparseable price', () => {
    const result = eventJsonLd({
      name: 'Race', start_date: '2025-06-01',
      registration_url: 'https://reg.example.com',
      price: 'Pay what you can',
    });
    expect(result.offers?.description).toBe('Pay what you can');
    expect(result.offers?.price).toBeUndefined();
  });

  it('omits offers when no registration URL', () => {
    const result = eventJsonLd({ name: 'Race', start_date: '2025-06-01', price: '$25' });
    expect(result.offers).toBeUndefined();
  });
});

describe('parsePrice', () => {
  it('parses simple dollar amount', () => {
    expect(parsePrice('$25')).toEqual({ price: 25, currency: 'USD' });
  });

  it('parses euro amount', () => {
    expect(parsePrice('€10')).toEqual({ price: 10, currency: 'EUR' });
  });

  it('parses Chilean pesos with dot thousands separator', () => {
    expect(parsePrice('$1.000')).toEqual({ price: 1000, currency: 'CLP' });
    expect(parsePrice('$12.500')).toEqual({ price: 12500, currency: 'CLP' });
  });

  it('parses amount with comma thousands separator', () => {
    expect(parsePrice('$1,000.50')).toEqual({ price: 1000.50, currency: 'USD' });
  });

  it('returns null for free', () => {
    expect(parsePrice('Free')).toBeNull();
    expect(parsePrice('gratis')).toBeNull();
    expect(parsePrice('gratuit')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parsePrice('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parsePrice('Pay what you can')).toBeNull();
  });

  it('parses amount without currency symbol', () => {
    expect(parsePrice('25')).toEqual({ price: 25, currency: 'USD' });
  });
});

describe('guideJsonLd', () => {
  it('returns Article with author', () => {
    const result = guideJsonLd({
      name: 'Winter Cycling',
      tagline: 'How to ride in winter',
      id: 'winter-cycling',
    });

    expect(result['@type']).toBe('Article');
    expect(result.headline).toBe('Winter Cycling');
    expect(result.author).toEqual([{
      '@type': 'Person',
      name: 'José Albornoz',
      url: 'https://ottawabybike.ca/about',
    }]);
  });
});

describe('breadcrumbJsonLd', () => {
  it('returns BreadcrumbList with position and URL', () => {
    const result = breadcrumbJsonLd([
      { name: 'Home', url: 'https://ottawabybike.ca/' },
      { name: 'Ottawa River Pathway', url: 'https://ottawabybike.ca/routes/ottawa-river-pathway' },
    ]);

    expect(result!['@type']).toBe('BreadcrumbList');
    expect(result!.itemListElement).toHaveLength(2);
    expect(result!.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://ottawabybike.ca/',
    });
    expect(result!.itemListElement[1].position).toBe(2);
  });

  it('returns null for single breadcrumb', () => {
    const result = breadcrumbJsonLd([
      { name: 'Home', url: 'https://ottawabybike.ca/' },
    ]);
    expect(result).toBeNull();
  });
});

describe('rideJsonLd', () => {
  it('returns BlogPosting with ride date', () => {
    const result = rideJsonLd({
      name: 'Morning Ride',
      description: 'A nice morning ride',
      ride_date: '2025-03-15',
      id: 'morning-ride',
      coverUrl: 'https://cdn.example.com/cover.jpg',
    });

    expect(result['@type']).toBe('BlogPosting');
    expect(result.headline).toBe('Morning Ride');
    expect(result.datePublished).toBe('2025-03-15');
    expect(result.image).toEqual(['https://cdn.example.com/cover.jpg']);
    expect(result.url).toBe('https://ottawabybike.ca/rides/morning-ride');
  });
});

describe('touristAttractionJsonLd', () => {
  it('returns TouristAttraction with geo', () => {
    const result = touristAttractionJsonLd({
      name: 'Wakefield Ride',
      description: 'A scenic ride',
      imageUrl: 'https://cdn.example.com/cover.jpg',
      url: 'https://ottawabybike.ca/routes/wakefield',
      startLat: 45.42,
      startLng: -75.69,
    });

    expect(result['@type']).toBe('TouristAttraction');
    expect(result.name).toBe('Wakefield Ride');
    expect(result.touristType).toBe('Cyclist');
    expect(result.isAccessibleForFree).toBe(true);
    expect(result.geo).toEqual({
      '@type': 'GeoCoordinates',
      latitude: 45.42,
      longitude: -75.69,
    });
  });

  it('omits geo when no coordinates', () => {
    const result = touristAttractionJsonLd({
      name: 'Test',
      url: 'https://example.com',
    });
    expect(result.geo).toBeUndefined();
  });
});

describe('routeMapJsonLd', () => {
  it('returns TouristAttraction with GeoShape and places', () => {
    const result = routeMapJsonLd({
      name: 'Wakefield',
      description: '46 km cycling route map',
      imageUrl: 'https://example.com/map.jpg',
      url: 'https://example.com/routes/wakefield/map',
      geoLine: '45.42,-75.69 45.50,-75.80',
      containsPlaces: [
        { name: 'Chelsea Pub', lat: 45.45, lng: -75.75, category: 'restaurant' },
      ],
      distance: '45.8 km',
      elevationGain: '320 m',
      routeShape: 'out-and-back',
    });

    expect(result['@type']).toBe('TouristAttraction');
    expect(result.geo).toEqual({ '@type': 'GeoShape', line: '45.42,-75.69 45.50,-75.80' });
    expect(result.containsPlace!).toHaveLength(1);
    expect(result.containsPlace![0].name).toBe('Chelsea Pub');
    expect(result.additionalProperty!).toHaveLength(3);
    expect(result.additionalProperty![0]).toEqual({ '@type': 'PropertyValue', name: 'distance', value: '45.8 km' });
  });

  it('omits empty arrays', () => {
    const result = routeMapJsonLd({ name: 'Test', url: 'https://example.com' });
    expect(result.geo).toBeUndefined();
    expect(result.containsPlace).toBeUndefined();
    expect(result.additionalProperty).toBeUndefined();
  });
});

describe('webPageJsonLd', () => {
  it('returns WebPage with about City', () => {
    const result = webPageJsonLd({
      name: 'Ottawa Cycling Map',
      description: 'Explore cycling routes in Ottawa',
      url: 'https://ottawabybike.ca/map',
      aboutName: 'Ottawa',
    });

    expect(result['@type']).toBe('WebPage');
    expect(result.about).toEqual({ '@type': 'City', name: 'Ottawa' });
  });
});
