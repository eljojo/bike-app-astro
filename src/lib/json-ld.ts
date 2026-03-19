import { getCityConfig } from './config/city-config';
import { originalUrl } from './media/image-service';

const config = getCityConfig();

export const AUTHOR = [{
  '@type': 'Person' as const,
  name: config.author.name,
  url: config.author.url,
}];

// --- Price parsing ---

const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW',
};

/** Try to extract a numeric price and currency from a freeform string like "$25", "€10", "$1.000". */
export function parsePrice(raw: string): { price: number; currency: string } | null {
  const trimmed = raw.trim();
  if (!trimmed || /^(free|gratis|gratuit|libre)$/i.test(trimmed)) return null;

  // Find currency symbol
  const symbolMatch = trimmed.match(/[$€£¥₩]/);
  const currency = symbolMatch ? CURRENCY_SYMBOLS[symbolMatch[0]] || 'USD' : undefined;

  // Strip everything except digits, dots, and commas
  const numeric = trimmed.replace(/[^0-9.,]/g, '');
  if (!numeric) return null;

  // Detect Latin American thousands separator: "$1.000" or "$12.500"
  // Pattern: digits, then one or more groups of .NNN — with no trailing decimal portion
  // When "$" is used with this format, assume CLP (not USD)
  const latAmMatch = numeric.match(/^(\d{1,3}(?:\.\d{3})+)$/);
  if (latAmMatch) {
    const value = parseFloat(latAmMatch[1].replace(/\./g, ''));
    const latAmCurrency = currency === 'USD' ? 'CLP' : (currency || 'CLP');
    if (value > 0) return { price: value, currency: latAmCurrency };
  }

  // Standard: "25", "25.00", "1,000.50"
  const normalized = numeric.replace(/,/g, '');
  const value = parseFloat(normalized);
  if (!isNaN(value) && value > 0) return { price: value, currency: currency || 'USD' };

  return null;
}

// --- Sport mapping ---

const TAG_SPORT_MAP: Record<string, string> = {
  gravel: 'Gravel Cycling',
  triathlon: 'Triathlon',
  duathlon: 'Duathlon',
  bikepacking: 'Bikepacking',
};

function sportFromTags(tags: string[]): string {
  for (const tag of tags) {
    if (TAG_SPORT_MAP[tag]) return TAG_SPORT_MAP[tag];
  }
  return 'Cycling';
}

// --- Existing functions ---

export function routeJsonLd(
  route: { name: string; tagline?: string; distance_km: number; id: string; created_at: string; updated_at: string },
  coverUrl?: string,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: route.name,
    description: route.tagline || `${route.name} — ${route.distance_km}km cycling route in ${config.name}`,
    url: `${config.url}/routes/${route.id}`,
    datePublished: route.created_at,
    dateModified: route.updated_at,
    author: AUTHOR,
    ...(coverUrl && { image: [coverUrl] }),
  };
}

export function eventJsonLd(event: {
  name: string;
  start_date: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  location?: string;
  registration_url?: string;
  organizer_name?: string;
  organizer_url?: string;
  poster_key?: string;
  description?: string;
  tags?: string[];
  isPast?: boolean;
  price?: string;
}) {
  const startDate = event.start_time
    ? `${event.start_date}T${event.start_time}`
    : event.start_date;
  const endDate = event.end_time && event.end_date
    ? `${event.end_date}T${event.end_time}`
    : event.end_date;

  // Build offers when there's a registration URL
  let offers: Record<string, string | number> | undefined;
  if (event.registration_url) {
    const availability = event.isPast
      ? 'https://schema.org/SoldOut'
      : 'https://schema.org/InStock';
    const parsed = event.price ? parsePrice(event.price) : null;
    offers = {
      '@type': 'Offer',
      url: event.registration_url,
      availability,
      ...(parsed
        ? { price: parsed.price, priceCurrency: parsed.currency }
        : event.price ? { description: event.price } : {}),
    };
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.name,
    startDate,
    ...(endDate && { endDate }),
    ...(event.description && { description: event.description }),
    ...(event.location && { location: { '@type': 'Place', name: event.location } }),
    ...(event.registration_url && { url: event.registration_url }),
    ...(event.organizer_name && {
      organizer: {
        '@type': 'Organization',
        name: event.organizer_name,
        ...(event.organizer_url && { url: event.organizer_url }),
      },
    }),
    ...(event.poster_key && { image: originalUrl(event.poster_key) }),
    ...(offers && { offers }),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: event.isPast
      ? 'https://schema.org/EventCompleted'
      : 'https://schema.org/EventScheduled',
    sport: sportFromTags(event.tags || []),
  };
}

