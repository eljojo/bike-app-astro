import { describe, it, expect } from 'vitest';
import { extractDescription, detectCancellation, pickModalDescription } from '../src/lib/calendar-suggestions/detect-implicit-series';

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
