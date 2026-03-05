import { describe, it, expect } from 'vitest';
import { eventDetailFromGit, eventDetailToCache, eventDetailFromCache } from '../src/lib/models/event-model';

describe('eventDetailFromGit', () => {
  it('parses frontmatter and body into canonical shape', () => {
    const frontmatter = {
      name: 'Bike Fest',
      start_date: '2026-07-01',
      start_time: '09:00',
      end_date: '2026-07-01',
      end_time: '17:00',
      registration_url: 'https://example.com',
      distances: '50k, 100k',
      location: 'Ottawa',
      organizer: 'bike-club',
      poster_key: 'abc123',
    };
    const body = '\nEvent description.\n';

    const result = eventDetailFromGit('2026/bike-fest', frontmatter, body);

    expect(result.id).toBe('2026/bike-fest');
    expect(result.slug).toBe('bike-fest');
    expect(result.year).toBe('2026');
    expect(result.name).toBe('Bike Fest');
    expect(result.start_date).toBe('2026-07-01');
    expect(result.body).toBe('Event description.');
    expect(result.organizer).toBe('bike-club');
  });

  it('handles inline organizer object', () => {
    const fm = {
      name: 'Test',
      start_date: '2026-01-01',
      organizer: { name: 'Club', website: 'https://club.ca' },
    };
    const result = eventDetailFromGit('2026/test', fm, '');
    expect(result.organizer).toEqual({ name: 'Club', website: 'https://club.ca' });
  });
});

describe('eventDetailToCache / eventDetailFromCache', () => {
  it('round-trips correctly', () => {
    const detail = eventDetailFromGit(
      '2026/test',
      { name: 'Test', start_date: '2026-06-01' },
      'body',
    );
    const cached = eventDetailToCache(detail);
    const parsed = eventDetailFromCache(cached);
    expect(parsed).toEqual(detail);
  });

  it('fromCache throws on invalid data', () => {
    expect(() => eventDetailFromCache('bad')).toThrow();
  });
});
