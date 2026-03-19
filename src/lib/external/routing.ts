// Browser-safe — no .server.ts, no Node APIs

export interface RoutingWaypoint {
  lat: number;
  lng: number;
  type: 'stop' | 'via' | 'shaping';
  name?: string;
}

export interface RoutingResult {
  /** Points use `lon` (codebase GeoPoint convention), not `lng` (Google convention). */
  points: Array<{ lat: number; lon: number }>;
  distance_m: number;
}

export interface RoutingService {
  getRoute(waypoints: RoutingWaypoint[]): Promise<RoutingResult>;
}
