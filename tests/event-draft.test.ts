import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/env/env.service', () => ({ env: {} }));
vi.mock('../src/lib/auth/authorize', () => ({ authorize: vi.fn() }));
vi.mock('../src/lib/config/city-config', () => ({ getCityConfig: () => ({ timezone: 'America/Toronto' }) }));
vi.mock('../src/lib/get-db', () => ({ db: () => ({}) }));
vi.mock('../src/lib/auth/rate-limit', () => ({ checkRateLimit: vi.fn(), recordAttempt: vi.fn(), cleanupOldAttempts: vi.fn(), LIMITS: {} }));
vi.mock('../src/lib/media/storage.adapter-r2', () => ({ generateMediaKey: vi.fn(), confirmUpload: vi.fn() }));
vi.mock('../src/lib/content/load-admin-content.server', () => ({ fetchJson: vi.fn() }));

import { buildDraft, htmlToText, extractSeriesFromText, parseAiResponse } from '../src/views/api/event-draft';

const organizers = [
  { slug: 'ottawa-bicycle-club', name: 'Ottawa Bicycle Club', website: 'https://ottawabicycleclub.ca', instagram: 'ottawabicycleclub' },
  { slug: 'bike-ottawa', name: 'Bike Ottawa' },
];

describe('buildDraft organizer resolution', () => {
  it('emits a bare slug string when AI matches a known organizer', () => {
    const { draft } = buildDraft({
      name: { value: 'Spring Ride', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      organizer: { slug: 'ottawa-bicycle-club', name: 'Ottawa Bicycle Club', c: 9 },
    }, organizers);

    expect(draft.organizer).toBe('ottawa-bicycle-club');
  });

  it('uses the slug from organizers registry even when AI name differs', () => {
    const { draft } = buildDraft({
      name: { value: 'Some Race', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      organizer: { slug: 'bike-ottawa', name: 'Bike Ottawa Coalition', c: 9 },
    }, organizers);

    expect(draft.organizer).toBe('bike-ottawa');
  });

  it('rejects unknown slug from AI and falls back to fuzzy match by name', () => {
    const { draft } = buildDraft({
      name: { value: 'Spring Ride', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      organizer: { slug: 'nonexistent-slug', name: 'Ottawa Bicycle Club', c: 9 },
    }, organizers);

    expect(draft.organizer).toBe('ottawa-bicycle-club');
  });

  it('falls back to fuzzy match when AI provides only a legacy {value, c} shape', () => {
    const { draft } = buildDraft({
      name: { value: 'Spring Ride', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      organizer: { value: 'Ottawa Bicycle Club', c: 8 },
    }, organizers);

    expect(draft.organizer).toBe('ottawa-bicycle-club');
  });

  it('does not overlay AI-extracted website on a matched organizer', () => {
    // Saving a matched organizer would write fields back to its canonical file
    // (event-save.ts:188+). A page-specific URL must not leak into the global org.
    const { draft } = buildDraft({
      name: { value: 'Spring Ride', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      organizer: { slug: 'ottawa-bicycle-club', name: 'Ottawa Bicycle Club', c: 9 },
      organizer_website: { value: 'https://springride.ca', c: 7 },
      organizer_instagram: { value: 'springride', c: 7 },
    }, organizers);

    expect(draft.organizer).toBe('ottawa-bicycle-club');
  });

  it('builds inline object for unmatched organizer with extracted contact info', () => {
    const { draft } = buildDraft({
      name: { value: 'New Event', c: 9 },
      start_date: { value: '2026-06-01', c: 9 },
      organizer: { name: 'Some Brand New Club', c: 8 },
      organizer_website: { value: 'https://newclub.ca', c: 7 },
      organizer_instagram: { value: 'newclub', c: 7 },
    }, organizers);

    expect(typeof draft.organizer).toBe('object');
    const org = draft.organizer as Record<string, string>;
    expect(org.name).toBe('Some Brand New Club');
    expect(org.website).toBe('https://newclub.ca');
    expect(org.instagram).toBe('newclub');
  });

  it('does not leak organizer_website or organizer_instagram to top-level draft', () => {
    const { draft } = buildDraft({
      name: { value: 'Test Event', c: 9 },
      start_date: { value: '2026-06-01', c: 9 },
      organizer: { name: 'Some Club', c: 8 },
      organizer_website: { value: 'https://example.com', c: 7 },
      organizer_instagram: { value: 'someclub', c: 7 },
    }, organizers);

    expect(draft.organizer_website).toBeUndefined();
    expect(draft.organizer_instagram).toBeUndefined();
  });
});

describe('buildDraft tag extraction', () => {
  it('includes valid tags from AI response', () => {
    const { draft } = buildDraft({
      name: { value: 'Gravel Race', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      tags: ['gravel', 'race'],
    }, organizers);

    expect(draft.tags).toEqual(['gravel', 'race']);
  });

  it('accepts tags from knownTags in addition to EVENT_TAG_SLUGS', () => {
    const { draft } = buildDraft({
      name: { value: 'Family BMX Day', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      tags: ['race', 'family-friendly', 'bmx'],
    }, organizers, ['family-friendly', 'bmx', 'mountain-bike']);

    expect(draft.tags).toEqual(['race', 'family-friendly', 'bmx']);
  });

  it('filters out tags that are not in EVENT_TAG_SLUGS or knownTags', () => {
    const { draft } = buildDraft({
      name: { value: 'Fun Ride', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      tags: ['social', 'invented-tag', 'group-ride', 'family-friendly'],
    }, organizers, ['family-friendly']);

    expect(draft.tags).toEqual(['social', 'group-ride', 'family-friendly']);
  });

  it('omits tags field when no valid tags', () => {
    const { draft } = buildDraft({
      name: { value: 'Mystery Event', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      tags: ['not-a-real-tag'],
    }, organizers);

    expect(draft.tags).toBeUndefined();
  });

  it('omits tags when not provided', () => {
    const { draft } = buildDraft({
      name: { value: 'Plain Event', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
    }, organizers);

    expect(draft.tags).toBeUndefined();
  });
});

describe('htmlToText', () => {
  it('preserves link text with URL', () => {
    const html = '<a href="https://example.com/register">Stage 1 - Register</a>';
    const text = htmlToText(html);
    expect(text).toContain('Stage 1 - Register');
    expect(text).toContain('https://example.com/register');
  });

  it('extracts button-link labels with URLs', () => {
    const html = `
      <div class="FubTgk" id="comp-1" aria-disabled="false">
        <a href="https://ccnbikes.com/#!/events/stage-1" target="_blank" class="uDW_Qe wixui-button">
          <span class="l7_2fn wixui-button__label">Stage 1 - Register</span>
        </a>
      </div>
      <div class="FubTgk" id="comp-2" aria-disabled="false">
        <a href="https://ccnbikes.com/#!/events/stage-2" target="_blank" class="uDW_Qe wixui-button">
          <span class="l7_2fn wixui-button__label">Stage 2 - Register</span>
        </a>
      </div>`;
    const text = htmlToText(html);
    expect(text).toContain('Stage 1 - Register');
    expect(text).toContain('https://ccnbikes.com/#!/events/stage-1');
    expect(text).toContain('Stage 2 - Register');
    expect(text).toContain('https://ccnbikes.com/#!/events/stage-2');
  });

  it('preserves date-location lines from rich text spans', () => {
    const html = `
      <span class="wixui-rich-text__text"><span style="font-weight:bold;">Stage 1: May 13</span>&nbsp;| Domaine Kanawe</span>
      <br class="wixui-rich-text__text">
      <span class="wixui-rich-text__text"><span style="font-weight:bold;">Stage 2: May 27</span>&nbsp;| Domaine Kanawe</span>`;
    const text = htmlToText(html);
    expect(text).toContain('Stage 1: May 13');
    expect(text).toContain('Domaine Kanawe');
    expect(text).toContain('Stage 2: May 27');
  });

  it('strips scripts and styles', () => {
    const html = '<script>alert("x")</script><style>.x{}</style><p>Hello</p>';
    const text = htmlToText(html);
    expect(text).toBe('Hello');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('.x');
  });

  it('collapses excessive whitespace', () => {
    const html = '<p>One</p><p></p><p></p><p></p><p>Two</p>';
    const text = htmlToText(html);
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('decodes HTML entities', () => {
    const html = '<p>Rock &amp; Roll &lt;3</p>';
    const text = htmlToText(html);
    expect(text).toContain('Rock & Roll <3');
  });

  it('extracts series structure from a Wix-style event page', () => {
    const html = `
      <div id="comp-kz4u4zyn" class="wixui-rich-text" data-testid="richTextElement">
        <h2 class="font_2 wixui-rich-text__text" style="font-size:20px;">
          <span class="wixui-rich-text__text">
            <span class="wixui-rich-text__text">
              <span style="text-decoration:underline;" class="wixui-rich-text__text">
                <span style="letter-spacing:0.25em;" class="wixui-rich-text__text">2026 Preliminary Dates:</span>
              </span>
            </span>
            <br class="wixui-rich-text__text">
            <span class="wixui-rich-text__text">
              <span style="letter-spacing:0.25em;" class="wixui-rich-text__text">
                <span style="font-weight:bold;" class="wixui-rich-text__text">Stage 1: May 13</span>&nbsp;| Domaine Kanawe
              </span>
            </span>
            <br class="wixui-rich-text__text">
            <span class="wixui-rich-text__text">
              <span style="letter-spacing:0.25em;" class="wixui-rich-text__text">
                <span style="font-weight:bold;" class="wixui-rich-text__text">Stage 2: May 27</span>&nbsp;| Domaine Kanawe
              </span>
            </span>
          </span>
        </h2>
      </div>
      <div class="comp-mlbaz30f FubTgk" id="comp-mlbaz30f" aria-disabled="false">
        <a data-testid="linkElement" href="https://ccnbikes.com/#!/series/trek-twilight-mtb-series-2026" target="_blank" rel="noreferrer noopener" class="uDW_Qe wixui-button PlZyDq" aria-disabled="false" aria-label="Full Series Registration">
          <span class="l7_2fn wixui-button__label">Full Series Registration</span>
        </a>
      </div>
      <div class="comp-l2uzzbly FubTgk" id="comp-l2uzzbly" aria-disabled="false">
        <a data-testid="linkElement" href="https://ccnbikes.com/#!/events/stage-1-domaine-kanawe" target="_blank" class="uDW_Qe wixui-button PlZyDq">
          <span class="l7_2fn wixui-button__label">Stage 1 - Register</span>
        </a>
      </div>
      <div class="comp-l2uzzck3 FubTgk" id="comp-l2uzzck3" aria-disabled="false">
        <a data-testid="linkElement" href="https://ccnbikes.com/#!/events/stage-2-domaine-kanawe" target="_blank" class="uDW_Qe wixui-button PlZyDq">
          <span class="l7_2fn wixui-button__label">Stage 2 - Register</span>
        </a>
      </div>`;
    const text = htmlToText(html);
    expect(text).toContain('Stage 1: May 13');
    expect(text).toContain('Domaine Kanawe');
    expect(text).toContain('Stage 2: May 27');
    expect(text).toContain('Full Series Registration');
    expect(text).toContain('ccnbikes.com');
    expect(text).toContain('Stage 1 - Register');
    expect(text).toContain('Stage 2 - Register');
  });
});

describe('buildDraft series extraction', () => {
  it('builds series with explicit schedule from AI output', () => {
    const { draft } = buildDraft({
      name: { value: 'Trek Twilight MTB Series', c: 9 },
      start_date: { value: '2026-05-13', c: 9 },
      end_date: { value: '2026-08-26', c: 8 },
      location: { value: 'Various locations', c: 7 },
      organizer: { value: "Bakker's Trailblazers", c: 8 },
      registration_url: { value: 'https://ccnbikes.com/#!/series/trek-twilight-mtb-series-2026', c: 8 },
      tags: ['race'],
      series: {
        schedule: [
          { date: '2026-05-13', location: 'Domaine Kanawe' },
          { date: '2026-05-27', location: 'Domaine Kanawe' },
          { date: '2026-06-10', location: 'Vorlage' },
          { date: '2026-06-24', location: 'Vorlage' },
          { date: '2026-07-29', location: 'Wesley Clover' },
          { date: '2026-08-26', location: 'Wesley Clover' },
        ],
        recurrence: 'biweekly',
        recurrence_day: 'tuesday',
        season_start: '2026-05-13',
        season_end: '2026-08-26',
      },
    }, organizers);

    expect(draft.series).toBeDefined();
    const series = draft.series as Record<string, unknown>;
    const schedule = series.schedule as Array<{ date: string; location?: string }>;
    expect(schedule).toHaveLength(6);
    expect(schedule[0]).toEqual({ date: '2026-05-13', location: 'Domaine Kanawe' });
    expect(schedule[2]).toEqual({ date: '2026-06-10', location: 'Vorlage' });
    expect(series.recurrence).toBe('biweekly');
    expect(series.recurrence_day).toBe('tuesday');
  });

  it('sets start_date from first schedule entry when AI omits start_date', () => {
    const { draft } = buildDraft({
      name: { value: 'Stage Race', c: 9 },
      series: {
        schedule: [
          { date: '2026-06-01', location: 'Park A' },
          { date: '2026-06-15', location: 'Park B' },
        ],
      },
    }, organizers);

    expect(draft.start_date).toBe('2026-06-01');
    expect(draft.year).toBe('2026');
  });

  it('rejects schedule with fewer than 2 entries', () => {
    const { draft } = buildDraft({
      name: { value: 'Almost a Series', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      series: {
        schedule: [{ date: '2026-05-01' }],
      },
    }, organizers);

    expect(draft.series).toBeUndefined();
  });

  it('rejects schedule entries with invalid dates', () => {
    const { draft } = buildDraft({
      name: { value: 'Bad Dates', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      series: {
        schedule: [
          { date: 'May 13' },
          { date: 'May 27' },
        ],
      },
    }, organizers);

    expect(draft.series).toBeUndefined();
  });

  it('builds series with recurrence rule only (no schedule)', () => {
    const { draft } = buildDraft({
      name: { value: 'Weekly Ride', c: 9 },
      start_date: { value: '2026-05-05', c: 9 },
      end_date: { value: '2026-08-25', c: 8 },
      series: {
        recurrence: 'weekly',
        recurrence_day: 'tuesday',
        season_start: '2026-05-05',
        season_end: '2026-08-25',
      },
    }, organizers);

    expect(draft.series).toBeDefined();
    const series = draft.series as Record<string, unknown>;
    expect(series.recurrence).toBe('weekly');
    expect(series.recurrence_day).toBe('tuesday');
    expect(series.schedule).toBeUndefined();
  });
});

describe('extractSeriesFromText', () => {
  it('extracts stages with dates and locations from Bakkers-style text', () => {
    const text = `2026 Preliminary Dates:
Stage 1: May 13 | Domaine Kanawe
Stage 2: May 27 | Domaine Kanawe
Stage 3: June 10 | Vorlage
Stage 4: June 24 | Vorlage
Stage 5: July 29 | Wesley Clover
Stage 6: August 26 | Wesley Clover`;

    const schedule = extractSeriesFromText(text, '2026');
    expect(schedule).toHaveLength(6);
    expect(schedule![0]).toEqual({ date: '2026-05-13', location: 'Domaine Kanawe' });
    expect(schedule![2]).toEqual({ date: '2026-06-10', location: 'Vorlage' });
    expect(schedule![5]).toEqual({ date: '2026-08-26', location: 'Wesley Clover' });
  });

  it('extracts stages with dash separator', () => {
    const text = `Race Schedule:
Race 1 - June 5 | Park A
Race 2 - June 19 | Park B
Race 3 - July 3 | Park A`;

    const schedule = extractSeriesFromText(text, '2026');
    expect(schedule).toHaveLength(3);
    expect(schedule![0]).toEqual({ date: '2026-06-05', location: 'Park A' });
    expect(schedule![1]).toEqual({ date: '2026-06-19', location: 'Park B' });
  });

  it('extracts stages without locations', () => {
    const text = `Series Dates:
Stage 1: May 10
Stage 2: May 24
Stage 3: June 7`;

    const schedule = extractSeriesFromText(text, '2026');
    expect(schedule).toHaveLength(3);
    expect(schedule![0]).toEqual({ date: '2026-05-10' });
    expect(schedule![2]).toEqual({ date: '2026-06-07' });
  });

  it('returns null for fewer than 2 stages', () => {
    const text = 'Series Dates:\nStage 1: May 13 | Some Park';
    expect(extractSeriesFromText(text, '2026')).toBeNull();
  });

  it('returns null for text with no stage pattern', () => {
    const text = 'Join us for a fun ride on May 13 at the park!';
    expect(extractSeriesFromText(text, '2026')).toBeNull();
  });

  it('returns null when stages exist but no schedule-context heading', () => {
    // Stage-like text without a "dates:", "schedule:", "series:" heading
    const text = `Results from last year
Stage 1: May 13 | Domaine Kanawe
Stage 2: May 27 | Domaine Kanawe
Stage 3: June 10 | Vorlage`;

    expect(extractSeriesFromText(text, '2026')).toBeNull();
  });

  it('returns null for generic "event" numbering (not a trigger word)', () => {
    const text = `Calendar:
Event 1: May 13 | City Hall
Event 2: May 27 | Library
Event 3: June 10 | Park`;

    expect(extractSeriesFromText(text, '2026')).toBeNull();
  });

  it('handles abbreviated month names', () => {
    const text = `Stages:
Stage 1: Jan 5 | Rink A
Stage 2: Feb 2 | Rink B`;

    const schedule = extractSeriesFromText(text, '2026');
    expect(schedule).toHaveLength(2);
    expect(schedule![0]).toEqual({ date: '2026-01-05', location: 'Rink A' });
    expect(schedule![1]).toEqual({ date: '2026-02-02', location: 'Rink B' });
  });

  it('deduplicates stages by number', () => {
    const text = `Preliminary Dates:
Stage 1: May 13 | Domaine Kanawe
Stage 2: May 27 | Domaine Kanawe
Stage 1: May 13
Stage 2: May 27`;

    const schedule = extractSeriesFromText(text, '2026');
    expect(schedule).toHaveLength(2);
  });

  it('uses current year when no reference year provided', () => {
    const text = `Series Dates:
Stage 1: May 10 | Park A
Stage 2: May 24 | Park B`;

    const schedule = extractSeriesFromText(text);
    expect(schedule).toHaveLength(2);
    expect(schedule![0].date).toMatch(/^\d{4}-05-10$/);
  });

  it('works with em-dash and en-dash separators', () => {
    const text = `Schedule:
Stage 1: May 10 \u2014 Park A
Stage 2: May 24 \u2013 Park B`;

    const schedule = extractSeriesFromText(text, '2026');
    expect(schedule).toHaveLength(2);
    expect(schedule![0]).toEqual({ date: '2026-05-10', location: 'Park A' });
  });
});

describe('buildDraft organizer edge cases', () => {
  it('treats fake-slug + unmatched name as a custom organizer', () => {
    const { draft } = buildDraft({
      name: { value: 'Some Event', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      organizer: { slug: 'nonexistent-slug', name: 'Brand New Mystery Org', c: 7 },
    }, organizers);

    expect(typeof draft.organizer).toBe('object');
    const org = draft.organizer as Record<string, string>;
    expect(org.name).toBe('Brand New Mystery Org');
  });

  it('keeps short ambiguous names as custom (no acronym expansion)', () => {
    // Fuzzy match does not expand acronyms; "OBC" should not auto-resolve to
    // "Ottawa Bicycle Club". It stays custom and gets flagged as uncertain.
    const { draft, uncertain } = buildDraft({
      name: { value: 'Some Race', c: 9 },
      start_date: { value: '2026-05-01', c: 9 },
      organizer: { name: 'OBC', c: 5 },
    }, organizers);

    expect(typeof draft.organizer).toBe('object');
    const org = draft.organizer as Record<string, string>;
    expect(org.name).toBe('OBC');
    expect(uncertain).toContain('organizer');
  });
});

describe('parseAiResponse organizer recovery in malformed JSON', () => {
  it('recovers the new {slug, name, c} shape from malformed JSON', () => {
    const malformed = '{"name":{"value":"Race","c":9},"organizer":{"slug":"nepean-bmx","name":"Nepean BMX","c":9},,,broken}';
    const result = parseAiResponse(malformed);
    expect(result.organizer).toEqual({ slug: 'nepean-bmx', name: 'Nepean BMX', c: 9 });
  });

  it('recovers the legacy {value, c} shape from malformed JSON', () => {
    const malformed = '{"name":{"value":"Race","c":9},"organizer":{"value":"Ottawa Bicycle Club","c":8},,,broken}';
    const result = parseAiResponse(malformed);
    expect(result.organizer).toEqual({ name: 'Ottawa Bicycle Club', c: 8 });
  });
});
