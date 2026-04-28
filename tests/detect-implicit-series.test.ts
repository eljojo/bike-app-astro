import { describe, it, expect } from 'vitest';
import ICAL from 'ical.js';
import { extractDescription, detectCancellation, pickModalDescription, detectImplicitSeries, revalidateClusterAfterTrim } from '../src/lib/calendar-suggestions/detect-implicit-series';
import type { ParsedVEvent } from '../src/lib/calendar-suggestions/types';

describe('extractDescription', () => {
  it('returns null for empty / whitespace / undefined input', () => {
    expect(extractDescription('')).toBeNull();
    expect(extractDescription('   ')).toBeNull();
    expect(extractDescription('<p></p>')).toBeNull();
    expect(extractDescription('<p>   </p>')).toBeNull();
    expect(extractDescription(undefined)).toBeNull();
  });

  it('returns null for legacy WebScorer placeholder', () => {
    expect(extractDescription('Legacy event imported from WebScorer')).toBeNull();
    expect(extractDescription('<p>Legacy event imported from WebScorer</p>')).toBeNull();
  });

  it('returns null for TBD placeholder variants', () => {
    expect(extractDescription('TBD')).toBeNull();
    expect(extractDescription('<p>TBD</p>')).toBeNull();
    expect(extractDescription('<p>tbd</p>')).toBeNull();
  });

  it('returns null for "to be posted closer" placeholder boilerplate', () => {
    expect(extractDescription(
      '<p>More information, such as start location and ride leader will be posted closer to the start of the season</p>',
    )).toBeNull();
    expect(extractDescription(
      '<p>Full information to be posted closer to the date. If you are interested in helping out…</p>',
    )).toBeNull();
  });

  it('returns null for lone-emoji content', () => {
    expect(extractDescription('<p>🚴‍♀️</p>')).toBeNull();
    expect(extractDescription('<p>✨ </p>')).toBeNull();
  });

  it('returns markdown for real content (even if minimal)', () => {
    expect(extractDescription('<p>9.5km Time Trial</p>')).toBe('9.5km Time Trial');
    expect(extractDescription('<p>Sportsplex - Manotick loop</p>')).toBe('Sportsplex - Manotick loop');
  });

  it('does NOT filter near-miss text that mentions "posted" but is not the placeholder', () => {
    expect(extractDescription(
      '<p>More information about the ride will be sent closer to the date</p>',
    )).toBe('More information about the ride will be sent closer to the date');
  });

  it('preserves links when converting HTML to markdown', () => {
    const out = extractDescription('<p>See <a href="https://example.com">here</a></p>');
    expect(out).toContain('https://example.com');
    expect(out).toContain('here');
  });
});

describe('detectCancellation', () => {
  it('returns null when neither summary nor description signals cancellation', () => {
    expect(detectCancellation('Wednesday Coffee Ride', '<p>Manotick loop</p>')).toBeNull();
    expect(detectCancellation('Open Time Trial', '<p>15km TT</p>')).toBeNull();
  });

  it('matches CANCELLED in summary (no reason)', () => {
    expect(detectCancellation('Wednesday Coffee Ride - CANCELLED', '<p>Two ferries</p>'))
      .toEqual({ cancelled: true, reason: undefined });
  });

  it('matches CANCELED (American spelling) and lowercase variants', () => {
    expect(detectCancellation('Open TT - canceled', undefined))
      .toEqual({ cancelled: true, reason: undefined });
  });

  it('matches NO RIDE with trailing reason token', () => {
    expect(detectCancellation('Sunday Ride 25-06-22 - NO RIDE - RLCT', undefined))
      .toEqual({ cancelled: true, reason: 'RLCT' });
  });

  it('matches WX RESCHEDULED in summary', () => {
    expect(detectCancellation('Gravel Ride - Ashton-Gillies Petit - WX RESCHEDULED', undefined))
      .toEqual({ cancelled: true, reason: 'WX' });
  });

  it('matches "No <weekday> ride" at start of description (unconditional)', () => {
    expect(detectCancellation('Sunday Ride 25-06-22', '<p>No Sunday ride due to RLCT</p>'))
      .toEqual({ cancelled: true, reason: 'RLCT' });
  });

  it('does NOT match conditional cancellation language in description', () => {
    expect(detectCancellation(
      'Biking in the Gatineau Park',
      '<p>If there is no ride leader signed up the ride will be cancelled</p>',
    )).toBeNull();
  });

  it('does NOT match the substring "cancellation" in unrelated context (word boundary)', () => {
    expect(detectCancellation('Cancellation policy update', undefined)).toBeNull();
  });

  it('summary signal takes precedence over description signal', () => {
    expect(detectCancellation(
      'Wednesday Coffee Ride - CANCELLED',
      '<p>If conditions worsen the ride will be cancelled</p>',
    )).toEqual({ cancelled: true, reason: undefined });
  });
});

