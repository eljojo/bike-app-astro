export interface PhotoUsage {
  type: 'route' | 'place' | 'event' | 'parked';
  slug: string;
}

export type SharedKeysMap = Map<string, PhotoUsage[]>;

export function updateSharedKeys(
  map: SharedKeysMap,
  key: string,
  usage: PhotoUsage,
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
