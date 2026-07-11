import { describe, it, expect } from 'vitest';
import * as yaml from 'js-yaml';
import matter from 'gray-matter';

import { eventDetailSchema, eventDetailToCache, eventDetailFromCache } from '../src/lib/models/event-model';
import { eventDetailFromGit } from '../src/lib/models/event-model.server';
import { routeDetailSchema, routeDetailToCache, routeDetailFromCache } from '../src/lib/models/route-model';
import { routeDetailFromGit } from '../src/lib/models/route-model.server';
import { placeDetailSchema, placeDetailToCache, placeDetailFromCache } from '../src/lib/models/place-model';
import { placeDetailFromGit } from '../src/lib/models/place-model.server';
import { organizerDetailSchema, organizerDetailToCache, organizerDetailFromCache } from '../src/lib/models/organizer-model';
import { parseOrganizerFile } from '../src/lib/models/organizer-model.server';
import { rideDetailSchema, rideDetailToCache, rideDetailFromCache } from '../src/lib/models/ride-model';
import { rideDetailFromGit } from '../src/lib/models/ride-model.server';

/**
 * Drift-proof round-trip contract for every content type whose git <-> cache
 * converters are hand-synced with a detail schema. These converters have drifted
 * before — events silently dropped ics_uid/banner_text/linked_routes for months
 * (fixed in e12f3982). This test makes that class of drift impossible to ship:
 *
 *   - `expected` holds the exact value each schema field must carry after
 *     fromGit -> toCache -> fromCache.
 *   - `derived` names fields computed inside fromGit (GPX metrics, content hash):
 *     asserted present and cache-stable rather than pinned to a literal.
 *   - `excluded` names fields legitimately absent from the git round-trip, each
 *     with a one-line reason.
 *
 * The coverage assertion enumerates keys from the Zod schema's `.shape`, NOT a
 * hand-maintained list — so a FUTURE field added to a detail schema but forgotten
 * in fromGit/toCache/fromCache fails this test with no test edit: it will be
 * neither in `expected`/`derived`/`excluded` (coverage fails) nor carried through
 * the round-trip (value fidelity fails).
 *
 * bike-path is intentionally omitted: its fromGit spreads `...frontmatter` into a
 * zod parse rather than hand-listing fields, so it cannot drift this way.
 */

/** A media item exercising every baseMediaItemSchema field (base + video fields). */
const baseMediaFixture = {
  key: 'm1',
  type: 'photo',
  caption: 'A caption',
  cover: true,
  width: 640,
  height: 480,
  lat: 45.1,
  lng: -75.1,
  title: 'Clip title',
  handle: 'rider',
  duration: '0:30',
  orientation: 'landscape',
};

