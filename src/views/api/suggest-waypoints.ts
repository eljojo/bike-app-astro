/**
 * Suggest waypoints for a route by finding nearby places.
 * POST /api/suggest-waypoints { routeSlug: string }
 *
 * See src/integrations/AGENTS.md for route registration gotchas.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { findNearbyPlaces } from '@/lib/proximity';
import { haversineM } from '@/lib/proximity';
import { authorize } from '@/lib/auth/authorize';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = authorize(locals, 'edit-content');
  if (auth instanceof Response) return auth;
  const body = await request.json();
  const routeSlug = body.routeSlug as string;

  if (!routeSlug) {
    return new Response(JSON.stringify({ error: 'routeSlug required' }), { status: 400 });
  }

  const routes = await getCollection('routes');
  const route = routes.find((r: { id: string }) => r.id === routeSlug);

  if (!route) {
    return new Response(JSON.stringify({ error: 'Route not found' }), { status: 404 });
  }

  const places = await getCollection('places');
  const placeData = places.map((p: { id: string; data: { name: string; name_fr?: string; category?: string; lat: number; lng: number; address?: string; website?: string; phone?: string } }) => ({
    id: p.id,
    name: p.data.name,
    name_fr: p.data.name_fr,
    category: p.data.category || '',
    lat: p.data.lat,
    lng: p.data.lng,
    address: p.data.address,
    website: p.data.website,
    phone: p.data.phone,
  }));

  // Get track points from the first variant
  const firstVariant = route.data.variants[0];
  if (!firstVariant) {
    return new Response(JSON.stringify({ suggestions: [] }));
  }

  const track = route.data.gpxTracks[firstVariant.gpx];
  if (!track || !track.points.length) {
    return new Response(JSON.stringify({ suggestions: [] }));
  }

  const nearby = findNearbyPlaces(track.points, placeData);

  // Compute distance along route (km) for each nearby place
  const suggestions = nearby.map(place => {
    // Find the closest track point index to estimate distance along route
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < track.points.length; i++) {
      const d = haversineM(track.points[i].lat, track.points[i].lon, place.lat, place.lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    // Estimate km based on position along track
    const fraction = track.points.length > 1 ? bestIdx / (track.points.length - 1) : 0;
    const distanceKm = Math.round(fraction * track.distance_m / 1000 * 10) / 10;

    return {
      slug: place.id,
      name: place.name,
      category: place.category,
      lat: place.lat,
      lng: place.lng,
      distance_km: distanceKm,
      distance_from_route_m: place.distance_m,
    };
  });

  return new Response(JSON.stringify({ suggestions }));
};
