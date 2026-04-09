import { describe, it, expect } from 'vitest';
import { computeHashFromParts } from '../src/lib/models/content-hash.server';
import { computeRouteContentHash } from '../src/lib/models/route-model.server';
import { computeEventContentHash } from '../src/lib/models/event-model.server';
import { computePlaceContentHash } from '../src/lib/models/place-model.server';
import { computeOrganizerContentHash } from '../src/lib/models/organizer-model.server';
import { computeBikePathContentHash } from '../src/lib/models/bike-path-model.server';

// ---------------------------------------------------------------------------
// computeHashFromParts — the shared utility
// ---------------------------------------------------------------------------

describe('computeHashFromParts', () => {
  it('same input produces same hash (stability)', () => {
    const a = computeHashFromParts('hello', 'world');
    const b = computeHashFromParts('hello', 'world');
    expect(a).toBe(b);
  });

  it('different input produces different hash (sensitivity)', () => {
    const a = computeHashFromParts('hello');
    const b = computeHashFromParts('goodbye');
    expect(a).not.toBe(b);
  });

  it('undefined parts are skipped — hash(hello, undefined, world) equals hash(hello, world)', () => {
    const withUndefined = computeHashFromParts('hello', undefined, 'world');
    const withoutUndefined = computeHashFromParts('hello', 'world');
    expect(withUndefined).toBe(withoutUndefined);
  });

  it('order matters — (hello, world) differs from (world, hello)', () => {
    const ab = computeHashFromParts('hello', 'world');
    const ba = computeHashFromParts('world', 'hello');
    expect(ab).not.toBe(ba);
  });
});

// ---------------------------------------------------------------------------
// computeRouteContentHash
// ---------------------------------------------------------------------------

const ROUTE_PRIMARY = '---\nname: Test Route\ndistance_km: 42\n---\nRide through the hills.';
const ROUTE_MEDIA = '- key: photo-abc\n  content_type: image/jpeg\n  width: 1920\n  height: 1080\n';
const ROUTE_TRANSLATIONS: Record<string, string> = {
  fr: '---\nname: Itinéraire test\n---\nVélo dans les collines.',
  es: '---\nname: Ruta de prueba\n---\nPedaleo por las colinas.',
};

describe('computeRouteContentHash', () => {
  it('stable — same primary and media produce the same hash', () => {
    const a = computeRouteContentHash(ROUTE_PRIMARY, ROUTE_MEDIA);
    const b = computeRouteContentHash(ROUTE_PRIMARY, ROUTE_MEDIA);
    expect(a).toBe(b);
  });

  it('sensitive to primary content change', () => {
    const original = computeRouteContentHash(ROUTE_PRIMARY, ROUTE_MEDIA);
    const changed = computeRouteContentHash(
      '---\nname: Different Route\ndistance_km: 42\n---\nRide through the valley.',
      ROUTE_MEDIA,
    );
    expect(original).not.toBe(changed);
  });

  it('sensitive to media content change', () => {
    const original = computeRouteContentHash(ROUTE_PRIMARY, ROUTE_MEDIA);
    const changed = computeRouteContentHash(ROUTE_PRIMARY, '- key: photo-xyz\n  content_type: image/jpeg\n');
    expect(original).not.toBe(changed);
  });

  it('sensitive to translation change', () => {
    const original = computeRouteContentHash(ROUTE_PRIMARY, ROUTE_MEDIA, ROUTE_TRANSLATIONS);
    const changed = computeRouteContentHash(ROUTE_PRIMARY, ROUTE_MEDIA, {
      ...ROUTE_TRANSLATIONS,
      fr: '---\nname: Itinéraire modifié\n---\nTexte différent.',
    });
    expect(original).not.toBe(changed);
  });

  it('translation order does NOT matter — {fr, es} equals {es, fr}', () => {
    const frFirst = computeRouteContentHash(ROUTE_PRIMARY, undefined, { fr: 'A', es: 'B' });
    const esFirst = computeRouteContentHash(ROUTE_PRIMARY, undefined, { es: 'B', fr: 'A' });
    expect(frFirst).toBe(esFirst);
  });

  it('handles undefined media — stable without media arg', () => {
    const a = computeRouteContentHash(ROUTE_PRIMARY, undefined);
    const b = computeRouteContentHash(ROUTE_PRIMARY, undefined);
    expect(a).toBe(b);
  });

  it('adding media changes hash compared to undefined media', () => {
    const withoutMedia = computeRouteContentHash(ROUTE_PRIMARY, undefined);
    const withMedia = computeRouteContentHash(ROUTE_PRIMARY, ROUTE_MEDIA);
    expect(withoutMedia).not.toBe(withMedia);
  });
});

