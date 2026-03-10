import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { routeLoader } from './loaders/routes';
import { rideLoader } from './loaders/rides';
import { pageLoader } from './loaders/pages';
import { isBlogInstance } from './lib/city-config';
import {
  routeSchema, placeSchema, guideSchema,
  eventSchema, organizerSchema, pageSchema,
} from './schemas/index';

const CITY_DIR = `${process.env.CONTENT_DIR || '../bike-routes'}/${process.env.CITY || 'ottawa'}`;

// Exclude translation files (e.g. bike-crash.fr.md) — only load base language
const mdPattern = ['**/*.md', '!**/*.??.md'];

const routes = defineCollection({
  loader: isBlogInstance() ? rideLoader() : routeLoader(),
  schema: routeSchema,
});

const places = defineCollection({
  loader: glob({ pattern: mdPattern, base: `${CITY_DIR}/places` }),
  schema: placeSchema,
});

const guides = defineCollection({
  loader: glob({ pattern: mdPattern, base: `${CITY_DIR}/guides` }),
  schema: guideSchema,
});

const events = defineCollection({
  loader: glob({ pattern: mdPattern, base: `${CITY_DIR}/events` }),
  schema: eventSchema,
});

const organizers = defineCollection({
  loader: glob({ pattern: mdPattern, base: `${CITY_DIR}/organizers` }),
  schema: organizerSchema,
});

const pages = defineCollection({
  loader: pageLoader(),
  schema: pageSchema,
});

export const collections = { routes, places, guides, events, organizers, pages };
