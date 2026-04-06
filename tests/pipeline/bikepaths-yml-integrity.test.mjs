/**
 * Integrity tests for Ottawa bikepaths.yml.
 *
 * These assert real-world geographic and classification facts about Ottawa's
 * cycling infrastructure. If the pipeline changes break these, the data is wrong.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(process.env.HOME, 'code', 'bike-routes');
const ymlPath = path.join(CONTENT_DIR, 'ottawa', 'bikepaths.yml');
const ymlExists = fs.existsSync(ymlPath);

let entries;
let bySlug;
let byName;

beforeAll(() => {
  if (!ymlExists) return;
  const data = yaml.load(fs.readFileSync(ymlPath, 'utf-8'));
  entries = data.bike_paths;
  bySlug = new Map(entries.filter(e => e.slug).map(e => [e.slug, e]));
  byName = new Map(entries.map(e => [e.name, e]));
});

function net(slug) {
  const e = bySlug.get(slug);
  expect(e, `network ${slug} must exist`).toBeDefined();
  return e;
}

function entry(slug) {
  const e = bySlug.get(slug);
  expect(e, `entry ${slug} must exist`).toBeDefined();
  return e;
}

// ---------------------------------------------------------------------------
// Long-distance classification — only truly long trails
// ---------------------------------------------------------------------------

describe.skipIf(!ymlExists)('long-distance classification', () => {
  const mustNotBeLongDistance = [
    'sentier-des-pionniers-pathway',
    'watts-creek-pathway',
    'greenbelt-pathway-west',
    'greenbelt-pathway-west-barrhaven',
    'rideau-canal-eastern-pathway',
    'rideau-canal-western-pathway',
    'experimental-farm-pathway',
    'ottawa-river-pathway-east',
    'ottawa-river-pathway-west',
    'prescott-russell-trail-link',
  ];

  for (const slug of mustNotBeLongDistance) {
    it(`${slug} is NOT long-distance (it's a local pathway)`, () => {
      const e = entry(slug);
      expect(e.type).not.toBe('long-distance');
    });
  }

  it('Sentier Trans-Canada Gatineau-Montréal IS long-distance', () => {
    if (!entries) return;
    const e = entry('sentier-trans-canada-gatineau-montreal');
    expect(e.type).toBe('long-distance');
  });

  it('Sentier Trans-Canada Gatineau-Montréal has no member_of (too large for any local network)', () => {
    if (!entries) return;
    const e = entry('sentier-trans-canada-gatineau-montreal');
    expect(e.member_of).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Network membership — trails belong where they physically are
// ---------------------------------------------------------------------------

describe.skipIf(!ymlExists)('TCT segments belong to their local networks', () => {
  it('Trans Canada Trail (Bells Corners/Watts Creek) is a member of NCC Greenbelt', () => {
    if (!entries) return;
    const greenbelt = net('ncc-greenbelt');
    expect(greenbelt.members).toContain('trans-canada-trail-bells-cornerswatts-creek');
  });

  it('Trans Canada Trail (Sussex Drive) is a member of Ottawa River Pathway', () => {
    if (!entries) return;
    const orp = net('ottawa-river-pathway');
    expect(orp.members).toContain('trans-canada-trail-sussex-drive');
  });

  it('Ottawa River Pathway (Trans Canada Trail) is a member of Ottawa River Pathway', () => {
    if (!entries) return;
    const orp = net('ottawa-river-pathway');
    expect(orp.members).toContain('ottawa-river-pathway-trans-canada-trail');
  });

  it('Trans Canada Trail (Sussex Drive) has member_of ottawa-river-pathway', () => {
    if (!entries) return;
    const e = entry('trans-canada-trail-sussex-drive');
    expect(e.member_of).toBe('ottawa-river-pathway');
  });

  it('Trans Canada Trail (Bells Corners/Watts Creek) has member_of ncc-greenbelt', () => {
    if (!entries) return;
    const e = entry('trans-canada-trail-bells-cornerswatts-creek');
    expect(e.member_of).toBe('ncc-greenbelt');
  });

  it('Ottawa River Pathway (Trans Canada Trail) has member_of ottawa-river-pathway', () => {
    if (!entries) return;
    const e = entry('ottawa-river-pathway-trans-canada-trail');
    expect(e.member_of).toBe('ottawa-river-pathway');
  });
});

// ---------------------------------------------------------------------------
// Capital Pathway gained its real sections
// ---------------------------------------------------------------------------

describe.skipIf(!ymlExists)('Capital Pathway members', () => {
  const expectedMembers = [
    'sentier-des-pionniers-pathway',
    'watts-creek-pathway',
    'rideau-canal-western-pathway',
    'rideau-canal-eastern-pathway',
    'experimental-farm-pathway',
    'ottawa-river-pathway-east',
    'ottawa-river-pathway-west',
    'greenbelt-pathway-west',
    'greenbelt-pathway-west-barrhaven',
  ];

  for (const slug of expectedMembers) {
    it(`Capital Pathway includes ${slug}`, () => {
      const cp = net('capital-pathway');
      expect(cp.members).toContain(slug);
    });
  }
});