// ---------------------------------------------------------------------------
// computeEventContentHash
// ---------------------------------------------------------------------------

const EVENT_CONTENT = '---\nname: Spring Brevet\nstart_date: 2099-04-01\n---\nGather at sunrise.';
const EVENT_MEDIA = '- key: poster-abc\n  content_type: image/jpeg\n';

describe('computeEventContentHash', () => {
  it('stable — same input produces same hash', () => {
    const a = computeEventContentHash(EVENT_CONTENT, EVENT_MEDIA);
    const b = computeEventContentHash(EVENT_CONTENT, EVENT_MEDIA);
    expect(a).toBe(b);
  });

  it('sensitive to content change', () => {
    const original = computeEventContentHash(EVENT_CONTENT);
    const changed = computeEventContentHash(
      '---\nname: Autumn Brevet\nstart_date: 2099-10-01\n---\nLeave at dusk.',
    );
    expect(original).not.toBe(changed);
  });

  it('sensitive to media change', () => {
    const original = computeEventContentHash(EVENT_CONTENT, EVENT_MEDIA);
    const changed = computeEventContentHash(EVENT_CONTENT, '- key: poster-xyz\n  content_type: image/png\n');
    expect(original).not.toBe(changed);
  });

  it('undefined media and no media argument produce the same hash', () => {
    const withUndefined = computeEventContentHash(EVENT_CONTENT, undefined);
    const withoutArg = computeEventContentHash(EVENT_CONTENT);
    expect(withUndefined).toBe(withoutArg);
  });
});

// ---------------------------------------------------------------------------
// computePlaceContentHash
// ---------------------------------------------------------------------------

const PLACE_CONTENT = '---\nname: Corner Bakery\ncategory: cafe\nlat: 48.8566\nlng: 2.3522\n---\n';

describe('computePlaceContentHash', () => {
  it('stable — same input produces same hash', () => {
    const a = computePlaceContentHash(PLACE_CONTENT);
    const b = computePlaceContentHash(PLACE_CONTENT);
    expect(a).toBe(b);
  });

  it('sensitive to content change', () => {
    const original = computePlaceContentHash(PLACE_CONTENT);
    const changed = computePlaceContentHash(
      '---\nname: Riverside Café\ncategory: cafe\nlat: 48.8600\nlng: 2.3400\n---\n',
    );
    expect(original).not.toBe(changed);
  });
});

// ---------------------------------------------------------------------------
// computeOrganizerContentHash
// ---------------------------------------------------------------------------

const ORGANIZER_CONTENT = '---\nname: Randonneuring Club\ntags:\n  - randonneuring\n---\nA club for long-distance cyclists.';

describe('computeOrganizerContentHash', () => {
  it('stable — same input produces same hash', () => {
    const a = computeOrganizerContentHash(ORGANIZER_CONTENT);
    const b = computeOrganizerContentHash(ORGANIZER_CONTENT);
    expect(a).toBe(b);
  });

  it('sensitive to content change', () => {
    const original = computeOrganizerContentHash(ORGANIZER_CONTENT);
    const changed = computeOrganizerContentHash(
      '---\nname: Mountain Bike Association\ntags:\n  - mtb\n---\nRiding the ridgelines.',
    );
    expect(original).not.toBe(changed);
  });
});

// ---------------------------------------------------------------------------
// computeBikePathContentHash
// ---------------------------------------------------------------------------

const BIKE_PATH_CONTENT = '---\nname: Lakeside Trail\npath_type: protected_lane\n---\nA smooth path beside the water.';

describe('computeBikePathContentHash', () => {
  it('stable — same input produces same hash', () => {
    const a = computeBikePathContentHash(BIKE_PATH_CONTENT);
    const b = computeBikePathContentHash(BIKE_PATH_CONTENT);
    expect(a).toBe(b);
  });

  it('sensitive to content change', () => {
    const original = computeBikePathContentHash(BIKE_PATH_CONTENT);
    const changed = computeBikePathContentHash(
      '---\nname: Ridgeline Path\npath_type: shared_road\n---\nA winding road through the hills.',
    );
    expect(original).not.toBe(changed);
  });
});
