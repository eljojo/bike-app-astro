interface AdminPhoto {
  key: string;
  caption?: string;
  cover?: boolean;
  width?: number;
  height?: number;
  lat?: number;
  lng?: number;
  uploaded_by?: string;
  captured_at?: string;
}

type MediaEntry = Record<string, unknown>;

/**
 * Merge admin photo changes into existing media.yml entries.
 *
 * - Preserves all fields on existing entries (score, width, height, handle, etc.)
 * - Overlays caption and cover from admin
 * - Preserves admin's photo ordering
 * - New photos get type: "photo" and score: 1
 * - Non-photo entries (videos) are appended at the end unchanged
 * - Photos removed by admin (not in adminPhotos) are dropped
 */
export function mergeMedia(adminPhotos: AdminPhoto[], existing: MediaEntry[]): MediaEntry[] {
  const lookup = new Map<string, MediaEntry>();
  const nonPhotos: MediaEntry[] = [];

  // TODO(C7): merge all media types when video management is added to admin UI
  for (const entry of existing) {
    if (entry.type === 'photo') {
      lookup.set(entry.key as string, entry);
    } else {
      nonPhotos.push(entry);
    }
  }

  const result: MediaEntry[] = [];

  for (const photo of adminPhotos) {
    const base = lookup.get(photo.key);
    if (base) {
      // Existing photo — preserve all fields, overlay admin changes
      const merged = { ...base };
      if (photo.caption != null) merged.caption = photo.caption;
      else delete merged.caption;
      if (photo.cover) merged.cover = true;
      else delete merged.cover;
      result.push(merged);
    } else {
      // New photo
      const entry: MediaEntry = { type: 'photo', key: photo.key };
      if (photo.caption) entry.caption = photo.caption;
      if (photo.cover) entry.cover = true;
      entry.score = 1;
      if (photo.width) entry.width = photo.width;
      if (photo.height) entry.height = photo.height;
      if (photo.lat != null) entry.lat = photo.lat;
      if (photo.lng != null) entry.lng = photo.lng;
      if (photo.uploaded_by) entry.uploaded_by = photo.uploaded_by;
      if (photo.captured_at) entry.captured_at = photo.captured_at;
      result.push(entry);
    }
  }

  // Append non-photo entries (videos etc.) unchanged
  result.push(...nonPhotos);

  return result;
}
