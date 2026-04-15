import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { findNearbyPlaces, haversineM, type NearbyPlace } from '@/lib/geo/proximity';
import { toPlaceData } from '@/lib/geo/places';
import { loadBuildPlan, filterByBuildPlan } from '@/lib/content/build-plan.server';

export const prerender = true;

interface WaypointSuggestion {
  slug: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  distance_km: number;
  distance_from_route_m: number;
}

function toWaypointSuggestion(place: NearbyPlace, distanceKm: number): WaypointSuggestion {
  return {
    slug: place.id,
    name: place.name,
    category: place.category,
    lat: place.lat,
    lng: place.lng,
    distance_km: distanceKm,
    distance_from_route_m: place.distance_m,
  };
}

export const getStaticPaths: GetStaticPaths = async () => {
  const allRoutes = await getCollection('routes');
  const plan = loadBuildPlan();

  // If any place changed, all suggestions may be affected — rebuild all routes.
  const placeChanged = plan?.mode === 'incremental' &&
    plan.changedSlugs.some(key => key.startsWith('place:'));
  const routes = placeChanged ? allRoutes : filterByBuildPlan(allRoutes, plan, 'route');
  const places = await getCollection('places');
  const placeData = toPlaceData(places);

  return routes.map(route => {
    const firstVariant = route.data.variants[0];
    const track = firstVariant ? route.data.gpxTracks[firstVariant.gpx] : undefined;

    let suggestions: WaypointSuggestion[] = [];

    if (track && track.points.length >= 2) {
      const nearby = findNearbyPlaces(track.points, placeData);
      suggestions = nearby.map(place => {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < track.points.length; i++) {
          const d = haversineM(track.points[i].lat, track.points[i].lon, place.lat, place.lng);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        const fraction = track.points.length > 1 ? bestIdx / (track.points.length - 1) : 0;
        const distanceKm = Math.round(fraction * track.distance_m / 1000 * 10) / 10;
        return toWaypointSuggestion(place, distanceKm);
      });
    }

    return {
      params: { slug: route.id },
      props: { suggestions },
    };
  });
};

export const GET: APIRoute = async ({ props }) => {
  return new Response(JSON.stringify({ suggestions: props.suggestions }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
