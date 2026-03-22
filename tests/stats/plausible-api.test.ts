import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parsePlausibleResponse } from '../../src/lib/external/plausible-api.server';

const loadFixture = (name: string) => JSON.parse(fs.readFileSync(`e2e/fixtures/plausible/${name}`, 'utf-8'));

describe('parsePlausibleResponse', () => {
  it('parses a page breakdown response', () => {
    const fixture = loadFixture('page-breakdown.json');
    const parsed = parsePlausibleResponse(fixture);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty('dimensions');
    expect(parsed[0]).toHaveProperty('metrics');
    // First result should be '/' (homepage, highest pageviews)
    expect(parsed[0].dimensions[0]).toBe('/');
  });

  it('parses a daily aggregate response', () => {
    const fixture = loadFixture('daily-aggregate.json');
    const parsed = parsePlausibleResponse(fixture);
    expect(parsed.length).toBeGreaterThan(50);
    expect(parsed[0].dimensions[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('parses video play events', () => {
    const fixture = loadFixture('video-plays.json');
    const parsed = parsePlausibleResponse(fixture);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].dimensions[0]).toMatch(/^\//);
  });
});