/** GPX with three timestamped points ~100m apart so every metric parses non-zero. */
const rideGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"><trk><trkseg>
<trkpt lat="45.0000" lon="-75.0000"><ele>50</ele><time>2026-05-02T07:00:00Z</time></trkpt>
<trkpt lat="45.0009" lon="-75.0000"><ele>55</ele><time>2026-05-02T07:01:00Z</time></trkpt>
<trkpt lat="45.0018" lon="-75.0000"><ele>60</ele><time>2026-05-02T07:02:00Z</time></trkpt>
</trkseg></trk></gpx>`;

interface TypeContract {
  name: string;
  /** Field names enumerated programmatically from the detail schema's Zod shape. */
  schemaKeys: string[];
  detail: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- per-type toCache signatures differ; any lets each concrete fn assign
  toCache: (d: any) => string;
  fromCache: (blob: string) => Record<string, unknown>;
  /** Fields whose exact value must survive the round-trip. */
  expected: Record<string, unknown>;
  /** Fields computed inside fromGit — asserted present + cache-stable, not pinned. */
  derived: string[];
  /** Fields legitimately absent from the git round-trip, with a reason. */
  excluded: Record<string, string>;
}

// --- Event --------------------------------------------------------------------
const eventFrontmatter = {
  name: 'Spring 200',
  start_date: '2026-05-01',
  event_date: '2026-05-01',
  start_time: '07:00',
  meet_time: '06:45',
  end_date: '2026-05-01',
  end_time: '20:00',
  time_limit_hours: 13.5,
  status: 'open',
  routes: ['200k'],
  registration: { url: 'https://reg', slots: 50, price: '20', deadline: '2026-04-30', departure_groups: ['A', 'B'] },
  registration_url: 'https://register',
  waypoints: [{ place: 'cafe', type: 'checkpoint', label: 'Cafe', distance_km: 100, opening: '08:00', closing: '12:00', route: '200k', note: 'stamp' }],
  results: [{ brevet_no: 1, last_name: 'Doe', first_name: 'Jane', time: '09:30', homologation: 'H1', status: 'DNF' }],
  gpx_include_waypoints: true,
  distances: '200,300',
  location: 'Ottawa',
  review_url: 'https://review',
  organizer: { name: 'Club', website: 'https://club', instagram: '@club', photo_key: 'k', photo_content_type: 'image/jpeg', photo_width: 100, photo_height: 100 },
  poster_key: 'poster',
  poster_content_type: 'image/png',
  poster_width: 800,
  poster_height: 600,
  tags: ['brevet'],
  past_slugs: ['old-slug'],
  previous_event: '2025/spring-brevet',
  edition: '5th',
  banner_text: 'Register now',
  ics_uid: 'uid-123',
  linked_routes: [{ route: '200k', variant: 'main', label: '200' }],
  event_url: 'https://event',
  map_url: 'https://map',
  series: {
    recurrence: 'weekly',
    recurrence_day: 'saturday',
    season_start: '2026-04-01',
    season_end: '2026-09-01',
    skip_dates: ['2026-07-01'],
    overrides: [{ date: '2026-05-08', location: 'X', start_time: '07:00', meet_time: '06:45', note: 'n', cancelled: false, rescheduled_from: '2026-05-07', uid: 'u1', event_url: 'https://e', map_url: 'https://m', registration_url: 'https://r' }],
    schedule: [{ date: '2026-06-01' }],
  },
};
const eventDetail = eventDetailFromGit(
  '2026/spring-brevet',
  eventFrontmatter,
  'Event body text.',
  yaml.dump([baseMediaFixture]),
);
const eventContract: TypeContract = {
  name: 'event',
  schemaKeys: Object.keys(eventDetailSchema.shape),
  detail: eventDetail,
  toCache: eventDetailToCache,
  fromCache: eventDetailFromCache,
  expected: {
    id: '2026/spring-brevet',
    slug: 'spring-brevet',
    year: '2026',
    ...eventFrontmatter,
    body: 'Event body text.',
    media: [baseMediaFixture],
  },
  derived: [],
  excluded: {},
};

// --- Route --------------------------------------------------------------------
const routeFrontmatter = {
  name: 'Scenic Loop',
  tagline: 'A nice loop',
  tags: ['scenic', 'easy'],
  distance_km: 42.5,
  status: 'published',
  variants: [{ name: 'Main', gpx: 'main.gpx', distance_km: 42.5, strava_url: 'https://s', rwgps_url: 'https://r', google_maps_url: 'https://g', komoot_url: 'https://k' }],
};
const routeMediaItem = { ...baseMediaFixture, uploaded_by: 'jose', captured_at: '2026-05-01' };
const routeTranslations = { fr: { name: 'Boucle', tagline: 'Jolie', body: 'Corps' } };
const routeDetail = routeDetailFromGit(
  'scenic-loop',
  routeFrontmatter,
  'Route body.',
  yaml.dump([routeMediaItem]),
  routeTranslations,
);
const routeContract: TypeContract = {
  name: 'route',
  schemaKeys: Object.keys(routeDetailSchema.shape),
  detail: routeDetail,
  toCache: routeDetailToCache,
  fromCache: routeDetailFromCache,
  expected: {
    slug: 'scenic-loop',
    ...routeFrontmatter,
    body: 'Route body.',
    media: [routeMediaItem],
    translations: routeTranslations,
  },
  derived: [],
  excluded: {},
};

// --- Place --------------------------------------------------------------------
const placeFrontmatter = {
  name: 'Corner Bakery',
  name_fr: 'Boulangerie du coin',
  category: 'bakery',
  lat: 45.42,
  lng: -75.69,
  status: 'published',
  vibe: 'cozy',
  good_for: ['refuel', 'post-ride'],
  address: '123 St',
  website: 'https://bakery',
  phone: '555-1234',
  google_maps_url: 'https://maps',
  photo_key: 'photo',
  organizer: 'city-club',
  social_links: [{ platform: 'instagram', url: 'https://instagram.com/bakery' }],
};
const placeDetail = placeDetailFromGit('bakery-corner', placeFrontmatter);
const placeContract: TypeContract = {
  name: 'place',
  schemaKeys: Object.keys(placeDetailSchema.shape),
  detail: placeDetail,
  toCache: placeDetailToCache,
  fromCache: placeDetailFromCache,
  expected: { id: 'bakery-corner', ...placeFrontmatter },
  derived: [],
  excluded: {},
};

// --- Organizer ----------------------------------------------------------------
const organizerFrontmatter = {
  name: 'City Club',
  tagline: 'Ride together',
  tags: ['club'],
  featured: true,
  hidden: true,
  website: 'https://club',
  instagram: '@cityclub',
  ics_url: 'https://ics',
  social_links: [{ platform: 'website', url: 'https://club' }],
  photo_key: 'photo',
  photo_content_type: 'image/jpeg',
  photo_width: 200,
  photo_height: 200,
  media: [baseMediaFixture],
};
const organizerDetail = parseOrganizerFile(
  'city-club',
  matter.stringify('Club body.', organizerFrontmatter),
);
const organizerContract: TypeContract = {
  name: 'organizer',
  schemaKeys: Object.keys(organizerDetailSchema.shape),
  detail: organizerDetail,
  toCache: organizerDetailToCache,
  fromCache: organizerDetailFromCache,
  expected: {
    slug: 'city-club',
    ...organizerFrontmatter,
    body: 'Club body.',
  },
  derived: [],
  excluded: {
    contentHash: 'Computed at load time from git file snapshots; parseOrganizerFile never serializes it.',
  },
};

// --- Ride ---------------------------------------------------------------------
const rideFrontmatter = {
  name: 'Morning Ride',
  tagline: 'Quick spin',
  tags: ['commute'],
  status: 'published',
  ride_date: '2026-05-02',
  country: 'CA',
  tour_slug: 'spring-tour',
  highlight: true,
  strava_id: '123456',
  privacy_zone: true,
  variants: [{ gpx: 'ride.gpx' }],
};
const rideDetail = rideDetailFromGit(
  'morning-ride',
  rideFrontmatter,
  'Ride body.',
  rideGpx,
  yaml.dump([baseMediaFixture]),
);
const rideContract: TypeContract = {
  name: 'ride',
  schemaKeys: Object.keys(rideDetailSchema.shape),
  detail: rideDetail,
  toCache: rideDetailToCache,
  fromCache: rideDetailFromCache,
  expected: {
    slug: 'morning-ride',
    name: 'Morning Ride',
    tagline: 'Quick spin',
    tags: ['commute'],
    status: 'published',
    body: 'Ride body.',
    media: [baseMediaFixture],
    ride_date: '2026-05-02',
    country: 'CA',
    tour_slug: 'spring-tour',
    highlight: true,
    strava_id: '123456',
    privacy_zone: true,
  },
  // variants[].distance_km and the timing metrics come from parsing the GPX.
  derived: ['variants', 'contentHash', 'elapsed_time_s', 'moving_time_s', 'average_speed_kmh'],
  excluded: {},
};

const contracts: TypeContract[] = [
  eventContract,
  routeContract,
  placeContract,
  organizerContract,
  rideContract,
];

describe.each(contracts)('$name model git <-> cache round-trip contract', (c) => {
  const shapeKeys = c.schemaKeys;
  const accountedFor = new Set([
    ...Object.keys(c.expected),
    ...c.derived,
    ...Object.keys(c.excluded),
  ]);
  const restored = c.fromCache(c.toCache(c.detail));

  it('every schema field is accounted for (new fields must be wired end-to-end)', () => {
    const unaccounted = shapeKeys.filter((k) => !accountedFor.has(k));
    expect(unaccounted, `${c.name}: schema fields with no expected/derived/excluded entry`).toEqual([]);

    const stale = [...accountedFor].filter((k) => !shapeKeys.includes(k));
    expect(stale, `${c.name}: contract references fields absent from the schema`).toEqual([]);
  });

  it('cache serialization loses nothing', () => {
    expect(restored).toEqual(c.detail);
  });

  it('every expected field survives with its exact value', () => {
    for (const [key, value] of Object.entries(c.expected)) {
      expect(restored[key], `${c.name}.${key} drifted through the round-trip`).toEqual(value);
    }
  });

  it('every derived field is present and cache-stable', () => {
    for (const key of c.derived) {
      expect(restored[key], `${c.name}.${key} (derived) missing after round-trip`).toBeDefined();
      expect(restored[key], `${c.name}.${key} (derived) not cache-stable`).toEqual(c.detail[key]);
    }
  });
});
