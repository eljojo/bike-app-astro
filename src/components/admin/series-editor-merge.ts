import type { SeriesOccurrenceOverride } from '../../lib/models/event-model';

interface OverridePatch {
  date?: string;
  location?: string;
  note?: string;
}

/**
 * Merge a SeriesEditor popover patch onto an existing override row, preserving
 * every field on `existing` (uid, event_url, registration_url, start_time,
 * meet_time, rescheduled_from, cancelled, …). The popover only edits location
 * and note; rebuilding the row from scratch with just those two fields wipes
 * the per-occurrence dedupe data the parser put on imported clusters.
 *
 * An empty-string `location`/`note` in the patch clears that field; absent
 * keys leave the existing value alone.
 */
export function mergeOverrideForPopover(
  existing: SeriesOccurrenceOverride | undefined,
  patch: OverridePatch,
): SeriesOccurrenceOverride {
  const date = patch.date ?? existing?.date;
  if (!date) throw new Error('mergeOverrideForPopover: date is required');
  const merged: SeriesOccurrenceOverride = { ...existing, date };
  if ('location' in patch) {
    if (patch.location) merged.location = patch.location;
    else delete merged.location;
  }
  if ('note' in patch) {
    if (patch.note) merged.note = patch.note;
    else delete merged.note;
  }
  return merged;
}
