import { describe, it, expect } from 'vitest';
import ICAL from 'ical.js';
import { extractDescription, detectCancellation, pickModalDescription, detectImplicitSeries } from '../src/lib/calendar-suggestions/detect-implicit-series';

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
