import { describe, it, expect } from 'vitest';
import { Trace } from '../../../scripts/pipeline/engine/trace.ts';

describe('Trace', () => {
  it('records events for a subject and indexes them by id', () => {
    const trace = new Trace();
    const phase = trace.bind('discover.namedWays');
    phase('way:1', 'discovered', { via: 'query' });
    phase('way:1', 'filtered', { reason: 'ski-only' });
    phase('way:2', 'discovered', { via: 'query' });

    const w1 = trace.subject('way:1');
    expect(w1.events).toHaveLength(2);
    expect(w1.events[0].kind).toBe('discovered');
    expect(w1.events[1].kind).toBe('filtered');
    expect(w1.events.every((e) => e.phase === 'discover.namedWays')).toBe(true);
  });

  it('subject() returns an empty events array when subject is unknown', () => {
    const trace = new Trace();
    const w = trace.subject('way:999');
    expect(w.events).toEqual([]);
  });

  it('subject(id).kinds() returns the set of kinds for that subject', () => {
    const trace = new Trace();
    const phase = trace.bind('discover.namedWays');
    phase('entry:trail-3', 'discovered');
    phase('entry:trail-3', 'classified');
    phase('entry:trail-3', 'classified');
    expect(trace.subject('entry:trail-3').kinds()).toEqual(['discovered', 'classified']);
  });

  it('filter({phase, kind}) returns matching events across subjects', () => {
    const trace = new Trace();
    const a = trace.bind('discover.namedWays');
    const b = trace.bind('assemble.entries');
    a('way:1', 'filtered', { reason: 'ski' });
    a('way:2', 'filtered', { reason: 'bicycle=no' });
    b('entry:e1', 'classified', { type: 'destination' });
    a('way:3', 'discovered');

    const filtered = trace.filter({ phase: 'discover.namedWays', kind: 'filtered' });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((e) => e.subject)).toEqual(['way:1', 'way:2']);
  });

  it('dump() returns a serialisable object with phases and subjects', () => {
    const trace = new Trace();
    const phase = trace.bind('discover.relations');
    phase('relation:1', 'discovered', { name: 'OVRT' });
    const dump = trace.dump();
    expect(dump.phases).toBeDefined();
    expect(dump.subjects['relation:1']).toBeDefined();
    expect(dump.subjects['relation:1'].events[0].kind).toBe('discovered');
    // Should be JSON-serialisable
    expect(() => JSON.stringify(dump)).not.toThrow();
  });

  it('saveTo() writes a JSON file and load() round-trips', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const tmp = path.join(os.tmpdir(), `trace-test-${Date.now()}.json`);

    const trace = new Trace();
    trace.bind('phase.a')('way:1', 'discovered', { x: 1 });
    trace.saveTo(tmp);

    const loaded = Trace.load(tmp);
    expect(loaded.subject('way:1').events[0].kind).toBe('discovered');
    expect(loaded.subject('way:1').events[0].data.x).toBe(1);

    fs.unlinkSync(tmp);
  });

  it('records a monotonic timestamp on each event', () => {
    const trace = new Trace();
    const phase = trace.bind('discover.namedWays');
    phase('way:1', 'discovered');
    phase('way:1', 'filtered');
    const events = trace.subject('way:1').events;
    expect(events[1].t).toBeGreaterThanOrEqual(events[0].t);
  });

  it('a no-op trace (TRACE=off) accepts calls but stores nothing', () => {
    const trace = new Trace({ enabled: false });
    const phase = trace.bind('discover.namedWays');
    phase('way:1', 'discovered');
    expect(trace.subject('way:1').events).toEqual([]);
  });
});
