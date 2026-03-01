import { describe, it, expect } from 'vitest';
import { routeJsonLd, eventJsonLd, guideJsonLd, breadcrumbJsonLd } from '../src/lib/json-ld';

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

  it('sets eventAttendanceMode and eventStatus', () => {
    const result = eventJsonLd({ name: 'Race', start_date: '2025-06-01' });
    expect(result.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode');
    expect(result.eventStatus).toBe('https://schema.org/EventScheduled');
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

    expect(result['@type']).toBe('BreadcrumbList');
    expect(result.itemListElement).toHaveLength(2);
    expect(result.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://ottawabybike.ca/',
    });
    expect(result.itemListElement[1].position).toBe(2);
  });

  it('returns null for single breadcrumb', () => {
    const result = breadcrumbJsonLd([
      { name: 'Home', url: 'https://ottawabybike.ca/' },
    ]);
    expect(result).toBeNull();
  });
});