describe('pickModalDescription', () => {
  it('returns null when fewer than the threshold share a description', () => {
    // 5 distinct out of 10 = 50%, below 60% threshold
    const result = pickModalDescription(['a', 'b', 'c', 'd', 'e', 'a', 'b', 'c', 'd', 'e']);
    expect(result).toBeNull();
  });

  it('returns the modal description when ≥60% of inputs share it', () => {
    // 8 of 10 share "X" (80%)
    const result = pickModalDescription(['X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'a', 'b']);
    expect(result).toBe('X');
  });

  it('returns the modal at exactly 60% threshold', () => {
    // 6 of 10 share "X" (exactly 60%)
    const result = pickModalDescription(['X', 'X', 'X', 'X', 'X', 'X', 'a', 'b', 'c', 'd']);
    expect(result).toBe('X');
  });

  it('does not return a modal at 59%', () => {
    // 59 of 100 share "X"
    const inputs = [...Array(59).fill('X'), ...Array(41).fill(0).map((_, i) => `unique-${i}`)];
    const result = pickModalDescription(inputs);
    expect(result).toBeNull();
  });

  it('treats nulls as absent (not voting either way)', () => {
    // 7 share "X", 3 are null. Of 7 non-null, 7/7 = 100% modal.
    const result = pickModalDescription(['X', 'X', 'X', 'X', 'X', 'X', 'X', null, null, null]);
    expect(result).toBe('X');
  });

  it('returns null when all inputs are null', () => {
    expect(pickModalDescription([null, null, null, null])).toBeNull();
  });

  it('returns null when an empty array is passed', () => {
    expect(pickModalDescription([])).toBeNull();
  });

  it('uses non-null denominator: 7 real with 7×"X" + 3 null = master is X', () => {
    // Threshold computed against non-null total (7), not full length (10).
    // 7/7 = 100% ≥ 60%.
    const result = pickModalDescription(['X', 'X', 'X', 'X', 'X', 'X', 'X', null, null, null]);
    expect(result).toBe('X');
  });
});

function loadMasters(ics: string): ICAL.Event[] {
  const jcal = ICAL.parse(ics);
  const vcal = new ICAL.Component(jcal);
  return vcal.getAllSubcomponents('vevent').map(v => new ICAL.Event(v));
}

function makeIcs(events: Array<{
  uid: string; summary: string; dtstart: string;
  description?: string; location?: string; url?: string;
}>): string {
  const ve = events.map(e => [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `SUMMARY:${e.summary}`,
    `DTSTART:${e.dtstart}`,
    `DTEND:${e.dtstart}`,
    e.description ? `DESCRIPTION:${e.description.replace(/\n/g, '\\n')}` : '',
    e.location ? `LOCATION:${e.location}` : '',
    e.url ? `URL:${e.url}` : '',
    `DTSTAMP:20260101T000000Z`,
    'END:VEVENT',
  ].filter(Boolean).join('\r\n')).join('\r\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    ve,
    'END:VCALENDAR',
  ].join('\r\n');
}

describe('detectImplicitSeries — clustering rules', () => {
  it('clusters 4 weekly Wednesday occurrences in same year as one series', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'Wednesday Coffee Ride', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'Wednesday Coffee Ride', dtstart: '20260513T140000Z' },
      { uid: 'c', summary: 'Wednesday Coffee Ride', dtstart: '20260520T140000Z' },
      { uid: 'd', summary: 'Wednesday Coffee Ride', dtstart: '20260527T140000Z' },
    ]);
    const masters = loadMasters(ics);
    const result = detectImplicitSeries(masters, 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    expect(result.orphans).toHaveLength(0);
    const cluster = result.clusters[0];
    expect(cluster.series?.kind).toBe('recurrence');
    expect(cluster.series?.recurrence).toBe('weekly');
    expect(cluster.series?.recurrence_day).toBe('wednesday');
    expect(cluster.series?.season_start).toBe('2026-05-06');
    expect(cluster.series?.season_end).toBe('2026-05-27');
    expect(cluster.uid).toBe('a');
  });

  it('rejects 3 occurrences as below size threshold', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(0);
    expect(result.orphans).toHaveLength(3);
  });

  it('rejects mixed-DOW cluster below 80% modal-DOW threshold', () => {
    // 2 Tuesday + 2 Wednesday = 50% modal — below 80%.
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260505T140000Z' },  // Tue
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },  // Wed
      { uid: 'c', summary: 'X', dtstart: '20260519T140000Z' },  // Tue
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z' },  // Wed
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(0);
    expect(result.orphans).toHaveLength(4);
  });

  it('consolidates sibling buckets that share a "<base> - <variant>" pattern with no base bucket', () => {
    // OBC Sunday Ride pattern: each occurrence has SUMMARY
    // "Sunday Ride YY-MM-DD - <Location>" with a different location every
    // week. After date stripping each bucket becomes "Sunday Ride - <Loc>";
    // with no plain "Sunday Ride" base bucket, the consolidate pass merges
    // them into a synthetic one when the combined set would form a cluster.
    const ics = makeIcs([
      { uid: 'a', summary: 'Sunday Ride 26-04-05 - Nepean Sportsplex', dtstart: '20260405T140000Z' },
      { uid: 'b', summary: 'Sunday Ride 26-04-12 - Andrew Haydon Park', dtstart: '20260412T140000Z' },
      { uid: 'c', summary: 'Sunday Ride 26-04-19 - Airport NRC',        dtstart: '20260419T140000Z' },
      { uid: 'd', summary: 'Sunday Ride 26-04-26 - Orleans',             dtstart: '20260426T140000Z' },
      { uid: 'e', summary: 'Sunday Ride 26-05-03 - Nepean Sportsplex',   dtstart: '20260503T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.summary).toBe('Sunday Ride');
    expect(cluster.series?.recurrence_day).toBe('sunday');
    // Per-occurrence location rides along as an override note.
    const aprilFifth = cluster.series?.overrides?.find(o => o.date === '2026-04-05');
    expect(aprilFifth?.note).toBe('Nepean Sportsplex');
    const aprilTwelfth = cluster.series?.overrides?.find(o => o.date === '2026-04-12');
    expect(aprilTwelfth?.note).toBe('Andrew Haydon Park');
  });

  it('does NOT consolidate prefix siblings that wouldn\'t form a viable cluster', () => {
    // Three "Workshop - <topic>" one-offs on different days of the week, no
    // recurrence pattern. The consolidate pass would merge them but the modal
    // DOW gate fails (each entry is a different DOW), so the buckets stay
    // split and each becomes a one-off orphan suggestion.
    const ics = makeIcs([
      { uid: 'a', summary: 'Workshop - Brakes',  dtstart: '20260505T180000Z' }, // Tue
      { uid: 'b', summary: 'Workshop - Tires',   dtstart: '20260513T180000Z' }, // Wed
      { uid: 'c', summary: 'Workshop - Drivetrain', dtstart: '20260521T180000Z' }, // Thu
      { uid: 'd', summary: 'Workshop - Wheels',  dtstart: '20260530T180000Z' }, // Sat
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(0);
    expect(result.orphans.map(o => o.uid).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps a "<base> - CANCELLED DUE TO X" occurrence in its series cluster (cancelled override)', () => {
    // Real OBC pattern: " - CANCELLED DUE TO RLCT" uses a space-separated
    // multi-word reason. Without proper stripping, the bucket key would carry
    // the suffix and split this occurrence into its own bucket — losing it
    // from the series and leaving an orphan one-off in suggestions.
    const ics = makeIcs([
      { uid: 'a', summary: 'Sunday Ride',                      dtstart: '20260503T140000Z' }, // Sun
      { uid: 'b', summary: 'Sunday Ride - CANCELLED DUE TO RLCT', dtstart: '20260510T140000Z' },
      { uid: 'c', summary: 'Sunday Ride',                      dtstart: '20260517T140000Z' },
      { uid: 'd', summary: 'Sunday Ride',                      dtstart: '20260524T140000Z' },
      { uid: 'e', summary: 'Sunday Ride',                      dtstart: '20260531T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.series?.overrides).toHaveLength(5);
    const cancelled = cluster.series?.overrides?.find(o => o.date === '2026-05-10');
    expect(cancelled?.cancelled).toBe(true);
    expect(result.orphans).toEqual([]);
  });

  it('clusters 5 occurrences with 80% modal DOW; outlier becomes override with its date', () => {
    // 4 Tue + 1 Wed = 80% Tuesday.
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260505T140000Z' },  // Tue
      { uid: 'b', summary: 'X', dtstart: '20260512T140000Z' },  // Tue
      { uid: 'c', summary: 'X', dtstart: '20260519T140000Z' },  // Tue
      { uid: 'd', summary: 'X', dtstart: '20260526T140000Z' },  // Tue
      { uid: 'e', summary: 'X', dtstart: '20260513T140000Z' },  // Wed (outlier)
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.series?.recurrence_day).toBe('tuesday');
    const outlier = cluster.series?.overrides?.find(o => o.date === '2026-05-13');
    expect(outlier).toBeDefined();
    expect(outlier?.uid).toBe('e');
  });

  it('clusters biweekly occurrences as recurrence: biweekly', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'Biweekly Ride', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'Biweekly Ride', dtstart: '20260520T140000Z' },
      { uid: 'c', summary: 'Biweekly Ride', dtstart: '20260603T140000Z' },
      { uid: 'd', summary: 'Biweekly Ride', dtstart: '20260617T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].series?.recurrence).toBe('biweekly');
  });

  it('accepts a missed week (gap of 14 in a weekly cluster) as part of the cluster', () => {
    // [7, 14, 7, 7] — week of May 20 is missing. Modal gap = 7 (weekly);
    // 14 is 2× modal so it's a missed week, not a cadence break. Cluster forms.
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },  // +7
      { uid: 'c', summary: 'X', dtstart: '20260527T140000Z' },  // +14 (missed May 20)
      { uid: 'd', summary: 'X', dtstart: '20260603T140000Z' },  // +7
      { uid: 'e', summary: 'X', dtstart: '20260610T140000Z' },  // +7
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    expect(result.orphans).toHaveLength(0);
    expect(result.clusters[0].series?.recurrence).toBe('weekly');
  });

  it('rejects irregular cadence when modal gap is neither 7 nor 14 (e.g. tri-weekly)', () => {
    // 4 Wednesdays at 21-day spacing → modal gap = 21, not weekly nor biweekly.
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },  // Wed
      { uid: 'b', summary: 'X', dtstart: '20260527T140000Z' },  // +21 → Wed
      { uid: 'c', summary: 'X', dtstart: '20260617T140000Z' },  // +21 → Wed
      { uid: 'd', summary: 'X', dtstart: '20260708T140000Z' },  // +21 → Wed
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(0);
    expect(result.orphans).toHaveLength(4);
  });

  it('splits at 60-day off-season gap; each sub-bucket evaluated independently', () => {
    // 4 in May + 4 in Sep, gap > 60 days.
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z' },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z' },
      // ~14 weeks gap (>60d)
      { uid: 'e', summary: 'X', dtstart: '20260902T140000Z' },
      { uid: 'f', summary: 'X', dtstart: '20260909T140000Z' },
      { uid: 'g', summary: 'X', dtstart: '20260916T140000Z' },
      { uid: 'h', summary: 'X', dtstart: '20260923T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0].series?.season_start).toBe('2026-05-06');
    expect(result.clusters[0].series?.season_end).toBe('2026-05-27');
    expect(result.clusters[1].series?.season_start).toBe('2026-09-02');
    expect(result.clusters[1].series?.season_end).toBe('2026-09-23');
  });

  it('splits at calendar year boundary (same-year guard)', () => {
    // 4 Wednesdays in late 2025 + 4 Wednesdays in early 2026 = should split into 2 clusters.
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20251203T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20251210T140000Z' },
      { uid: 'c', summary: 'X', dtstart: '20251217T140000Z' },
      { uid: 'd', summary: 'X', dtstart: '20251224T140000Z' },
      { uid: 'e', summary: 'X', dtstart: '20260107T140000Z' },
      { uid: 'f', summary: 'X', dtstart: '20260114T140000Z' },
      { uid: 'g', summary: 'X', dtstart: '20260121T140000Z' },
      { uid: 'h', summary: 'X', dtstart: '20260128T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0].series?.season_start?.startsWith('2025')).toBe(true);
    expect(result.clusters[1].series?.season_start?.startsWith('2026')).toBe(true);
  });

  it('year-split + size threshold: 2 in Dec 2025 + 3 in Jan 2026 → all become orphans', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20251217T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20251224T140000Z' },
      { uid: 'e', summary: 'X', dtstart: '20260107T140000Z' },
      { uid: 'f', summary: 'X', dtstart: '20260114T140000Z' },
      { uid: 'g', summary: 'X', dtstart: '20260121T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(0);
    expect(result.orphans).toHaveLength(5);
  });

  it('different SUMMARYs do not cluster together', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },
      { uid: 'c', summary: 'Y', dtstart: '20260507T140000Z' },
      { uid: 'd', summary: 'Y', dtstart: '20260514T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(0);
    expect(result.orphans).toHaveLength(4);
  });
});

describe('detectImplicitSeries — per-field override emission', () => {
  it('emits start_time override for occurrences whose ToD differs from modal', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },  // 14:00
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },  // 14:00
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z' },  // 14:00
      { uid: 'd', summary: 'X', dtstart: '20260527T133000Z' },  // 13:30 — outlier
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const ovr = result.clusters[0].series?.overrides?.find(o => o.date === '2026-05-27');
    // Toronto is UTC-4 in May → 14:00Z = 10:00 local; 13:30Z = 09:30 local
    expect(ovr?.start_time).toBe('09:30');
  });

  it('emits location override for occurrences whose LOCATION differs from modal', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z', location: 'Place A' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z', location: 'Place A' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z', location: 'Place A' },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z', location: 'Place B' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.location).toBe('Place A');
    const ovr = cluster.series?.overrides?.find(o => o.date === '2026-05-27');
    expect(ovr?.location).toBe('Place B');
  });

  it('emits registration_url override on every occurrence when URLs are all unique', () => {
    // Per-occurrence URL property is the RSVP/sign-up link for that specific
    // instance (e.g. obcrides.ca/events/N), so it lives in registration_url —
    // not event_url, which is reserved for the season/series landing page.
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z', url: 'https://e.com/1' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z', url: 'https://e.com/2' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z', url: 'https://e.com/3' },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z', url: 'https://e.com/4' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    const overrides = result.clusters[0].series?.overrides ?? [];
    expect(overrides).toHaveLength(4);
    expect(overrides.map(o => o.registration_url).sort()).toEqual([
      'https://e.com/1', 'https://e.com/2', 'https://e.com/3', 'https://e.com/4',
    ]);
    for (const ovr of overrides) expect(ovr.event_url).toBeUndefined();
    expect(result.clusters[0].url).toBeUndefined();  // no master URL since all distinct
  });

  it('folds "<base> - <variant>" buckets into the base when variant entries align with base DOW', () => {
    // OBC pattern: 4 "15km Open TT" Thursdays + 2 "15km Open TT - Road Bike Night"
    // Thursdays in the same season. Without folding, the variant rides become
    // either an irregular tiny cluster (rejected → orphaned) or split into
    // separate suggestions. With folding, all 6 dates form one cluster and the
    // variant suffix shows up as a note on those specific occurrences.
    const ics = makeIcs([
      { uid: 'a', summary: '15km Open TT',                    dtstart: '20260507T220000Z' }, // Thu
      { uid: 'b', summary: '15km Open TT',                    dtstart: '20260514T220000Z' },
      { uid: 'c', summary: '15km Open TT',                    dtstart: '20260521T220000Z' },
      { uid: 'd', summary: '15km Open TT - Road Bike Night',  dtstart: '20260528T220000Z' }, // variant
      { uid: 'e', summary: '15km Open TT',                    dtstart: '20260604T220000Z' },
      { uid: 'f', summary: '15km Open TT - Road Bike Night',  dtstart: '20260625T220000Z' }, // variant
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.summary).toBe('15km Open TT');
    expect(cluster.series?.recurrence_day).toBe('thursday');
    const variantDates = (cluster.series?.overrides ?? [])
      .filter(o => o.note?.includes('Road Bike Night'))
      .map(o => o.date);
    expect(variantDates.sort()).toEqual(['2026-05-28', '2026-06-25']);
    // Non-variant dates carry no synthetic note.
    const plainOvr = cluster.series?.overrides?.find(o => o.date === '2026-05-07');
    expect(plainOvr?.note).toBeUndefined();
  });

  it('does NOT fold a variant bucket whose entries land on a different DOW', () => {
    // Same prefix but the variant runs on Saturdays — clearly a separate
    // series; folding would merge unrelated events.
    const ics = makeIcs([
      { uid: 'a', summary: 'Group Ride',          dtstart: '20260507T140000Z' }, // Thu
      { uid: 'b', summary: 'Group Ride',          dtstart: '20260514T140000Z' },
      { uid: 'c', summary: 'Group Ride',          dtstart: '20260521T140000Z' },
      { uid: 'd', summary: 'Group Ride',          dtstart: '20260528T140000Z' },
      { uid: 'e', summary: 'Group Ride - Gravel', dtstart: '20260509T140000Z' }, // Sat — no fold
      { uid: 'f', summary: 'Group Ride - Gravel', dtstart: '20260516T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    const baseCluster = result.clusters.find(c => c.summary === 'Group Ride');
    expect(baseCluster?.series?.overrides).toHaveLength(4);
    // The Gravel pair didn't fold and didn't form their own cluster (only 2 entries),
    // so they fall through as orphans for the caller's one-off path.
    expect(result.orphans.map(o => o.uid).sort()).toEqual(['e', 'f']);
  });

  it('promotes shared event_url to master when all occurrences share one', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z', url: 'https://shared.com' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z', url: 'https://shared.com' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z', url: 'https://shared.com' },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z', url: 'https://shared.com' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    const cluster = result.clusters[0];
    expect(cluster.url).toBe('https://shared.com');
    for (const ovr of cluster.series?.overrides ?? []) {
      expect(ovr.event_url).toBeUndefined();
      expect(ovr.registration_url).toBeUndefined();
    }
  });

  it('sets master description when ≥60% share; deviating descriptions become note overrides', () => {
    const standard = '<p>The standard ride description</p>';
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z', description: standard },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z', description: standard },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z', description: standard },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z', description: '<p>Special bakery edition</p>' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    const cluster = result.clusters[0];
    expect(cluster.description).toBe('The standard ride description');
    const ovr = cluster.series?.overrides?.find(o => o.date === '2026-05-27');
    expect(ovr?.note).toBe('Special bakery edition');
    const standardOvr = cluster.series?.overrides?.find(o => o.date === '2026-05-06');
    expect(standardOvr?.note).toBeUndefined();
  });

  it('leaves master description empty when no modal; every distinct description becomes a note', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z', description: '<p>Route A</p>' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z', description: '<p>Route B</p>' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z', description: '<p>Route C</p>' },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z', description: '<p>Route D</p>' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    const cluster = result.clusters[0];
    expect(cluster.description).toBeUndefined();
    const notes = (cluster.series?.overrides ?? []).map(o => o.note).sort();
    expect(notes).toEqual(['Route A', 'Route B', 'Route C', 'Route D']);
  });

  it('detects cancellation in SUMMARY and emits override with cancelled+note', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z' },
      { uid: 'd', summary: 'X - CANCELLED', dtstart: '20260527T140000Z',
        description: '<p>Two ferries</p>' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const ovr = result.clusters[0].series?.overrides?.find(o => o.date === '2026-05-27');
    expect(ovr?.cancelled).toBe(true);
    expect(ovr?.note).toMatch(/^Cancelled\./);
    expect(ovr?.note).toContain('Two ferries');
  });

  it('strips status suffix from cluster summary so cancelled siblings still group', () => {
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X - CANCELLED', dtstart: '20260513T140000Z' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z' },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].summary).toBe('X');
  });
});

