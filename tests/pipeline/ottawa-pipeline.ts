/**
 * Shared pipeline-in-memory helper for Ottawa regression tests.
 *
 * Runs the bikepaths pipeline once per process with the production
 * queryOverpass client (which transparently uses the content-addressed
 * cache under `.cache/overpass/`). The result is memoized — multiple
 * test files in the same worker share a single pipeline run.
 *
 * Tests use this instead of reading the generated `bikepaths.yml` so they
 * exercise the pipeline logic directly and catch regressions in how the
 * script produces Ottawa output.
 */
import { queryOverpass } from '../../scripts/pipeline/lib/overpass.ts';
import { buildBikepathsPipeline } from '../../scripts/pipeline/build-bikepaths.ts';
import { loadCityAdapter } from '../../scripts/pipeline/lib/city-adapter.mjs';
import type { Trace } from '../../scripts/pipeline/engine/trace.ts';

/** Ottawa bounding box — matches scripts/pipeline/bikepaths-yml-integrity.test.mjs. */
const OTTAWA_BBOX = '45.15,-76.35,45.65,-75.35';

export interface OttawaPipelineResult {
  entries: any[];
  /** Lookup by final slug. Only entries with a slug are included. */
  bySlug: Map<string, any>;
  /** Lookup by entry name. */
  byName: Map<string, any>;
  /** Full pipeline trace — use `traceTimeline(trace, entry.name)` for diagnostics. */
  trace: Trace;
}

let cached: Promise<OttawaPipelineResult> | null = null;

/**
 * Run (or return the memoized result of) the full bikepaths pipeline for
 * Ottawa. Hits `.cache/overpass/` for OSM data — falls through to live
 * Overpass on cache miss.
 *
 * Memoized per process. Tests that run in the same vitest worker share a
 * single pipeline run; across workers, the disk-level Overpass cache keeps
 * re-runs fast.
 */
export function loadOttawaPipelineResult(): Promise<OttawaPipelineResult> {
  if (!cached) cached = runPipeline();
  return cached;
}

async function runPipeline(): Promise<OttawaPipelineResult> {
  const adapter = loadCityAdapter('ottawa');
  const result = await buildBikepathsPipeline({
    queryOverpass,
    bbox: OTTAWA_BBOX,
    adapter,
    manualEntries: [],
  });
  const entries = result.entries;
  const bySlug = new Map<string, any>(
    entries.filter(e => e.slug).map(e => [e.slug, e]),
  );
  const byName = new Map<string, any>(
    entries.filter(e => e.name).map(e => [e.name, e]),
  );
  return { entries, bySlug, byName, trace: result.trace };
}

/**
 * Render a trace timeline for an entry as a multiline string — drop this
 * into a vitest assertion message to get "which phase made which decision"
 * context on regression failures.
 *
 * Example:
 *   expect(e.type, `fatbike-mont-tremblant.type\n${traceTimeline(trace, e.name)}`)
 *     .toBe('destination');
 *
 * On failure, the error message includes the full decision history for
 * this entry, pinpointing the phase that produced the wrong value.
 */
export function traceTimeline(trace: Trace, entryName: string): string {
  const events = trace.subject(`entry:${entryName}`).events;
  if (events.length === 0) return '  (no trace events recorded for this entry)';
  return events
    .map(ev => {
      const data = ev.data ? ' ' + JSON.stringify(ev.data) : '';
      return `  [${ev.phase}] ${ev.kind}${data}`;
    })
    .join('\n');
}
