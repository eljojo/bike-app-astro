import { describe, it, expect } from 'vitest';
import { Semaphore, TaskGraph } from '../../../scripts/pipeline/engine/task-graph.ts';

describe('Semaphore', () => {
  it('allows up to N concurrent acquisitions', async () => {
    const sem = new Semaphore(2);
    let inFlight = 0;
    let maxInFlight = 0;
    const work = async () => {
      await sem.acquire();
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      sem.release();
    };
    await Promise.all([work(), work(), work(), work(), work()]);
    expect(maxInFlight).toBe(2);
  });

  it('with() acquires before fn and releases after', async () => {
    const sem = new Semaphore(1);
    const order = [];
    const a = sem.with(async () => { order.push('a-start'); await new Promise(r => setTimeout(r, 10)); order.push('a-end'); });
    const b = sem.with(async () => { order.push('b-start'); order.push('b-end'); });
    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('with() releases on throw', async () => {
    const sem = new Semaphore(1);
    await expect(sem.with(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // If release didn't happen, the next acquire would hang. Use a short timeout.
    let acquired = false;
    const next = sem.with(async () => { acquired = true; });
    await Promise.race([next, new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 100))]);
    expect(acquired).toBe(true);
  });
});

describe('TaskGraph — sequential', () => {
  it('runs a single step with no deps and returns its value', async () => {
    const g = new TaskGraph();
    g.define({ name: 'one', run: async () => 42 });
    const result = await g.run({ goal: 'one', context: {}, concurrency: 1 });
    expect(result).toBe(42);
  });

  it('runs a step that depends on another, passing the dep value as a named input', async () => {
    const g = new TaskGraph();
    g.define({ name: 'a', run: async () => 'A' });
    g.define({
      name: 'b',
      deps: { fromA: 'a' },
      run: async ({ fromA }) => `B(${fromA})`,
    });
    const result = await g.run({ goal: 'b', context: {}, concurrency: 1 });
    expect(result).toBe('B(A)');
  });

  it('passes context to every step', async () => {
    const g = new TaskGraph();
    g.define({ name: 'one', run: async ({ ctx }) => ctx.greeting });
    const result = await g.run({ goal: 'one', context: { greeting: 'hi' }, concurrency: 1 });
    expect(result).toBe('hi');
  });

  it('throws if goal step is not defined', async () => {
    const g = new TaskGraph();
    g.define({ name: 'one', run: async () => 1 });
    await expect(g.run({ goal: 'missing', context: {}, concurrency: 1 })).rejects.toThrow(/goal "missing" not defined/);
  });

  it('throws if a dep references an undefined step', async () => {
    const g = new TaskGraph();
    g.define({ name: 'a', deps: { x: 'missing' }, run: async () => 1 });
    await expect(g.run({ goal: 'a', context: {}, concurrency: 1 })).rejects.toThrow(/step "missing" referenced but not defined/);
  });

  it('throws if a step is defined twice', () => {
    const g = new TaskGraph();
    g.define({ name: 'a', run: async () => 1 });
    expect(() => g.define({ name: 'a', run: async () => 2 })).toThrow(/already defined/);
  });

  it('detects cycles via the deps graph', async () => {
    const g = new TaskGraph();
    g.define({ name: 'a', deps: { fromB: 'b' }, run: async () => 1 });
    g.define({ name: 'b', deps: { fromA: 'a' }, run: async () => 2 });
    await expect(g.run({ goal: 'a', context: {}, concurrency: 1 })).rejects.toThrow(/cycle detected/);
  });
});

describe('TaskGraph — parallel', () => {
  it('runs independent steps in parallel up to concurrency', async () => {
    const g = new TaskGraph();
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return 1;
    };
    g.define({ name: 'a', run: slow });
    g.define({ name: 'b', run: slow });
    g.define({ name: 'c', run: slow });
    g.define({ name: 'd', run: slow });
    g.define({
      name: 'sink',
      deps: { a: 'a', b: 'b', c: 'c', d: 'd' },
      run: async ({ a, b, c, d }) => a + b + c + d,
    });
    const result = await g.run({ goal: 'sink', context: {}, concurrency: 2 });
    expect(result).toBe(4);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThanOrEqual(2); // confirm we DID parallelize
  });

  it('respects deps — dependent steps wait for inputs', async () => {
    const g = new TaskGraph();
    const order = [];
    g.define({ name: 'fetch', run: async () => { order.push('fetch'); return 'data'; } });
    g.define({
      name: 'transform',
      deps: { data: 'fetch' },
      run: async ({ data }) => { order.push('transform'); return data.toUpperCase(); },
    });
    g.define({
      name: 'write',
      deps: { result: 'transform' },
      run: async ({ result }) => { order.push('write'); return result; },
    });
    const out = await g.run({ goal: 'write', context: {}, concurrency: 4 });
    expect(out).toBe('DATA');
    expect(order).toEqual(['fetch', 'transform', 'write']);
  });

  it('cascade-fails dependents when a step throws', async () => {
    const g = new TaskGraph();
    const skipped = [];
    g.define({ name: 'broken', run: async () => { throw new Error('boom'); } });
    g.define({
      name: 'dependent',
      deps: { x: 'broken' },
      run: async () => { skipped.push('dependent'); return 'never'; },
    });
    g.define({ name: 'sibling', run: async () => 'ok' });
    g.define({
      name: 'sink',
      deps: { d: 'dependent', s: 'sibling' },
      run: async () => { skipped.push('sink'); return 'never'; },
    });

    const events = [];
    await expect(
      g.run({ goal: 'sink', context: {}, concurrency: 4, onEvent: (e) => events.push(e) })
    ).rejects.toThrow('boom');

    // Sibling should still have run (it doesn't depend on broken)
    const sibling = events.find((e) => e.type === 'done' && e.step === 'sibling');
    expect(sibling).toBeDefined();
    // Dependent and sink should have been skipped, not run
    expect(skipped).toEqual([]);
    const skipEvents = events.filter((e) => e.type === 'skip');
    expect(skipEvents.map((e) => e.step).sort()).toEqual(['dependent', 'sink']);
  });

  it('emits start/done events for each step', async () => {
    const g = new TaskGraph();
    g.define({ name: 'a', run: async () => 1 });
    g.define({ name: 'b', deps: { x: 'a' }, run: async ({ x }) => x + 1 });
    const events = [];
    await g.run({ goal: 'b', context: {}, concurrency: 4, onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.type === 'start').map((e) => e.step)).toEqual(['a', 'b']);
    expect(events.filter((e) => e.type === 'done').map((e) => e.step)).toEqual(['a', 'b']);
    for (const e of events.filter((e) => e.type === 'done')) {
      expect(typeof e.ms).toBe('number');
    }
  });
});

describe('TaskGraph — diagram', () => {
  it('emits Mermaid graph TD syntax with star annotations', () => {
    const g = new TaskGraph();
    g.define({ name: 'a', run: async () => 1 });
    g.define({ name: 'b', star: true, deps: { x: 'a' }, run: async () => 2 });
    g.define({ name: 'c', deps: { y: 'b' }, run: async () => 3 });
    const out = g.diagram({ format: 'mermaid' });
    expect(out).toContain('graph TD');
    expect(out).toContain('a --> b');
    expect(out).toContain('b --> c');
    expect(out).toContain('★'); // star annotation on b
  });
});
