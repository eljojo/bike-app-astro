import { describe, it, expect } from 'vitest';
import {
  splitMixedCharacterNetwork,
  applyMtbSplits,
  MIN_MEMBERS_FOR_SPLIT,
} from '../../scripts/pipeline/lib/split-mtb-networks.ts';

function mkMember(name: string, pathType: string) {
  return { name, type: 'destination', path_type: pathType };
}
function mkNetwork(name: string, members: Array<{ name: string; path_type: string }>, extra: Record<string, unknown> = {}) {
  return {
    name,
    type: 'network',
    _memberRefs: members.map((m) => ({ ...m, type: 'destination' })),
    ...extra,
  };
}

describe('splitMixedCharacterNetwork', () => {
  it('returns input unchanged for non-network entries', () => {
    const e = { name: 'X', type: 'destination', path_type: 'mup' };
    expect(splitMixedCharacterNetwork(e)).toEqual([e]);
  });

  it(`returns input unchanged when members < ${MIN_MEMBERS_FOR_SPLIT}`, () => {
    const net = mkNetwork('Small', [
      mkMember('A', 'mup'),
      mkMember('B', 'mtb-trail'),
    ]);
    expect(splitMixedCharacterNetwork(net)).toEqual([net]);
  });

  it('returns input unchanged when all members are MTB', () => {
    const net = mkNetwork('All MTB', [
      mkMember('A', 'mtb-trail'),
      mkMember('B', 'mtb-trail'),
      mkMember('C', 'mtb-trail'),
    ]);
    expect(splitMixedCharacterNetwork(net)).toEqual([net]);
  });

  it('returns input unchanged when all members are non-MTB', () => {
    const net = mkNetwork('All MUP', [
      mkMember('A', 'mup'),
      mkMember('B', 'mup'),
      mkMember('C', 'mup'),
    ]);
    expect(splitMixedCharacterNetwork(net)).toEqual([net]);
  });

  it('returns input unchanged when minority side has only 1-2 members', () => {
    // Single non-MTB connector inside an MTB-dominated park — split not
    // justified. Network stays whole (South March Highlands pattern).
    const net = mkNetwork('MTB Park with Connector', [
      mkMember('Connector', 'mup'),
      mkMember('Trail 1', 'mtb-trail'),
      mkMember('Trail 2', 'mtb-trail'),
      mkMember('Trail 3', 'mtb-trail'),
      mkMember('Trail 4', 'mtb-trail'),
    ]);
    expect(splitMixedCharacterNetwork(net)).toEqual([net]);
  });

  it('splits a mixed network into two halves when both sides meet the threshold', () => {
    const net = mkNetwork('NCC Greenbelt', [
      mkMember('Greenbelt Pathway East', 'mup'),
      mkMember('Greenbelt Pathway West', 'mup'),
      mkMember('Watts Creek Pathway', 'mup'),
      mkMember('Trail 10', 'mtb-trail'),
      mkMember('Trail 11', 'mtb-trail'),
      mkMember('Trail 12', 'mtb-trail'),
    ]);
    const [pathway, mtb] = splitMixedCharacterNetwork(net);
    expect(pathway.name).toBe('NCC Greenbelt');
    expect(mtb.name).toBe('NCC Greenbelt MTB');
    expect(pathway._memberRefs?.map((m) => m.name)).toEqual([
      'Greenbelt Pathway East', 'Greenbelt Pathway West', 'Watts Creek Pathway',
    ]);
    expect(mtb._memberRefs?.map((m) => m.name)).toEqual([
      'Trail 10', 'Trail 11', 'Trail 12',
    ]);
  });

  it('cross-references the halves via _mtb_split_sibling', () => {
    const net = mkNetwork('Parc de la Gatineau', [
      mkMember('Sentier du Parc', 'mup'),
      mkMember('Chemin Kingsmere', 'bike-lane'),
      mkMember('Chemin de Masham', 'bike-lane'),
      mkMember('Hermit', 'mtb-trail'),
      mkMember('Whale', 'mtb-trail'),
      mkMember('Salamander', 'mtb-trail'),
    ]);
    const [pathway, mtb] = splitMixedCharacterNetwork(net) as any[];
    expect(pathway._mtb_split_sibling).toBe(mtb);
    expect(mtb._mtb_split_sibling).toBe(pathway);
  });

  it('clears osm_relations on the MTB half', () => {
    const net = mkNetwork(
      'With Relations',
      [
        mkMember('A', 'mup'),
        mkMember('B', 'mup'),
        mkMember('C', 'mup'),
        mkMember('D', 'mtb-trail'),
        mkMember('E', 'mtb-trail'),
        mkMember('F', 'mtb-trail'),
      ],
      { osm_relations: [12345, 67890] },
    );
    const [pathway, mtb] = splitMixedCharacterNetwork(net) as Array<Record<string, unknown>>;
    expect(pathway.osm_relations).toEqual([12345, 67890]);
    expect(mtb.osm_relations).toBeUndefined();
  });

  it('updates each member _networkRef to point at its new owner', () => {
    const net = mkNetwork('Split', [
      mkMember('A', 'mup'),
      mkMember('B', 'mup'),
      mkMember('C', 'mup'),
      mkMember('D', 'mtb-trail'),
      mkMember('E', 'mtb-trail'),
      mkMember('F', 'mtb-trail'),
    ]);
    const [pathway, mtb] = splitMixedCharacterNetwork(net) as any[];
    expect(pathway._memberRefs[0]._networkRef).toBe(pathway);
    expect(pathway._memberRefs[1]._networkRef).toBe(pathway);
    expect(mtb._memberRefs[0]._networkRef).toBe(mtb);
  });
});

describe('applyMtbSplits', () => {
  it('replaces split networks in place, preserves non-network entries', () => {
    const path1 = { name: 'Standalone', type: 'destination', path_type: 'mup' };
    const splittable = mkNetwork('Split Me', [
      mkMember('A', 'mup'),
      mkMember('B', 'mup'),
      mkMember('C', 'mup'),
      mkMember('D', 'mtb-trail'),
      mkMember('E', 'mtb-trail'),
      mkMember('F', 'mtb-trail'),
    ]);
    const unsplittable = mkNetwork('Stay', [mkMember('D', 'mup'), mkMember('E', 'mup')]);

    const out = applyMtbSplits([path1, splittable, unsplittable]);
    expect(out).toHaveLength(4);
    expect(out[0]).toBe(path1);
    expect(out[1].name).toBe('Split Me');
    expect(out[2].name).toBe('Split Me MTB');
    expect(out[3]).toBe(unsplittable);
  });
});
