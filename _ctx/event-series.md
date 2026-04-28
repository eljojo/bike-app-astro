---
description: Event series schema (recurrence vs explicit schedule), expander, and ICS UID dedupe
type: knowledge
triggers: [editing event schemas, series expansion, calendar suggestion dedupe, ICS feed work, Tockify import flow, ics_uid handling]
related: [content-model, domain-model]
---

# Event Series

## Schema

Defined in `src/lib/models/event-model.ts`. The series block on an `EventDetail` is one of two shapes — never both at once. The Zod refinement enforces it: `(recurrence && recurrence_day && season_start && season_end) || schedule?.length`.

**Pattern 1 — recurrence rule.** `recurrence` (`weekly` | `biweekly`), `recurrence_day` (lowercase day name), `season_start`, `season_end`, optional `skip_dates[]`, optional `overrides[]` keyed by date.

**Pattern 2 — explicit schedule.** `schedule[]` — an ordered list of dates. Used when occurrences don't follow a clean cadence or when the future dates are known rather than generated.

Both patterns share the same per-occurrence shape, `seriesOccurrenceOverrideSchema`:

```
date, location, start_time, meet_time, note, cancelled, rescheduled_from,
uid, event_url, map_url, registration_url
```

There is no per-occurrence `poster_key`. The top-level event poster is the only one.

## Expansion

`expandSeriesOccurrences()` in `src/lib/series-utils.ts` projects either pattern into a flat `SeriesOccurrence[]` sorted by date. Per-occurrence values fall back to top-level event fields (`override.location ?? event.location`, etc.) — only set them in the override/schedule entry when they actually differ.

`uid` is on the schema but *not* surfaced into `SeriesOccurrence` — it's metadata for the import/dedupe pipeline, not for rendering. `map_url` *is* surfaced; the per-occurrence rwgps URL appears as a 🗺️ link on each occurrence row alongside `event_url` and `registration_url`.

## ICS UID Layers

- **Top-level `ics_uid`** on `EventDetail` is the series anchor exposed in the calendar feed. By convention, it mirrors the first occurrence's `uid` so a single-event import becomes the series anchor when more dates are added.
- **Per-occurrence `uid`** matches the source VEVENT (Tockify `TKF/...`, OBC `https://obcrides.ca/events/N`, Google Calendar `@google.com`). `src/lib/calendar-suggestions/prefill.ts` matches incoming feed UIDs against `series.overrides[].uid` (and `schedule[]`) to dedupe — keep these stable when editing.

See `~/code/bike-app/docs/plans/2026-04-28-implicit-series-detection-design.md` for how implicit series get detected from raw VEVENT streams.

## Editing Patterns

When merging duplicate event files in the bike-routes content repo:

- Top-level `ics_uid` and `start_date` come from the canonical (un-suffixed) file.
- Top-level `end_date` becomes the last occurrence date.
- Each merged file's `uid` becomes one `schedule[]` entry's `uid`.
- Tockify URLs are signup pages — they go in `registration_url`, not `event_url`.
- See `~/code/bike-routes/_ctx/events.md` for the data-side conventions.
