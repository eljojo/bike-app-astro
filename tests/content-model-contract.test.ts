import { describe, it, expect } from 'vitest';
import * as routeModel from '../src/lib/models/route-model';
import * as eventModel from '../src/lib/models/event-model';
import * as placeModel from '../src/lib/models/place-model';
import * as rideModel from '../src/lib/models/ride-model';
import { computeHashFromParts } from '../src/lib/models/content-model';

describe('computeHashFromParts', () => {
  it('hashes single part', () => {
    const h = computeHashFromParts('hello');
    expect(h).toMatch(/^[a-f0-9]+$/);
  });

  it('ignores undefined parts', () => {
    const h1 = computeHashFromParts('hello', undefined, undefined);
    const h2 = computeHashFromParts('hello');
    expect(h1).toBe(h2);
  });

  it('different content produces different hash', () => {
    expect(computeHashFromParts('a')).not.toBe(computeHashFromParts('b'));
  });

  it('order matters', () => {
    expect(computeHashFromParts('a', 'b')).not.toBe(computeHashFromParts('b', 'a'));
  });
});

describe('content model contract', () => {
  const models = [
    { name: 'route', m: routeModel, hash: 'computeRouteContentHash', hashFiles: 'computeRouteContentHashFromFiles', fromGit: 'routeDetailFromGit', toCache: 'routeDetailToCache', fromCache: 'routeDetailFromCache', buildFresh: 'buildFreshRouteData', schema: 'routeDetailSchema' },
    { name: 'event', m: eventModel, hash: 'computeEventContentHash', hashFiles: 'computeEventContentHashFromFiles', fromGit: 'eventDetailFromGit', toCache: 'eventDetailToCache', fromCache: 'eventDetailFromCache', buildFresh: 'buildFreshEventData', schema: 'eventDetailSchema' },
    { name: 'place', m: placeModel, hash: 'computePlaceContentHash', hashFiles: 'computePlaceContentHashFromFiles', fromGit: 'placeDetailFromGit', toCache: 'placeDetailToCache', fromCache: 'placeDetailFromCache', buildFresh: 'buildFreshPlaceData', schema: 'placeDetailSchema' },
    { name: 'ride', m: rideModel, hash: 'computeRideContentHash', hashFiles: 'computeRideContentHashFromFiles', fromGit: 'rideDetailFromGit', toCache: 'rideDetailToCache', fromCache: 'rideDetailFromCache', buildFresh: 'buildFreshRideData', schema: 'rideDetailSchema' },
  ];

  for (const { name, m, ...fns } of models) {
    describe(name, () => {
      for (const [role, fnName] of Object.entries(fns)) {
        it(`exports ${fnName}`, () => {
          expect(typeof (m as Record<string, unknown>)[fnName]).toBe(role === 'schema' ? 'object' : 'function');
        });
      }
    });
  }
});
