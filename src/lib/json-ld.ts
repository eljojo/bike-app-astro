export function routeJsonLd(route: { name: string; tagline?: string; distance_km: number; id: string }, coverUrl?: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: route.name,
    description: route.tagline || `${route.name} — ${route.distance_km}km cycling route in Ottawa`,
    url: `https://ottawabybike.ca/routes/${route.id}`,
    touristType: 'Cycling',
    ...(coverUrl && { image: coverUrl }),
  };
}

export function eventJsonLd(event: { name: string; start_date: string; end_date?: string; location?: string; registration_url?: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.name,
    startDate: event.start_date,
    ...(event.end_date && { endDate: event.end_date }),
    ...(event.location && { location: { '@type': 'Place', name: event.location } }),
    ...(event.registration_url && { url: event.registration_url }),
    sport: 'Cycling',
  };
}

export function guideJsonLd(guide: { name: string; tagline?: string; id: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.name,
    ...(guide.tagline && { description: guide.tagline }),
    url: `https://ottawabybike.ca/guides/${guide.id}`,
    publisher: { '@type': 'Organization', name: 'Ottawa by Bike' },
  };
}
