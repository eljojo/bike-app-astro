// content-ops.ts — Shared content operations per content type.
//
// Each ContentOps object provides getFilePaths, computeContentHash, and
// buildFreshData for a content type. Used by the content type registry,
// save handlers, and the revert endpoint.
//
// Rides are excluded — their getFilePaths needs gpxRelativePath from the
// request body, which isn't derivable from slug alone.

import { CITY } from '../config/config';
import { supportedLocales, defaultLocale } from '../i18n/locale-utils';
import { buildFreshRouteData, computeRouteContentHashFromFiles } from '../models/route-model.server';
import { buildFreshEventData, computeEventContentHashFromFiles } from '../models/event-model.server';
import { buildFreshPlaceData, computePlaceContentHashFromFiles } from '../models/place-model.server';
import type { ContentOps } from './content-types.server';

export const routeOps: ContentOps = {
  getFilePaths(slug: string) {
    const basePath = `${CITY}/routes/${slug}`;
    const secondaryLocales = supportedLocales().filter(l => l !== defaultLocale());
    return {
      primary: `${basePath}/index.md`,
      auxiliary: [
        `${basePath}/media.yml`,
        ...secondaryLocales.map(l => `${basePath}/index.${l}.md`),
      ],
    };
  },
  computeContentHash: computeRouteContentHashFromFiles,
  buildFreshData: buildFreshRouteData,
};

export const eventOps: ContentOps = {
  getFilePaths(eventId: string) {
    const [year, slug] = eventId.split('/');
    const dirBase = `${CITY}/events/${year}/${slug}`;
    return {
      primary: `${dirBase}/index.md`,
      auxiliary: [`${dirBase}.md`, `${dirBase}/media.yml`],
    };
  },
  computeContentHash: computeEventContentHashFromFiles,
  buildFreshData: buildFreshEventData,
};

export const placeOps: ContentOps = {
  getFilePaths(placeId: string) {
    return { primary: `${CITY}/places/${placeId}.md` };
  },
  computeContentHash: computePlaceContentHashFromFiles,
  buildFreshData: buildFreshPlaceData,
};
