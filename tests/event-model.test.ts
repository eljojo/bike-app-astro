import { describe, it, expect } from 'vitest';
import {
  eventDetailFromGit,
  eventDetailToCache,
  eventDetailFromCache,
  computeEventContentHash,
  computeEventContentHashFromFiles,
  buildFreshEventData,
} from '../src/lib/models/event-model';

describe('eventDetailFromGit', () => {
  it('parses frontmatter and body into canonical shape', () => {
    const frontmatter = {
      name: 'Bike Fest',
      start_date: '2099-07-01',
      start_time: '09:00',
      end_date: '2099-07-01',
      end_time: '17:00',
      registration_url: 'https://example.com',
      distances: '50k, 100k',
      location: 'Ottawa',
      organizer: 'bike-club',
      poster_key: 'abc123',
    };
    const body = '\nEvent description.\n';

    const result = eventDetailFromGit('2099/bike-fest', frontmatter, body);

    expect(result.id).toBe('2099/bike-fest');
    expect(result.slug).toBe('bike-fest');
    expect(result.year).toBe('2099');
    expect(result.name).toBe('Bike Fest');
    expect(result.start_date).toBe('2099-07-01');
    expect(result.body).toBe('Event description.');
    expect(result.organizer).toBe('bike-club');
  });

  it('handles inline organizer object', () => {
    const fm = {
      name: 'Test',
      start_date: '2099-01-01',
      organizer: { name: 'Club', website: 'https://club.ca' },
    };
    const result = eventDetailFromGit('2099/test', fm, '');
    expect(result.organizer).toEqual({ name: 'Club', website: 'https://club.ca' });
  });
});

describe('eventDetailToCache / eventDetailFromCache', () => {
  it('round-trips correctly', () => {
    const detail = eventDetailFromGit(
      '2099/test',
      { name: 'Test', start_date: '2099-06-01' },
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

describe('computeEventContentHash', () => {
  it('hashes event content', () => {
    const hash = computeEventContentHash('---\nname: Test\n---\nBody');
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(32);
  });

  it('same input produces same hash', () => {
    const a = computeEventContentHash('content');
    const b = computeEventContentHash('content');
    expect(a).toBe(b);
  });
});

describe('computeEventContentHashFromFiles', () => {
  it('hashes primary file from git snapshot', () => {
    const hashA = computeEventContentHashFromFiles({
      primaryFile: { content: '---\nname: A\nstart_date: 2099-01-01\n---\n\nBody', sha: 'a' },
    });
    const hashB = computeEventContentHashFromFiles({
      primaryFile: { content: '---\nname: B\nstart_date: 2099-01-01\n---\n\nBody', sha: 'b' },
    });
    expect(hashA).not.toBe(hashB);
  });
});

describe('buildFreshEventData', () => {
  it('builds cache JSON from git file snapshots', () => {
    const data = buildFreshEventData('2099/bike-fest', {
      primaryFile: {
        content: '---\nname: Bike Fest\nstart_date: 2099-07-01\norganizer: bike-club\n---\n\nEvent body',
        sha: 'abc',
      },
    });

    const parsed = eventDetailFromCache(data);
    expect(parsed.id).toBe('2099/bike-fest');
    expect(parsed.name).toBe('Bike Fest');
    expect(parsed.body).toBe('Event body');
    expect(parsed.organizer).toBe('bike-club');
  });
});
