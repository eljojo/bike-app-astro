import type {
  ParsedVEvent,
  ParsedSeriesOverride,
  UpdateDiff,
  AddedOccurrence,
  FieldDiff,
} from './types';

export const MONITORED_MASTER_FIELDS = [
  'start', 'end', 'summary', 'location',
  'url', 'registration_url', 'map_url',
] as const;

export const MONITORED_OCCURRENCE_FIELDS = [
  'start_time', 'location', 'cancelled',
  'event_url', 'registration_url', 'map_url',
] as const;


function freshEmpty(): UpdateDiff {
  return {
    master: [],
    occurrencesChanged: [],
    occurrencesAdded: [],
    occurrencesNewlyCancelled: [],
    occurrencesRemoved: [],
  };
}

export function diffMonitored(
  repo: ParsedVEvent | null,
  snapshot: ParsedVEvent | null,
  upstream: ParsedVEvent | null,
  todayLocalDate: string,
): UpdateDiff {
  // Bootstrap path: no snapshot, just upstream → caller is responsible for writing the snapshot.
  if (!snapshot) return freshEmpty();

  // Whole-event removal.
  if (!upstream) {
    const startDate = snapshot.start.slice(0, 10);
    if (startDate < todayLocalDate) return freshEmpty();
    return { ...freshEmpty(), eventRemoved: true };
  }

  const out: UpdateDiff = {
    master: diffMasterFields(repo, snapshot, upstream),
    occurrencesChanged: [],
    occurrencesAdded: [],
    occurrencesNewlyCancelled: [],
    occurrencesRemoved: [],
  };

  diffOccurrences(repo, snapshot, upstream, todayLocalDate, out);
  return out;
}

function diffMasterFields(repo: ParsedVEvent | null, snap: ParsedVEvent, up: ParsedVEvent): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of MONITORED_MASTER_FIELDS) {
    const snapVal = snap[field];
    const upVal = up[field];
    const repoVal = repo ? repo[field] : undefined;
    // Tolerant: undefined-on-snapshot means "no opinion" (no diff surfaced).
    if (snapVal === undefined) continue;
    if (snapVal === upVal) continue;
    diffs.push({ field, mine: stringify(repoVal), upstream: stringify(upVal) });
  }
  return diffs;
}

function diffOccurrences(
  repo: ParsedVEvent | null,
  snap: ParsedVEvent,
  up: ParsedVEvent,
  todayLocalDate: string,
  out: UpdateDiff,
): void {
  const snapOverrides = snap.series?.overrides ?? [];
  const upOverrides = up.series?.overrides ?? [];
  const repoOverrides = repo?.series?.overrides ?? [];

  const snapByUid = new Map<string, ParsedSeriesOverride>();
  for (const o of snapOverrides) if (o.uid) snapByUid.set(o.uid, o);
  const upByUid = new Map<string, ParsedSeriesOverride>();
  for (const o of upOverrides)   if (o.uid) upByUid.set(o.uid, o);
  const repoByUid = new Map<string, ParsedSeriesOverride>();
  for (const o of repoOverrides) if (o.uid) repoByUid.set(o.uid, o);

  // Changed (uid in both).
  for (const [uid, snapO] of snapByUid) {
    const upO = upByUid.get(uid);
    if (!upO) continue;
    const repoO = repoByUid.get(uid);
    const fields: FieldDiff[] = [];
    let cancelledFlippedOn = false;
    for (const field of MONITORED_OCCURRENCE_FIELDS) {
      const a = snapO[field];
      const b = upO[field];
      // Special case: cancelled flipping from undefined/false → true is always detected,
      // even when the snapshot has no opinion set (undefined).
      if (field === 'cancelled' && !a && b === true) {
        cancelledFlippedOn = true;
        continue;
      }
      if (a === undefined) continue;
      if (a === b) continue;
      const repoVal = repoO ? repoO[field] : undefined;
      fields.push({ field, mine: stringify(repoVal), upstream: stringify(b) });
    }
    if (cancelledFlippedOn) {
      out.occurrencesNewlyCancelled.push({ uid, date: upO.date, fields });
    } else if (fields.length > 0) {
      out.occurrencesChanged.push({ uid, date: upO.date, fields });
    }
  }

  // Added (uid in upstream only) — filter past dates.
  for (const [uid, upO] of upByUid) {
    if (snapByUid.has(uid)) continue;
    if (upO.date < todayLocalDate) continue;
    // upO is from upByUid which is keyed by uid, so uid is always truthy here.
    out.occurrencesAdded.push(upO as AddedOccurrence);
  }

  // Removed (uid in snapshot only) — filter past dates.
  for (const [uid, snapO] of snapByUid) {
    if (upByUid.has(uid)) continue;
    if (snapO.date < todayLocalDate) continue;
    out.occurrencesRemoved.push({ uid, date: snapO.date });
  }
}

function stringify(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  return String(v);
}
