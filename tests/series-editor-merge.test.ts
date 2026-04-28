/**
 * Coverage for the override-merge helper used by SeriesEditor.tsx's popover.
 *
 * The popover lets the admin set location and note on a date. When the date
 * already has an existing override row carrying other fields (uid,
 * event_url, registration_url, start_time, ...), the helper must preserve
 * those fields — wiping them silently breaks partial-import dedupe.
 */
import { describe, test, expect } from 'vitest';
import { mergeOverrideForPopover } from '../src/components/admin/series-editor-merge';

describe('mergeOverrideForPopover', () => {
  test('BUG: existing uid/event_url/registration_url preserved when popover saves location/note', () => {
    // Existing override carries every field that detectImplicitSeries
    // produces for an imported cluster occurrence.
    const existing = {
      date: '2026-05-13',
      uid: 'https://obcrides.ca/events/3642',
      event_url: 'https://obcrides.ca/events/3642',
      registration_url: 'https://ridewithgps.com/events/12345',
      start_time: '09:30',
      meet_time: '09:00',
      rescheduled_from: '2026-05-06',
      cancelled: false,
    };
    // Admin tweaks just the location + note.
    const merged = mergeOverrideForPopover(existing, {
      location: 'New Place',
      note: 'Bring lights',
    });
    // Every field on the existing row must survive.
    expect(merged.uid).toBe('https://obcrides.ca/events/3642');
    expect(merged.event_url).toBe('https://obcrides.ca/events/3642');
    expect(merged.registration_url).toBe('https://ridewithgps.com/events/12345');
    expect(merged.start_time).toBe('09:30');
    expect(merged.meet_time).toBe('09:00');
    expect(merged.rescheduled_from).toBe('2026-05-06');
    // And the popover patch lands.
    expect(merged.location).toBe('New Place');
    expect(merged.note).toBe('Bring lights');
    // Date unchanged.
    expect(merged.date).toBe('2026-05-13');
  });

  test('clearing popover location/note removes those fields without touching others', () => {
    const existing = {
      date: '2026-05-13',
      uid: 'b',
      location: 'Old Place',
      note: 'Old note',
      event_url: 'https://example.com/b',
    };
    const merged = mergeOverrideForPopover(existing, { location: '', note: '' });
    // Empty popover values clear the field.
    expect(merged.location).toBeUndefined();
    expect(merged.note).toBeUndefined();
    // Other fields preserved.
    expect(merged.uid).toBe('b');
    expect(merged.event_url).toBe('https://example.com/b');
  });

  test('new-date override (no existing row) starts from just date + popover patch', () => {
    const merged = mergeOverrideForPopover(undefined, {
      date: '2026-05-13',
      location: 'New Place',
      note: 'New note',
    });
    expect(merged).toEqual({
      date: '2026-05-13',
      location: 'New Place',
      note: 'New note',
    });
  });
});
