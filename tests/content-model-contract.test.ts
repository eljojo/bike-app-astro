import { describe, it, expect } from 'vitest';
import * as routeModel from '../src/lib/models/route-model';
import * as eventModel from '../src/lib/models/event-model';
import * as placeModel from '../src/lib/models/place-model';
import * as rideModel from '../src/lib/models/ride-model';

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
