/**
 * Pre-built content collection definitions for blog consumer repos.
 * Keeps the consumer's content.config.ts as a thin re-export.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { rideLoader } from './loaders/rides';
import { pageLoader } from './loaders/pages';
import {
  routeSchema, placeSchema, guideSchema,
  eventSchema, organizerSchema, pageSchema,
} from './schemas/index';

const CITY_DIR = `${process.env.CONTENT_DIR || '.'}/${process.env.CITY || 'blog'}`;
const mdPattern = ['**/*.md', '!**/*.??.md'];

export const collections = {
  routes: defineCollection({ loader: rideLoader(), schema: routeSchema }),
  places: defineCollection({ loader: glob({ pattern: mdPattern, base: `${CITY_DIR}/places` }), schema: placeSchema }),
  guides: defineCollection({ loader: glob({ pattern: mdPattern, base: `${CITY_DIR}/guides` }), schema: guideSchema }),
  events: defineCollection({ loader: glob({ pattern: mdPattern, base: `${CITY_DIR}/events` }), schema: eventSchema }),
  organizers: defineCollection({ loader: glob({ pattern: mdPattern, base: `${CITY_DIR}/organizers` }), schema: organizerSchema }),
  pages: defineCollection({ loader: pageLoader(), schema: pageSchema }),
};
