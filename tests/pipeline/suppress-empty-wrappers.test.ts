import { describe, it, expect } from 'vitest';
import { suppressEmptyWrappers } from '../../scripts/pipeline/lib/suppress-empty-wrappers.ts';

function net(name: string, overrides: Record<string, unknown> = {}) {
  return { name, type: 'network', _memberRefs: [], ...overrides };
}
function path(name: string, overrides: Record<string, unknown> = {}) {
  return { name, type: 'destination', ...overrides };
}

describe('suppressEmptyWrappers', () => {
  it('drops a "X Trails" wrapper when a non-network "X" exists', () => {
    const x = path('La Boucle');
    const wrapper = net('La Boucle Trails', { _memberRefs: [x] });
    (x as any)._networkRef = wrapper;
    const out = suppressEmptyWrappers([x, wrapper]);
    expect(out).toEqual([x]);
    expect((x as any)._networkRef).toBeUndefined();
  });

  it('keeps a wrapper that has osm_relations of its own', () => {
    const x = path('Capital Pathway Network');
    const legit = net('Capital Pathway', { osm_relations: [12345], _memberRefs: [x] });
    const out = suppressEmptyWrappers([x, legit]);
    expect(out).toHaveLength(2);
  });

  it('keeps a network whose name does not end in "-trails"', () => {
    const x = path('Whatever');
    const n = net('Whatever Network', { _memberRefs: [x] });
    const out = suppressEmptyWrappers([x, n]);
    expect(out).toHaveLength(2);
  });

  it('keeps an orphan "-trails" network (no same-named sibling)', () => {
    const n = net('Coulicou Trails', { _memberRefs: [] });
    const out = suppressEmptyWrappers([n]);
    expect(out).toEqual([n]);
  });

  it('does not affect non-network entries', () => {
    const entries = [path('A'), path('B'), path('C')];
    expect(suppressEmptyWrappers(entries)).toEqual(entries);
  });

  it('handles multiple wrappers in the same input', () => {
    const a = path('La Boucle');
    const b = path('The Beast Trail');
    const wa = net('La Boucle Trails', { _memberRefs: [a] });
    const wb = net('The Beast Trail Trails', { _memberRefs: [b] });
    (a as any)._networkRef = wa;
    (b as any)._networkRef = wb;
    const out = suppressEmptyWrappers([a, wa, b, wb]);
    expect(out.map((e: any) => e.name).sort()).toEqual(['La Boucle', 'The Beast Trail']);
  });
});
