interface VideoJobRow {
  key: string;
  width?: number | null;
  height?: number | null;
  duration?: string | null;
  orientation?: string | null;
  lat?: number | null;
  lng?: number | null;
  capturedAt?: string | null;
}

interface VideoMetadataFields {
  width?: number;
  height?: number;
  duration?: string;
  orientation?: string;
  lat?: number;
  lng?: number;
  captured_at?: string;
}

/** Extract media-compatible metadata fields from a videoJobs row. */
export function buildVideoMetadata(row: VideoJobRow): VideoMetadataFields {
  const result: VideoMetadataFields = {};
  if (row.width != null) result.width = row.width;
  if (row.height != null) result.height = row.height;
  if (row.duration != null) result.duration = row.duration;
  if (row.orientation != null) result.orientation = row.orientation;
  if (row.lat != null) result.lat = row.lat;
  if (row.lng != null) result.lng = row.lng;
  if (row.capturedAt != null) result.captured_at = row.capturedAt;
  return result;
}

/** Enrich media items with metadata from ready videoJobs rows. Returns a new array. */
export function enrichMediaWithVideoJobs<T extends { key: string; type?: string }>(
  media: T[],
  jobs: Array<{ key: string; status: string } & VideoJobRow>,
): T[] {
  const readyJobs = new Map(
    jobs.filter(j => j.status === 'ready').map(j => [j.key, j]),
  );
  if (readyJobs.size === 0) return media;

  return media.map(item => {
    if (item.type !== 'video') return item;
    const job = readyJobs.get(item.key);
    if (!job) return item;
    return { ...item, ...buildVideoMetadata(job) };
  });
}
