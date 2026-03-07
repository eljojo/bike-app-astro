import { describe, it, expect, vi } from 'vitest';

// Mock virtual module and env dependencies that event-save.ts imports transitively
vi.mock('virtual:bike-app/admin-events', () => ({ default: [] }));
vi.mock('../src/lib/env', () => ({ env: { GIT_BRANCH: 'main', GITHUB_TOKEN: 'test' } }));
vi.mock('../src/lib/git-factory', () => ({ createGitService: () => ({}) }));
vi.mock('../src/lib/get-db', () => ({ db: () => ({}) }));

import { isPastEvent, eventHandlers } from '../src/views/api/event-save';

describe('isPastEvent', () => {
  it('returns true for past dates', () => {
    expect(isPastEvent('2024-06-01')).toBe(true);
  });

  it('returns false for future dates', () => {
    expect(isPastEvent('2099-06-01')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPastEvent(undefined)).toBe(false);
  });

  it('today is NOT past (uses strict less-than)', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(isPastEvent(today)).toBe(false);
  });
});

describe('eventHandlers.buildCommitMessage', () => {
  it('new event includes title and Changes trailer', () => {
    const update = { frontmatter: { name: 'Bike Fest' }, body: '' };
    const msg = eventHandlers.buildCommitMessage(update, '2026/bike-fest', true, { primaryFile: null });
    expect(msg).toBe('Create Bike Fest\n\nChanges: ottawa/events/2026/bike-fest');
  });

  it('update event includes title and Changes trailer', () => {
    const update = { frontmatter: { name: 'Bike Fest' }, body: '' };
    const msg = eventHandlers.buildCommitMessage(update, '2026/bike-fest', false, { primaryFile: null });
    expect(msg).toBe('Update Bike Fest\n\nChanges: ottawa/events/2026/bike-fest');
  });

  it('falls back to eventId when name missing', () => {
    const update = { frontmatter: {}, body: '' };
    const msg = eventHandlers.buildCommitMessage(update, '2026/bike-fest', false, { primaryFile: null });
    expect(msg).toBe('Update 2026/bike-fest\n\nChanges: ottawa/events/2026/bike-fest');
  });
});
