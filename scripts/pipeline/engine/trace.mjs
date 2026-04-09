// scripts/pipeline/engine/trace.mjs
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

/**
 * @typedef {{
 *   phase: string,
 *   t: number,         // ms since trace creation
 *   kind: string,
 *   data?: object,
 * }} TraceEvent
 */

export class Trace {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.enabled=true] when false, trace calls are no-ops
   * @param {string} [opts.city]
   */
  constructor({ enabled = true, city } = {}) {
    this.enabled = enabled;
    this.city = city;
    this.startedAt = new Date().toISOString();
    this.startMs = performance.now();
    /** @type {Map<string, {displayName?: string, events: TraceEvent[]}>} */
    this._subjects = new Map();
    /** @type {Array<{name: string, ms: number, subjectsTouched: number}>} */
    this._phaseSummaries = [];
  }

  /**
   * Bind the trace to a phase name. Returns a function the phase can call:
   *   const trace = ctx.trace; // already bound by the runner
   *   trace('way:123', 'filtered', { reason: '...' });
   */
  bind(phaseName) {
    if (!this.enabled) {
      return () => {};
    }
    return (subjectId, kind, data) => {
      this._record(phaseName, subjectId, kind, data);
    };
  }

  _record(phaseName, subjectId, kind, data) {
    if (!this._subjects.has(subjectId)) {
      this._subjects.set(subjectId, { events: [] });
    }
    const t = performance.now() - this.startMs;
    const event = { phase: phaseName, t, kind };
    if (data !== undefined) event.data = data;
    this._subjects.get(subjectId).events.push(event);
  }

  /**
   * Set or update the human-readable display name for a subject.
   * Phases use this to give the CLI something nice to print.
   */
  name(subjectId, displayName) {
    if (!this.enabled) return;
    if (!this._subjects.has(subjectId)) {
      this._subjects.set(subjectId, { events: [] });
    }
    this._subjects.get(subjectId).displayName = displayName;
  }

  /**
   * Record a phase summary (called by the runner's onEvent hook).
   */
  recordPhaseSummary(name, ms) {
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
  subject(id) {
    const data = this._subjects.get(id) || { events: [] };
    return {
      displayName: data.displayName,
      events: data.events.slice(),
      kinds() {
        const seen = new Set();
        const list = [];
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
  filter({ phase, kind } = {}) {
    const out = [];
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
  dump() {
    const subjects = {};
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
  saveTo(path) {
    fs.mkdirSync(require_dirname(path), { recursive: true });
    const tmp = path + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.dump()));
    fs.renameSync(tmp, path);
  }

  /**
   * Load a previously saved trace from disk.
   */
  static load(path) {
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
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

function require_dirname(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '.' : p.slice(0, i);
}
