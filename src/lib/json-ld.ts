export const AUTHOR = [{
  '@type': 'Person' as const,
  name: 'José Albornoz',
  url: 'https://ottawabybike.ca/about',
}];

export function routeJsonLd(
  route: { name: string; tagline?: string; distance_km: number; id: string; created_at: string; updated_at: string },
  coverUrl?: string,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: route.name,
    description: route.tagline || `${route.name} — ${route.distance_km}km cycling route in Ottawa`,
    url: `https://ottawabybike.ca/routes/${route.id}`,
    datePublished: route.created_at,
    dateModified: route.updated_at,
    author: AUTHOR,
    ...(coverUrl && { image: [coverUrl] }),
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
    author: AUTHOR,
  };
}

export function breadcrumbJsonLd(crumbs: { name: string; url: string }[]) {
  if (crumbs.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem' as const,
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}
