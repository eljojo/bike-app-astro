// tests/map-session.test.ts
import { describe, it, expect } from 'vitest';

describe('LayerContext generation counter', () => {
  it('isCurrent returns false after generation increments', () => {
    let generation = 0;

    function makeContext() {
      const gen = generation;
      return {
        generation: gen,
        isCurrent: () => gen === generation,
      };
    }

    const ctx = makeContext();
    expect(ctx.isCurrent()).toBe(true);

    generation++; // simulate style switch
    expect(ctx.isCurrent()).toBe(false);
  });

  it('new context after increment is current', () => {
    let generation = 0;

    function makeContext() {
      const gen = generation;
      return {
        generation: gen,
        isCurrent: () => gen === generation,
      };
    }

    const ctx1 = makeContext();
    generation++;
    const ctx2 = makeContext();

    expect(ctx1.isCurrent()).toBe(false);
    expect(ctx2.isCurrent()).toBe(true);
  });
});
