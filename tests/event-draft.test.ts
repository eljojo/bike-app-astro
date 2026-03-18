import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/env/env.service', () => ({ env: {} }));
vi.mock('../src/lib/auth/authorize', () => ({ authorize: vi.fn() }));
vi.mock('../src/lib/config/city-config', () => ({ getCityConfig: () => ({ timezone: 'America/Toronto' }) }));
vi.mock('../src/lib/get-db', () => ({ db: () => ({}) }));
vi.mock('../src/lib/auth/rate-limit', () => ({ checkRateLimit: vi.fn(), recordAttempt: vi.fn(), cleanupOldAttempts: vi.fn(), LIMITS: {} }));
vi.mock('../src/lib/media/storage.adapter-r2', () => ({ generateMediaKey: vi.fn(), confirmUpload: vi.fn() }));
vi.mock('../src/lib/content/load-admin-content.server', () => ({ fetchJson: vi.fn() }));

import { buildDraft } from '../src/views/api/event-draft';

const organizers = [
  { slug: 'ottawa-bicycle-club', name: 'Ottawa Bicycle Club', website: 'https://ottawabicycleclub.ca', instagram: 'ottawabicycleclub' },
  { slug: 'bike-ottawa', name: 'Bike Ottawa' },
];

describe('buildDraft organizer resolution', () => {
  it('preserves extracted website when organizer matches a known slug', () => {
    const { draft } = buildDraft({
      name: { value: 'Spring Ride', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      organizer: { value: 'Ottawa Bicycle Club', c: 8 },
      organizer_website: { value: 'https://springride.ca', c: 7 },
    }, organizers);

    // The organizer should be an inline object, not a bare slug string
    expect(typeof draft.organizer).not.toBe('string');
    const org = draft.organizer as Record<string, string>;
    expect(org.name).toBe('Ottawa Bicycle Club');
    expect(org.website).toBe('https://springride.ca');
  });

  it('preserves extracted instagram when organizer matches a known slug', () => {
    const { draft } = buildDraft({
      name: { value: 'Fall Ride', c: 9 },
      start_date: { value: '2026-10-01', c: 9 },
      organizer: { value: 'Bike Ottawa', c: 8 },
      organizer_instagram: { value: 'bikeottawa', c: 7 },
    }, organizers);

    expect(typeof draft.organizer).not.toBe('string');
    const org = draft.organizer as Record<string, string>;
    expect(org.name).toBe('Bike Ottawa');
    expect(org.instagram).toBe('bikeottawa');
  });

  it('includes known organizer fields when no extracted fields provided', () => {
    const { draft } = buildDraft({
      name: { value: 'Summer Ride', c: 9 },
      start_date: { value: '2026-07-01', c: 9 },
      organizer: { value: 'Ottawa Bicycle Club', c: 8 },
    }, organizers);

    expect(typeof draft.organizer).not.toBe('string');
    const org = draft.organizer as Record<string, string>;
    expect(org.name).toBe('Ottawa Bicycle Club');
    expect(org.website).toBe('https://ottawabicycleclub.ca');
  });

  it('builds inline object for unmatched organizer', () => {
    const { draft } = buildDraft({
      name: { value: 'New Event', c: 9 },
      start_date: { value: '2026-06-01', c: 9 },
      organizer: { value: 'Some New Club', c: 8 },
      organizer_website: { value: 'https://newclub.ca', c: 7 },
    }, organizers);

    expect(typeof draft.organizer).not.toBe('string');
    const org = draft.organizer as Record<string, string>;
    expect(org.name).toBe('Some New Club');
    expect(org.website).toBe('https://newclub.ca');
  });

  it('does not leak organizer_website or organizer_instagram to draft', () => {
    const { draft } = buildDraft({
      name: { value: 'Test Event', c: 9 },
      start_date: { value: '2026-06-01', c: 9 },
      organizer: { value: 'Some Club', c: 8 },
      organizer_website: { value: 'https://example.com', c: 7 },
      organizer_instagram: { value: 'someclub', c: 7 },
    }, organizers);

    expect(draft.organizer_website).toBeUndefined();
    expect(draft.organizer_instagram).toBeUndefined();
  });
});
