import { describe, it, expect } from 'vitest';
import { finalizeOverridesPhase } from '../../../scripts/pipeline/phases/finalize-overrides.ts';
import { Trace } from '../../../scripts/pipeline/engine/trace.mjs';

const ADAPTER = { relationNamePattern: '', namedWayQueries: () => [] };

describe('finalize.overrides phase', () => {
  it('returns entries unchanged when no overrides are provided', async () => {
    const trace = new Trace();
    const entries = [{ name: 'Trail A', type: 'connector' }];
    const out = await finalizeOverridesPhase({
      entries,
      markdownOverrides: new Map(),
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.overrides'),
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('connector');
  });

  it('overrides type via markdown frontmatter (Dewberry destination case)', async () => {
    const trace = new Trace();
    const entries = [{ name: 'Dewberry Trail', type: 'connector' }];
    const overrides = new Map([['dewberry-trail', { type: 'destination' }]]);
    const out = await finalizeOverridesPhase({
      entries,
      markdownOverrides: overrides,
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.overrides'),
      },
    });
    expect(out[0].type).toBe('destination');
  });

  it('throws when member_of points to a non-existent network slug', async () => {
    const trace = new Trace();
    const entries = [{ name: 'Some Trail' }];
    const overrides = new Map([['some-trail', { member_of: 'no-such-network' }]]);
    await expect(
      finalizeOverridesPhase({
        entries,
        markdownOverrides: overrides,
        ctx: {
          bbox: '0,0,1,1', adapter: ADAPTER,
          queryOverpass: async () => ({ elements: [] }),
          trace: trace.bind('finalize.overrides'),
        },
      })
    ).rejects.toThrow(/no network with that slug exists/);
  });

  it('removes zombie networks (0 members) after overrides', async () => {
    const trace = new Trace();
    const networkA = { name: 'Network A', type: 'network', _memberRefs: [] };
    const entries = [networkA, { name: 'Trail X' }];
    const out = await finalizeOverridesPhase({
      entries,
      markdownOverrides: new Map(),
      ctx: {
        bbox: '0,0,1,1', adapter: ADAPTER,
        queryOverpass: async () => ({ elements: [] }),
        trace: trace.bind('finalize.overrides'),
      },
    });
    // Empty network removed
    expect(out.find((e) => e.name === 'Network A')).toBeUndefined();
    expect(out.find((e) => e.name === 'Trail X')).toBeDefined();
  });
});
