export interface RideFilterInput {
  distance_km: number;
  moving_time_s?: number;
  average_speed_kmh?: number;
  tour_slug?: string;
  country?: string;
  ride_date?: string;
  status?: string;
}

export interface RideFilter {
  id: string;
  label: string;
  predicate: (ride: RideFilterInput) => boolean;
  adminOnly?: boolean;
}

export const rideFilters: RideFilter[] = [
  { id: 'all', label: 'All', predicate: () => true },
  {
    id: 'chill',
    label: 'Chill',
    predicate: (r) =>
      r.distance_km <= 32 &&
      (!r.moving_time_s || r.moving_time_s <= 10800) &&
      (!r.average_speed_kmh || r.average_speed_kmh < 20) &&
      !r.tour_slug,
  },
  {
    id: 'long',
    label: 'Long',
    predicate: (r) => r.distance_km >= 50 || (r.moving_time_s != null && r.moving_time_s >= 18000),
  },
  {
    id: 'fast',
    label: 'Fast',
    predicate: (r) => (r.average_speed_kmh ?? 0) > 22,
  },
  {
    id: 'century',
    label: 'Century',
    predicate: (r) => r.distance_km >= 100,
  },
  {
    id: 'tours',
    label: 'Tours',
    predicate: (r) => !!r.tour_slug,
  },
  {
    id: 'unpublished',
    label: 'Unpublished',
    predicate: (r) => r.status !== 'published',
    adminOnly: true,
  },
];

export function applyFilter(filterId: string, ride: RideFilterInput): boolean {
  const filter = rideFilters.find(f => f.id === filterId);
  return filter ? filter.predicate(ride) : true;
}

export function getYears(rides: RideFilterInput[]): number[] {
  const years = new Set<number>();
  for (const r of rides) {
    if (r.ride_date) years.add(new Date(r.ride_date).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

export function getCountries(rides: RideFilterInput[]): string[] {
  const countries = new Set<string>();
  for (const r of rides) {
    if (r.country) countries.add(r.country);
  }
  return [...countries].sort();
}
