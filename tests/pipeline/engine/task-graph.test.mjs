import { describe, it, expect } from 'vitest';
import { Semaphore } from '../../../scripts/pipeline/engine/task-graph.mjs';

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
