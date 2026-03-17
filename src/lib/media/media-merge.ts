export interface ParkedMediaEntry {
  key: string;
  lat?: number;
  lng?: number;
  caption?: string;
  width?: number;
  height?: number;
  uploaded_by?: string;
  captured_at?: string;
  type?: 'photo' | 'video';
  handle?: string;
  duration?: string;
  orientation?: string;
  title?: string;
}

/** Convert a media item (or similar shape) to a ParkedMediaEntry. */
export function toParkedEntry(item: {
  key: string;
  lat?: number;
  lng?: number;
  caption?: string;
  width?: number;
  height?: number;
  uploaded_by?: string;
  captured_at?: string;
  type?: 'photo' | 'video';
  handle?: string;
  duration?: string;
  orientation?: string;
  title?: string;
}): ParkedMediaEntry {
  return {
    key: item.key,
    ...(item.lat != null && { lat: item.lat }),
    ...(item.lng != null && { lng: item.lng }),
    ...(item.caption != null && { caption: item.caption }),
    ...(item.width != null && { width: item.width }),
    ...(item.height != null && { height: item.height }),
    ...(item.uploaded_by != null && { uploaded_by: item.uploaded_by }),
    ...(item.captured_at != null && { captured_at: item.captured_at }),
    ...(item.type != null && { type: item.type }),
    ...(item.title != null && { title: item.title }),
    ...(item.handle != null && { handle: item.handle }),
    ...(item.duration != null && { duration: item.duration }),
    ...(item.orientation != null && { orientation: item.orientation }),
  };
}

/**
 * Merge parking changes into the existing parked-media.yml entries.
 * - Appends newly parked media
 * - Removes un-parked media (added back to a route)
 * - Deduplicates by key
 */
export function mergeParkedMedia(
  existing: ParkedMediaEntry[],
  toAdd: ParkedMediaEntry[],
  toRemove: Set<string>,
): ParkedMediaEntry[] {
  const result = existing.filter(p => !toRemove.has(p.key));
  for (const item of toAdd) {
    if (!result.some(p => p.key === item.key)) {
      result.push(item);
    }
  }
  return result;
}

interface AdminMediaInput {
  key: string;
  type?: 'photo' | 'video';
  handle?: string;
  duration?: string;
  orientation?: string;
  caption?: string;
  cover?: boolean;
  width?: number;
  height?: number;
  lat?: number;
  lng?: number;
  uploaded_by?: string;
  captured_at?: string;
  title?: string;
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