describe('revalidateClusterAfterTrim', () => {
  // Fixture uses unique URLs per occurrence so every entry produces a
  // meaningful override (carrying its uid). Without unique fields, a uniform
  // cluster yields `overrides: undefined` and there are no UIDs to filter
  // by — only the master uid handle remains. The unique-URL fixture mirrors
  // the production detection path that buildSuggestions feeds in (per Task 6,
  // overrides are produced for any divergent field).
  function makeCluster(): ParsedVEvent {
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z', url: 'https://e.com/a' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z', url: 'https://e.com/b' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z', url: 'https://e.com/c' },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z', url: 'https://e.com/d' },
      { uid: 'e', summary: 'X', dtstart: '20260603T140000Z', url: 'https://e.com/e' },
      { uid: 'f', summary: 'X', dtstart: '20260610T140000Z', url: 'https://e.com/f' },
      { uid: 'g', summary: 'X', dtstart: '20260617T140000Z', url: 'https://e.com/g' },
      { uid: 'h', summary: 'X', dtstart: '20260624T140000Z', url: 'https://e.com/h' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    // Sanity: each occurrence emitted an override, so we have UIDs to filter.
    expect(result.clusters[0].series?.overrides).toHaveLength(8);
    return result.clusters[0];
  }

  it('returns the cluster unchanged when no UIDs are removed', () => {
    const c = makeCluster();
    const result = revalidateClusterAfterTrim(c, new Set(), 'America/Toronto');
    expect(result).toBeTruthy();
    expect(result?.series?.recurrence).toBe('weekly');
    expect(result?.series?.season_start).toBe('2026-05-06');
    expect(result?.series?.season_end).toBe('2026-06-24');
  });

  it('returns null when surviving size < 4', () => {
    const c = makeCluster();
    const removed = new Set(['a', 'b', 'c', 'd', 'e']);  // 3 left
    expect(revalidateClusterAfterTrim(c, removed, 'America/Toronto')).toBeNull();
  });

  it('reclassifies as biweekly when every other occurrence is removed', () => {
    const c = makeCluster();
    // Remove a, c, e, g → leaves b, d, f, h with 14-day gaps
    const removed = new Set(['a', 'c', 'e', 'g']);
    const result = revalidateClusterAfterTrim(c, removed, 'America/Toronto');
    expect(result?.series?.recurrence).toBe('biweekly');
    expect(result?.series?.season_start).toBe('2026-05-13');
    expect(result?.series?.season_end).toBe('2026-06-24');
  });

  it('returns null when surviving gap exceeds 60 days', () => {
    const c = makeCluster();
    // Remove the middle occurrences, leaving a wide gap
    const removed = new Set(['b', 'c', 'd', 'e', 'f', 'g']);  // a + h survive (49 days apart - safe)
    const r = revalidateClusterAfterTrim(c, removed, 'America/Toronto');
    expect(r).toBeNull();  // size 2, below threshold
  });

  it('rejects survivors whose modal-cadence would not be in {7, 14}', () => {
    // Build a cluster where the surviving gaps yield a modal of 21d (a + d + g),
    // i.e. weekly cluster trimmed to every-third-week. That's not in {7,14}.
    const c = makeCluster();
    const removed = new Set(['b', 'c', 'e', 'f', 'h']);  // survivors: a (May 6), d (May 27), g (Jun 17)
    const r = revalidateClusterAfterTrim(c, removed, 'America/Toronto');
    expect(r).toBeNull();  // size 3 → fails MIN_CLUSTER_SIZE first; either way null
  });

  it('rejects 4 survivors at 21-day cadence (positive coverage of modal-not-in-{7,14})', () => {
    // 4 occurrences at 21-day spacing. Size passes MIN_CLUSTER_SIZE; gap
    // passes ≤60; modal gap = 21 — fails the modal-in-{7,14} check directly.
    // Constructed synthetically because tryFormCluster would have rejected a
    // tri-weekly cluster up-front, so we can't get here via makeCluster().
    const cluster: ParsedVEvent = {
      uid: 'a',
      summary: 'X',
      start: '2026-05-06T10:00:00',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'wednesday',
        season_start: '2026-05-06',
        season_end: '2026-07-08',
        overrides: [
          { date: '2026-05-06', uid: 'a' },
          { date: '2026-05-27', uid: 'b' },
          { date: '2026-06-17', uid: 'c' },
          { date: '2026-07-08', uid: 'd' },
        ],
      },
    };
    const r = revalidateClusterAfterTrim(cluster, new Set(), 'America/Toronto');
    expect(r).toBeNull();
  });

  it('rejects when a surviving gap is not a multiple of the modal (multiples-of-modal rule)', () => {
    // Construct a fresh cluster manually with 4 surviving occurrences whose
    // gaps would be [7, 10, 7]. Modal=7, but 10 isn't a multiple of 7 → reject.
    // Use a synthetic ParsedVEvent so we control the override dates exactly.
    const cluster: ParsedVEvent = {
      uid: 'a',
      summary: 'X',
      start: '2026-05-06T10:00:00',
      series: {
        kind: 'recurrence',
        recurrence: 'weekly',
        recurrence_day: 'wednesday',
        season_start: '2026-05-06',
        season_end: '2026-05-30',
        overrides: [
          { date: '2026-05-06', uid: 'a' },
          { date: '2026-05-13', uid: 'b' },
          { date: '2026-05-23', uid: 'c' },  // +10 from 13th
          { date: '2026-05-30', uid: 'd' },  // +7 from 23rd
        ],
      },
    };
    const r = revalidateClusterAfterTrim(cluster, new Set(), 'America/Toronto');
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Codex-found bug reproductions (currently failing — to be fixed)
// ---------------------------------------------------------------------------

describe('detectImplicitSeries — codex-found bugs', () => {
  it('emits a cancelled override for a missed cadence date in a weekly cluster', () => {
    // 4 Wednesdays with 5/20 missing. The multiples-of-modal cadence rule
    // accepts the 14-day gap as a missed week, so the cluster forms; the
    // missed week surfaces as a cancelled override (we use the override
    // mechanism rather than series.skip_dates so the public schedule renders
    // it with a cancellation badge instead of silently dropping the date).
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },
      // 5/20 missing
      { uid: 'c', summary: 'X', dtstart: '20260527T140000Z' },
      { uid: 'd', summary: 'X', dtstart: '20260603T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.series?.season_start).toBe('2026-05-06');
    expect(cluster.series?.season_end).toBe('2026-06-03');
    const missed = cluster.series?.overrides?.find(o => o.date === '2026-05-20');
    expect(missed).toEqual({ date: '2026-05-20', cancelled: true });
  });

  it('BUG: clean cluster with no field divergence loses per-occurrence UIDs needed for dedupe', () => {
    // 4 identical weekly Wednesdays — every field matches the modal, so no
    // override row "needs" to be emitted for divergence. But losing the
    // per-occurrence UIDs breaks partial-import dedupe: if the admin imports
    // b and c as one-offs, the next feed pull has no way to find their UIDs
    // on the cluster, so the whole series re-suggests including b and c.
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z' },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    const overrideUids = (cluster.series?.overrides ?? [])
      .flatMap(o => o.uid ? [o.uid] : [])
      .sort();
    expect(overrideUids).toEqual(['a', 'b', 'c', 'd']);
  });

  // Caller-side dissolve bug is captured in build-suggestions-trim.test.ts.
});

// ---------------------------------------------------------------------------
// Codex second-pass bug reproductions
// ---------------------------------------------------------------------------

describe('codex 2nd-pass bugs in revalidateClusterAfterTrim', () => {
  it('BUG: synthetic cancelled-skip rows are counted as real surviving occurrences', () => {
    // Detection produces 4 real occurrences + 1 cancelled-skip on 5/20.
    // Removing the master ("a") leaves 3 real (b, c, d) — below
    // MIN_CLUSTER_SIZE — so revalidate should return null. With the bug,
    // the cancelled-skip row inflates the surviving count to 4 and the
    // below-threshold cluster is incorrectly accepted.
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },
      // 5/20 missing → detection adds { date: '2026-05-20', cancelled: true }
      { uid: 'c', summary: 'X', dtstart: '20260527T140000Z' },
      { uid: 'd', summary: 'X', dtstart: '20260603T140000Z' },
    ]);
    const cluster = detectImplicitSeries(loadMasters(ics), 'America/Toronto').clusters[0];
    const trimmed = revalidateClusterAfterTrim(cluster, new Set(['a']), 'America/Toronto');
    expect(trimmed).toBeNull();
  });

  it('BUG: trimmed cluster keeps stale master uid even after the master was removed', () => {
    // Detection produces a 5-week Wednesday cluster. Master uid is "a"
    // (chronologically earliest). Admin imports just "a" as a one-off;
    // repoUids = {"a"}. Trim re-evaluates: 4 real survivors (b, c, d, e) ≥
    // MIN_CLUSTER_SIZE → returns a trimmed cluster. But the trimmed
    // cluster still carries cluster.uid = "a" — the uid that was just
    // removed. Surfacing this suggestion with uid "a" creates an
    // ics_uid collision in the repo (the original imported event already
    // claims "a"; the new save would claim it too).
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z' },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z' },
      { uid: 'e', summary: 'X', dtstart: '20260603T140000Z' },
    ]);
    const cluster = detectImplicitSeries(loadMasters(ics), 'America/Toronto').clusters[0];
    expect(cluster.uid).toBe('a');
    const trimmed = revalidateClusterAfterTrim(cluster, new Set(['a']), 'America/Toronto');
    expect(trimmed).not.toBeNull();
    // The trimmed cluster's uid must NOT be the removed master's uid; it
    // should adopt the first surviving real occurrence's uid.
    expect(trimmed!.uid).not.toBe('a');
    expect(trimmed!.uid).toBe('b');
  });

  it('BUG: trimmed cluster start time falls back to midnight when master is removed', () => {
    // 5 real Wednesdays (so 4 survive after removing master) at 10:00 local.
    // After removing master "a", the cluster's start should still report
    // 10:00 (the modal time), not 00:00.
    const ics = makeIcs([
      { uid: 'a', summary: 'X', dtstart: '20260506T140000Z' },
      { uid: 'b', summary: 'X', dtstart: '20260513T140000Z' },
      { uid: 'c', summary: 'X', dtstart: '20260520T140000Z' },
      { uid: 'd', summary: 'X', dtstart: '20260527T140000Z' },
      { uid: 'e', summary: 'X', dtstart: '20260603T140000Z' },
    ]);
    const cluster = detectImplicitSeries(loadMasters(ics), 'America/Toronto').clusters[0];
    expect(cluster.start).toBe('2026-05-06T10:00:00');
    const trimmed = revalidateClusterAfterTrim(cluster, new Set(['a']), 'America/Toronto');
    expect(trimmed).not.toBeNull();
    expect(trimmed!.start.endsWith('T10:00:00')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// User-reported bug: biweekly rides counted as weekly with off-weeks marked
// as cancelled. Asserts the expected behaviour for several biweekly shapes
// to figure out which one is misbehaving in production.
// ---------------------------------------------------------------------------

describe('BUG REPRO: biweekly classification', () => {
  it('pure biweekly: 4 occurrences with uniform 14-day gaps → biweekly cluster, no cancelled rows', () => {
    // 4 Tuesdays every 14 days, all in same year, same time.
    const ics = makeIcs([
      { uid: 'a', summary: 'Biweekly Ride', dtstart: '20260505T220000Z' },
      { uid: 'b', summary: 'Biweekly Ride', dtstart: '20260519T220000Z' },
      { uid: 'c', summary: 'Biweekly Ride', dtstart: '20260602T220000Z' },
      { uid: 'd', summary: 'Biweekly Ride', dtstart: '20260616T220000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.series?.recurrence).toBe('biweekly');
    // No off-weeks should be marked cancelled — every cycle date has an
    // occurrence.
    const cancelled = (cluster.series?.overrides ?? []).filter(o => o.cancelled);
    expect(cancelled).toEqual([]);
  });

  it('biweekly with one missed: 4 occurrences with gaps [14, 28, 14] → biweekly with 1 cancelled', () => {
    // Biweekly base with one missed cycle: dates a, +14, +28 (skip), +14.
    const ics = makeIcs([
      { uid: 'a', summary: 'Biweekly Ride', dtstart: '20260505T220000Z' },
      { uid: 'b', summary: 'Biweekly Ride', dtstart: '20260519T220000Z' },
      // 5/19 → 6/16 = 28 days = one missed biweek (6/2)
      { uid: 'c', summary: 'Biweekly Ride', dtstart: '20260616T220000Z' },
      { uid: 'd', summary: 'Biweekly Ride', dtstart: '20260630T220000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.series?.recurrence).toBe('biweekly');
    const cancelled = (cluster.series?.overrides ?? []).filter(o => o.cancelled);
    expect(cancelled.map(o => o.date)).toEqual(['2026-06-02']);
  });

  it('biweekly with one off-cycle extra session: gaps [14, 14, 7] → biweekly cluster + 5/16 as off-cycle override', () => {
    // Real shape from OBC's "Group Riding Clinic": 4 Saturday sessions at
    //   4/11, 4/25, 5/9, 5/16
    // The first three are biweekly; 5/16 is an extra session one week after
    // 5/9 (a make-up class or graduation). Today the strict
    // multiples-of-modal rule rejects because the 7-day gap is not a
    // multiple of 14, so all 4 events become 4 separate one-offs.
    //
    // Expected: cluster forms biweekly. Each event lands as an override
    // row (3 cycle-aligned + 1 off-cycle extra for 5/16). No phantom
    // cancelled-skip rows. expandSeriesOccurrences walks the cycle for
    // the aligned three, then iterates the off-cycle 5/16 as a "specific
    // date" extra — recurring + specific dates.
    const ics = makeIcs([
      { uid: 'a', summary: 'Group Riding Clinic', dtstart: '20260411T140000Z' },
      { uid: 'b', summary: 'Group Riding Clinic', dtstart: '20260425T140000Z' },
      { uid: 'c', summary: 'Group Riding Clinic', dtstart: '20260509T140000Z' },
      { uid: 'd', summary: 'Group Riding Clinic', dtstart: '20260516T140000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.series?.recurrence).toBe('biweekly');
    const overrides = cluster.series?.overrides ?? [];
    // All four events should be in overrides; no phantom cancelled.
    expect(overrides.map(o => o.date).sort()).toEqual([
      '2026-04-11', '2026-04-25', '2026-05-09', '2026-05-16',
    ]);
    expect(overrides.filter(o => o.cancelled)).toEqual([]);
  });

  it('off-season break splits a biweekly winter from a weekly spring (#ottbikesocial shape)', () => {
    // Real shape from #ottbikesocial 2026:
    //   4 biweekly Thursdays in winter (1/8, 1/22, 2/5, 2/19)
    //   then a 56-day off-season break
    //   then 11 weekly Thursdays starting 4/16 through 6/25
    //
    // BUG: with MAX_GAP_DAYS=60, the 56-day gap doesn't split. Combined,
    // weekly-count wins the modal vote (10 weekly gaps vs 3 biweekly), so
    // the whole 15-event sub-bucket is classified as weekly. The biweekly
    // off-weeks (1/15, 1/29, 2/12, 2/26) AND the off-season break weeks
    // become phantom cancelled-skip rows.
    //
    // EXPECTED: the 56-day gap is treated as an off-season break, splitting
    // into two clusters — winter biweekly + spring weekly.
    const ics = makeIcs([
      // Winter biweekly Thursdays
      { uid: 'w1', summary: '#ottbikesocial', dtstart: '20260109T000000Z' },  // Thu 1/8 ET
      { uid: 'w2', summary: '#ottbikesocial', dtstart: '20260123T000000Z' },  // Thu 1/22
      { uid: 'w3', summary: '#ottbikesocial', dtstart: '20260206T000000Z' },  // Thu 2/5
      { uid: 'w4', summary: '#ottbikesocial', dtstart: '20260220T000000Z' },  // Thu 2/19
      // 56-day off-season gap
      // Spring weekly Thursdays
      { uid: 's1', summary: '#ottbikesocial', dtstart: '20260416T230000Z' },  // Thu 4/16 ET
      { uid: 's2', summary: '#ottbikesocial', dtstart: '20260423T230000Z' },
      { uid: 's3', summary: '#ottbikesocial', dtstart: '20260430T230000Z' },
      { uid: 's4', summary: '#ottbikesocial', dtstart: '20260507T230000Z' },
      { uid: 's5', summary: '#ottbikesocial', dtstart: '20260514T230000Z' },
      { uid: 's6', summary: '#ottbikesocial', dtstart: '20260521T230000Z' },
      { uid: 's7', summary: '#ottbikesocial', dtstart: '20260528T230000Z' },
      { uid: 's8', summary: '#ottbikesocial', dtstart: '20260604T230000Z' },
      { uid: 's9', summary: '#ottbikesocial', dtstart: '20260611T230000Z' },
      { uid: 's10', summary: '#ottbikesocial', dtstart: '20260618T230000Z' },
      { uid: 's11', summary: '#ottbikesocial', dtstart: '20260625T230000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(2);
    const winter = result.clusters.find(c => c.series?.season_start?.startsWith('2026-01'));
    const spring = result.clusters.find(c => c.series?.season_start?.startsWith('2026-04'));
    expect(winter?.series?.recurrence).toBe('biweekly');
    expect(spring?.series?.recurrence).toBe('weekly');
    // Neither cluster should have phantom cancelled rows for the off-season
    // break or for the biweekly off-weeks.
    const winterCancelled = (winter?.series?.overrides ?? []).filter(o => o.cancelled);
    const springCancelled = (spring?.series?.overrides ?? []).filter(o => o.cancelled);
    expect(winterCancelled).toEqual([]);
    expect(springCancelled).toEqual([]);
  });

  it('biweekly OBC-shape: 5 Tuesdays with gaps [14, 14, 42, 28] → biweekly with 3 cancelled', () => {
    // Real shape from the 9.5km Women's & Youth TT in OBC fixture:
    //   May 5, May 19, Jun 2, Jul 14, Aug 11
    // Gaps: 14, 14, 42 (3 missed biweeks span: 6/16, 6/30, 7/14? no wait
    // 7/14 IS present, so missed are 6/16 and 6/30), 28 (7/28 missed).
    const ics = makeIcs([
      { uid: 'a', summary: '9.5km TT', dtstart: '20260505T220000Z' },
      { uid: 'b', summary: '9.5km TT', dtstart: '20260519T220000Z' },
      { uid: 'c', summary: '9.5km TT', dtstart: '20260602T220000Z' },
      { uid: 'd', summary: '9.5km TT', dtstart: '20260714T220000Z' },
      { uid: 'e', summary: '9.5km TT', dtstart: '20260811T220000Z' },
    ]);
    const result = detectImplicitSeries(loadMasters(ics), 'America/Toronto');
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.series?.recurrence).toBe('biweekly');
    const cancelled = (cluster.series?.overrides ?? []).filter(o => o.cancelled);
    expect(cancelled.map(o => o.date)).toEqual(['2026-06-16', '2026-06-30', '2026-07-28']);
  });
});
