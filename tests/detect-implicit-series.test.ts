import { describe, it, expect } from 'vitest';
import { extractDescription } from '../src/lib/calendar-suggestions/detect-implicit-series';

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