export function guideJsonLd(guide: { name: string; tagline?: string; id: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.name,
    ...(guide.tagline && { description: guide.tagline }),
    url: `${config.url}/guides/${guide.id}`,
    publisher: { '@type': 'Organization', name: config.display_name },
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

// --- New functions ---

export function rideJsonLd(ride: {
  name: string;
  description?: string;
  ride_date?: string;
  id: string;
  coverUrl?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: ride.name,
    ...(ride.description && { description: ride.description }),
    url: `${config.url}/rides/${ride.id}`,
    ...(ride.ride_date && { datePublished: ride.ride_date }),
    author: AUTHOR,
    ...(ride.coverUrl && { image: [ride.coverUrl] }),
  };
}

export function touristAttractionJsonLd(attraction: {
  name: string;
  description?: string;
  imageUrl?: string;
  url: string;
  startLat?: number;
  startLng?: number;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: attraction.name,
    ...(attraction.description && { description: attraction.description }),
    ...(attraction.imageUrl && { image: attraction.imageUrl }),
    url: attraction.url,
    ...(attraction.startLat != null && attraction.startLng != null && {
      geo: {
        '@type': 'GeoCoordinates',
        latitude: attraction.startLat,
        longitude: attraction.startLng,
      },
    }),
    touristType: 'Cyclist',
    isAccessibleForFree: true,
  };
}

export function routeMapJsonLd(map: {
  name: string;
  description?: string;
  imageUrl?: string;
  url: string;
  geoLine?: string;
  containsPlaces?: Array<{ name: string; lat: number; lng: number; category?: string }>;
  distance?: string;
  elevationGain?: string;
  routeShape?: string;
}) {
  const additionalProperty: Array<Record<string, string>> = [];
  if (map.distance) {
    additionalProperty.push({ '@type': 'PropertyValue', name: 'distance', value: map.distance });
  }
  if (map.elevationGain) {
    additionalProperty.push({ '@type': 'PropertyValue', name: 'elevationGain', value: map.elevationGain });
  }
  if (map.routeShape) {
    additionalProperty.push({ '@type': 'PropertyValue', name: 'routeShape', value: map.routeShape });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: map.name,
    ...(map.description && { description: map.description }),
    ...(map.imageUrl && { image: map.imageUrl }),
    url: map.url,
    ...(map.geoLine && {
      geo: {
        '@type': 'GeoShape',
        line: map.geoLine,
      },
    }),
    ...(map.containsPlaces && map.containsPlaces.length > 0 && {
      containsPlace: map.containsPlaces.map(p => ({
        '@type': 'Place',
        name: p.name,
        geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng },
        ...(p.category && { additionalType: p.category }),
      })),
    }),
    ...(additionalProperty.length > 0 && { additionalProperty }),
    touristType: 'Cyclist',
    isAccessibleForFree: true,
  };
}

/** Convert a duration string (seconds like "32", or "mm:ss" like "1:30") to ISO 8601 (PT…). */
function formatIsoDuration(raw: string): string {
  const totalSeconds = raw.includes(':')
    ? raw.split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
    : Number(raw);
  if (!totalSeconds || isNaN(totalSeconds)) return `PT0S`;
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return m > 0 ? `PT${m}M${s}S` : `PT${s}S`;
}

export function videoJsonLd(video: {
  title: string;
  description: string;
  handle: string;
  posterUrl: string;
  contentUrl: string;
  duration?: string;
  width?: number;
  height?: number;
  uploadDate?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: video.description,
    thumbnailUrl: video.posterUrl,
    contentUrl: video.contentUrl,
    url: `${config.url}/videos/${video.handle}`,
    ...(video.duration && { duration: formatIsoDuration(video.duration) }),
    ...(video.width && video.height && {
      width: video.width,
      height: video.height,
    }),
    ...(video.uploadDate && { uploadDate: video.uploadDate }),
    author: AUTHOR,
  };
}

export function webPageJsonLd(page: {
  name: string;
  description: string;
  url: string;
  aboutName: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.name,
    description: page.description,
    url: page.url,
    about: {
      '@type': 'City',
      name: page.aboutName,
    },
  };
}
