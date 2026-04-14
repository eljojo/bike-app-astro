// scripts/pipeline/engine/trace.ts
//
// Per-subject decision trace for the bikepaths pipeline.
//
// Phases call ctx.trace(subjectId, kind, data?) at decision points.
// The Trace object accumulates events keyed by subject; at end of run
// the dump is written to .pipeline-debug/trace.json. A CLI loads it
// and prints a readable timeline for any subject.
//
// See docs/plans/2026-04-09-pipeline-tracing-refactor-design.md.

import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs';

export interface TraceEvent {
  phase: string;
  /** ms since trace creation */
  t: number;
  kind: string;
  data?: Record<string, any>;
}

interface SubjectData {
  displayName?: string;
  events: TraceEvent[];
}

interface PhaseSummary {
  name: string;
  ms: number;
  subjectsTouched: number;
}

interface TraceDump {
  city?: string;
  ranAt: string;
  phases: PhaseSummary[];
  subjects: Record<string, SubjectData>;
}

export class Trace {
  enabled: boolean;
  city?: string;
  startedAt: string;
  private startMs: number;
  private _subjects: Map<string, SubjectData>;
  private _phaseSummaries: PhaseSummary[];

  constructor({ enabled = true, city }: { enabled?: boolean; city?: string } = {}) {
    this.enabled = enabled;
    this.city = city;
    this.startedAt = new Date().toISOString();
    this.startMs = performance.now();
    this._subjects = new Map();
    this._phaseSummaries = [];
  }

  /**
   * Bind the trace to a phase name. Returns a function the phase can call:
   *   trace('way:123', 'filtered', { reason: '...' });
   */
  bind(phaseName: string): (subjectId: string, kind: string, data?: Record<string, any>) => void {
    if (!this.enabled) {
      return () => {};
    }
    return (subjectId, kind, data) => {
      this._record(phaseName, subjectId, kind, data);
    };
  }

  private _record(phaseName: string, subjectId: string, kind: string, data?: Record<string, any>): void {
    if (!this._subjects.has(subjectId)) {
      this._subjects.set(subjectId, { events: [] });
    }
    const t = performance.now() - this.startMs;
    const event: TraceEvent = { phase: phaseName, t, kind };
    if (data !== undefined) event.data = data;
    this._subjects.get(subjectId)!.events.push(event);
  }

  /**
   * Set or update the human-readable display name for a subject.
   */
  name(subjectId: string, displayName: string): void {
    if (!this.enabled) return;
    if (!this._subjects.has(subjectId)) {
      this._subjects.set(subjectId, { events: [] });
    }
    this._subjects.get(subjectId)!.displayName = displayName;
  }

  /**
   * Record a phase summary (called by the runner's onEvent hook).
   */
  recordPhaseSummary(name: string, ms: number): void {
    if (!this.enabled) return;
    let touched = 0;
    for (const s of this._subjects.values()) {
      if (s.events.some((e) => e.phase === name)) touched++;
    }
    this._phaseSummaries.push({ name, ms, subjectsTouched: touched });
  }

  /**
   * Get all events for a subject, plus convenience methods.
   * Always returns an object even if the subject is unknown.
   */
  subject(id: string): {
    displayName?: string;
    events: TraceEvent[];
    kinds(): string[];
    lastEvent(): TraceEvent | undefined;
  } {
    const data = this._subjects.get(id) || { events: [] };
    return {
      displayName: data.displayName,
      events: data.events.slice(),
      kinds() {
        const seen = new Set<string>();
        const list: string[] = [];
        for (const e of data.events) {
          if (!seen.has(e.kind)) {
            seen.add(e.kind);
            list.push(e.kind);
          }
        }
        return list;
      },
      lastEvent() {
        return data.events[data.events.length - 1];
      },
    };
  }

  /**
   * Cross-subject filter. Returns flat array of events with subject id attached.
   */
  filter({ phase, kind }: { phase?: string; kind?: string } = {}): Array<TraceEvent & { subject: string }> {
    const out: Array<TraceEvent & { subject: string }> = [];
    for (const [subject, data] of this._subjects) {
      for (const event of data.events) {
        if (phase && event.phase !== phase) continue;
        if (kind && event.kind !== kind) continue;
        out.push({ subject, ...event });
      }
    }
    return out;
  }

  /**
   * Returns the JSON-serialisable representation.
   */
  dump(): TraceDump {
    const subjects: Record<string, SubjectData> = {};
    for (const [id, data] of this._subjects) {
      subjects[id] = {
        ...(data.displayName ? { displayName: data.displayName } : {}),
        events: data.events,
      };
    }
    return {
      city: this.city,
      ranAt: this.startedAt,
      phases: this._phaseSummaries,
      subjects,
    };
  }

  /**
   * Atomic write to disk.
   */
  saveTo(filePath: string): void {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash !== -1) fs.mkdirSync(filePath.slice(0, lastSlash), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.dump()));
    fs.renameSync(tmp, filePath);
  }

  /**
   * Load a previously saved trace from disk.
   */
  static load(filePath: string): Trace {
    const raw: TraceDump = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const trace = new Trace({ enabled: true, city: raw.city });
    trace.startedAt = raw.ranAt;
    trace._phaseSummaries = raw.phases || [];
    for (const [id, data] of Object.entries(raw.subjects || {})) {
      trace._subjects.set(id, {
        displayName: data.displayName,
        events: data.events || [],
      });
    }
    return trace;
  }
}
