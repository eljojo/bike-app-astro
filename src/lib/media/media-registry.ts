export interface MediaUsage {
  type: 'route' | 'place' | 'event' | 'organizer' | 'parked';
  slug: string;
}

export type SharedKeysMap = Map<string, MediaUsage[]>;

export function updateSharedKeys(
  map: SharedKeysMap,
  key: string,
  usage: MediaUsage,
  action: 'add' | 'remove',
): void {
  if (action === 'add') {
    const existing = map.get(key) || [];
    const alreadyExists = existing.some(u => u.type === usage.type && u.slug === usage.slug);
    if (!alreadyExists) {
      existing.push(usage);
      map.set(key, existing);
    }
  } else {
    const existing = map.get(key);
    if (!existing) return;
    const filtered = existing.filter(u => !(u.type === usage.type && u.slug === usage.slug));
    if (filtered.length === 0) {
      map.delete(key);
    } else {
      map.set(key, filtered);
    }
  }
}

interface RouteMediaData {
  media: Array<{ key: string }>;
}

interface PlacePhotoData {
  slug: string;
  photo_key?: string;
}

interface EventPosterData {
  slug: string;
  poster_key?: string;
}

interface ParkedPhotoData {
  key: string;
}

export function buildSharedKeysMap(
  routeData: Record<string, RouteMediaData>,
  places: PlacePhotoData[],
  events: EventPosterData[],
  parkedPhotos: ParkedPhotoData[],
): SharedKeysMap {
  const map: SharedKeysMap = new Map();

  for (const [slug, route] of Object.entries(routeData)) {
    for (const item of route.media) {
      updateSharedKeys(map, item.key, { type: 'route', slug }, 'add');
    }
  }

  for (const place of places) {
    if (place.photo_key) {
      updateSharedKeys(map, place.photo_key, { type: 'place', slug: place.slug }, 'add');
    }
  }

  for (const event of events) {
    if (event.poster_key) {
      updateSharedKeys(map, event.poster_key, { type: 'event', slug: event.slug }, 'add');
    }
  }

  for (const parked of parkedPhotos) {
    updateSharedKeys(map, parked.key, { type: 'parked', slug: '__global' }, 'add');
  }

  // Prune single-use keys — only keep multi-referenced
  for (const [key, usages] of map) {
    if (usages.length < 2) map.delete(key);
  }

  return map;
}

export function getMediaUsages(map: SharedKeysMap, key: string): MediaUsage[] {
  return map.get(key) || [];
}

export function serializeSharedKeys(map: SharedKeysMap): string {
  const obj: Record<string, MediaUsage[]> = {};
  for (const [key, usages] of map) {
    obj[key] = usages;
  }
  return JSON.stringify(obj);
}

export function deserializeSharedKeys(json: string): SharedKeysMap {
  const obj = JSON.parse(json) as Record<string, MediaUsage[]>;
  return new Map(Object.entries(obj));
}
