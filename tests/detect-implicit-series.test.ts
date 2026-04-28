import { describe, it, expect } from 'vitest';
import { extractDescription, detectCancellation } from '../src/lib/calendar-suggestions/detect-implicit-series';

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
