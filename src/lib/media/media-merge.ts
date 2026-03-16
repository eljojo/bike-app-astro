export interface ParkedPhotoEntry {
  key: string;
  lat?: number;
  lng?: number;
  caption?: string;
  width?: number;
  height?: number;
  uploaded_by?: string;
  captured_at?: string;
}

/** Convert a media item (or similar shape) to a ParkedPhotoEntry. */
export function toParkedEntry(photo: {
  key: string;
  lat?: number;
  lng?: number;
  caption?: string;
  width?: number;
  height?: number;
  uploaded_by?: string;
  captured_at?: string;
}): ParkedPhotoEntry {
  return {
    key: photo.key,
    ...(photo.lat != null && { lat: photo.lat }),
    ...(photo.lng != null && { lng: photo.lng }),
    ...(photo.caption != null && { caption: photo.caption }),
    ...(photo.width != null && { width: photo.width }),
    ...(photo.height != null && { height: photo.height }),
    ...(photo.uploaded_by != null && { uploaded_by: photo.uploaded_by }),
    ...(photo.captured_at != null && { captured_at: photo.captured_at }),
  };
}

/**
 * Merge parking changes into the existing parked-photos.yml entries.
 * - Appends newly parked photos
 * - Removes un-parked photos (added back to a route)
 * - Deduplicates by key
 */
export function mergeParkedPhotos(
  existing: ParkedPhotoEntry[],
  toAdd: ParkedPhotoEntry[],
  toRemove: Set<string>,
): ParkedPhotoEntry[] {
  const result = existing.filter(p => !toRemove.has(p.key));
  for (const photo of toAdd) {
    if (!result.some(p => p.key === photo.key)) {
      result.push(photo);
    }
  }
  return result;
}

interface AdminMediaInput {
  key: string;
  type?: 'photo' | 'video';
  caption?: string;
  cover?: boolean;
  width?: number;
  height?: number;
  lat?: number;
  lng?: number;
  uploaded_by?: string;
  captured_at?: string;
  title?: string;
  handle?: string;
  duration?: string;
  orientation?: string;
  poster_key?: string;
}

type MediaEntry = Record<string, unknown>;

/**
 * Merge admin media changes into existing media.yml entries.
 *
 * - Preserves all fields on existing entries (score, width, height, handle, etc.)
 * - Overlays admin-editable fields (caption, cover for photos; title for videos)
 * - Admin array drives ordering for all media types
 * - New photos get type: "photo" and score: 1
 * - New videos get type: "video" and admin-supplied fields
 * - Media removed by admin (not in adminMedia) are dropped
 */
export function mergeMedia(adminMedia: AdminMediaInput[], existing: MediaEntry[]): MediaEntry[] {
  const lookup = new Map<string, MediaEntry>();
  for (const entry of existing) {
    lookup.set(entry.key as string, entry);
  }

  const result: MediaEntry[] = [];

  for (const item of adminMedia) {
    const isVideo = item.type === 'video';
    const base = lookup.get(item.key);
    if (base) {
      // Existing entry — preserve all fields, overlay admin changes
      const merged = { ...base };
      if (isVideo) {
        if (item.title != null) merged.title = item.title;
      } else {
        if (item.caption != null) merged.caption = item.caption;
        else delete merged.caption;
      }
      if (item.cover) merged.cover = true;
      else delete merged.cover;
      result.push(merged);
    } else if (isVideo) {
      // New video
      const entry: MediaEntry = { type: 'video', key: item.key };
      if (item.title) entry.title = item.title;
      if (item.handle) entry.handle = item.handle;
      if (item.duration) entry.duration = item.duration;
      if (item.width) entry.width = item.width;
      if (item.height) entry.height = item.height;
      if (item.orientation) entry.orientation = item.orientation;
      if (item.poster_key) entry.poster_key = item.poster_key;
      if (item.lat != null) entry.lat = item.lat;
      if (item.lng != null) entry.lng = item.lng;
      if (item.captured_at) entry.captured_at = item.captured_at;
      result.push(entry);
    } else {
      // New photo
      const entry: MediaEntry = { type: 'photo', key: item.key };
      if (item.caption) entry.caption = item.caption;
      if (item.cover) entry.cover = true;
      entry.score = 1;
      if (item.width) entry.width = item.width;
      if (item.height) entry.height = item.height;
      if (item.lat != null) entry.lat = item.lat;
      if (item.lng != null) entry.lng = item.lng;
      if (item.uploaded_by) entry.uploaded_by = item.uploaded_by;
      if (item.captured_at) entry.captured_at = item.captured_at;
      result.push(entry);
    }
  }

  return result;
}
