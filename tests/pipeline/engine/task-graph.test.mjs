import { describe, it, expect } from 'vitest';
import { Semaphore, TaskGraph } from '../../../scripts/pipeline/engine/task-graph.mjs';

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
