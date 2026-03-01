import { getCollection } from 'astro:content';
import { getAllElevations } from './elevation';
import { toPlaceData } from './places';
import type { PlaceData } from './proximity';

/**
 * Load the shared data needed by most route pages:
 * all routes, their elevation stats, and the published places list.
 */
export async function loadRouteData() {
  const routes = await getCollection('routes');
  const allElevations = getAllElevations(routes);
  const allPlaces = await getCollection('places');
  const placeData = toPlaceData(allPlaces);
  return { routes, allElevations, placeData };
}

export type { PlaceData };
