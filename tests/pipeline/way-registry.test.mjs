import { describe, it, expect } from 'vitest';
import { WayRegistry } from '../../scripts/pipeline/lib/way-registry.mjs';

describe('WayRegistry', () => {
  it('claims ways for an entry and lists them as claimers', () => {
    const reg = new WayRegistry();
    const entry = { name: 'Trail A' };
    reg.claim(entry, [100, 200, 300]);
    expect(reg.claimersOf(100)).toEqual([entry]);
    expect(reg.claimersOf(200)).toEqual([entry]);
    expect(reg.claimersOf(999)).toEqual([]);
  });

  it('returns all way IDs for an entry', () => {
    const reg = new WayRegistry();
    const entry = { name: 'Trail A' };
    reg.claim(entry, [100, 200]);
    reg.claim(entry, [300]); // additional claim
    expect(reg.wayIdsFor(entry)).toEqual(new Set([100, 200, 300]));
  });

  it('detects conflicts when a way is claimed twice', () => {
    const reg = new WayRegistry();
    const a = { name: 'Trail A' };
    const b = { name: 'Trail B' };
    reg.claim(a, [100, 200]);
    reg.claim(b, [200, 300]);
    expect(reg.conflicts()).toEqual([
      { wayId: 200, entries: [a, b] },
    ]);
  });

  it('isClaimed checks individual way IDs', () => {
    const reg = new WayRegistry();
    reg.claim({ name: 'X' }, [100]);
    expect(reg.isClaimed(100)).toBe(true);
    expect(reg.isClaimed(999)).toBe(false);
  });

  it('overlapWith finds entries sharing ways', () => {
    const reg = new WayRegistry();
    const a = { name: 'Trail A' };
    const b = { name: 'Trail B' };
    reg.claim(a, [100, 200, 300]);
    reg.claim(b, [400, 500]);
    const overlap = reg.overlapWith([200, 400, 600]);
    expect(overlap).toEqual(new Map([
      [a, new Set([200])],
      [b, new Set([400])],
    ]));
  });

  it('transfer moves ways from one entry to another', () => {
    const reg = new WayRegistry();
    const a = { name: 'Trail A' };
    const b = { name: 'Trail B' };
    reg.claim(a, [100, 200, 300]);
    reg.transfer(a, b, [200, 300]);
    expect(reg.wayIdsFor(a)).toEqual(new Set([100]));
    expect(reg.wayIdsFor(b)).toEqual(new Set([200, 300]));
    expect(reg.claimersOf(200)).toEqual([b]);
  });

  it('remove deletes an entry and its claims', () => {
    const reg = new WayRegistry();
    const a = { name: 'Trail A' };
    reg.claim(a, [100, 200]);
    reg.remove(a);
    expect(reg.isClaimed(100)).toBe(false);
    expect(reg.wayIdsFor(a)).toEqual(new Set());
  });

  it('validate() returns empty array when no conflicts', () => {
    const reg = new WayRegistry();
    const a = { name: 'A' };
    const b = { name: 'B' };
    reg.claim(a, [100, 200]);
    reg.claim(b, [300, 400]);
    expect(reg.conflicts()).toEqual([]);
  });

  describe('claimersOf', () => {
    it('returns every entry that claimed a way, regardless of claim order', () => {
      const reg = new WayRegistry();
      const a = { name: 'A' };
      const b = { name: 'B' };
      const c = { name: 'C' };
      reg.claim(a, [100, 200]);
      reg.claim(b, [200, 300]);
      reg.claim(c, [200]);
      expect(new Set(reg.claimersOf(200))).toEqual(new Set([a, b, c]));
      expect(reg.claimersOf(100)).toEqual([a]);
      expect(reg.claimersOf(300)).toEqual([b]);
    });

    it('returns empty array for unclaimed ways', () => {
      const reg = new WayRegistry();
      reg.claim({ name: 'A' }, [100]);
      expect(reg.claimersOf(999)).toEqual([]);
    });

    it('is invariant to claim order — the set of claimers is the same either way', () => {
      const a = { name: 'A' };
      const b = { name: 'B' };

      const reg1 = new WayRegistry();
      reg1.claim(a, [100]);
      reg1.claim(b, [100]);

      const reg2 = new WayRegistry();
      reg2.claim(b, [100]);
      reg2.claim(a, [100]);

      expect(new Set(reg1.claimersOf(100))).toEqual(new Set(reg2.claimersOf(100)));
    });
  });
});
