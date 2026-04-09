import { describe, it, expect } from 'vitest';
import {
  isTrailType,
  isSeparatedFromCars,
  isExplicitMtb,
  isDesignatedCycling,
  derivePathType,
  pathTypeForClustering,
  classifyPathsEarly,
  classifyPathsLate,
  type ClassifiableEntry,
} from '../../src/lib/bike-paths/classify-path';
import { isMaintainedUnpaved } from '../../src/lib/bike-paths/surfaces';

describe('isTrailType', () => {
  it('highway=path is trail type', () => {
    expect(isTrailType({ highway: 'path' })).toBe(true);
  });
  it('highway=footway is trail type', () => {
    expect(isTrailType({ highway: 'footway' })).toBe(true);
  });
  it('highway=cycleway + unpaved surface is trail type', () => {
    expect(isTrailType({ highway: 'cycleway', surface: 'ground' })).toBe(true);
  });
  it('highway=cycleway + paved surface is NOT trail type', () => {
    expect(isTrailType({ highway: 'cycleway', surface: 'asphalt' })).toBe(false);
  });
  it('highway=cycleway + no surface is NOT trail type', () => {
    expect(isTrailType({ highway: 'cycleway' })).toBe(false);
  });
  it('parallel_to entries are never trail type', () => {
    expect(isTrailType({ highway: 'path', parallel_to: 'Main St' })).toBe(false);
  });
  it('highway=secondary is not trail type', () => {
    expect(isTrailType({ highway: 'secondary' })).toBe(false);
  });
});

describe('isSeparatedFromCars', () => {
  it('highway=cycleway is separated', () => {
    expect(isSeparatedFromCars({ highway: 'cycleway' })).toBe(true);
  });
  it('highway=path is not separated', () => {
    expect(isSeparatedFromCars({ highway: 'path' })).toBe(false);
  });
  it('no highway is not separated', () => {
    expect(isSeparatedFromCars({})).toBe(false);
  });
});

describe('isExplicitMtb', () => {
  it('mtb:scale >= 1 is explicit MTB', () => {
    expect(isExplicitMtb({ 'mtb:scale': '3' })).toBe(true);
  });
  it('mtb:scale = 1 is explicit MTB', () => {
    expect(isExplicitMtb({ 'mtb:scale': '1' })).toBe(true);
  });
  it('mtb:scale = 0 is NOT explicit MTB (means any bike)', () => {
    expect(isExplicitMtb({ 'mtb:scale': '0' })).toBe(false);
  });
  it('mtb:scale = 0 as number is NOT explicit MTB', () => {
    expect(isExplicitMtb({ 'mtb:scale': 0 })).toBe(false);
  });
  it('mtb:scale:imba present is explicit MTB', () => {
    expect(isExplicitMtb({ 'mtb:scale:imba': '2' })).toBe(true);
  });
  it('no mtb tags is not explicit MTB', () => {
    expect(isExplicitMtb({})).toBe(false);
  });
});

describe('isDesignatedCycling', () => {
  it('bicycle=designated is designated', () => {
    expect(isDesignatedCycling({ bicycle: 'designated' })).toBe(true);
  });
  it('bicycle=yes is NOT designated', () => {
    expect(isDesignatedCycling({ bicycle: 'yes' })).toBe(false);
  });
  it('no bicycle tag is not designated', () => {
    expect(isDesignatedCycling({})).toBe(false);
  });
});

describe('isMaintainedUnpaved', () => {
  it('fine_gravel is maintained unpaved', () => {
    expect(isMaintainedUnpaved('fine_gravel')).toBe(true);
  });
  it('compacted is maintained unpaved', () => {
    expect(isMaintainedUnpaved('compacted')).toBe(true);
  });
  it('ground is NOT maintained unpaved', () => {
    expect(isMaintainedUnpaved('ground')).toBe(false);
  });
  it('gravel is NOT maintained unpaved', () => {
    expect(isMaintainedUnpaved('gravel')).toBe(false);
  });
  it('dirt is NOT maintained unpaved', () => {
    expect(isMaintainedUnpaved('dirt')).toBe(false);
  });
  it('asphalt is NOT maintained unpaved', () => {
    expect(isMaintainedUnpaved('asphalt')).toBe(false);
  });
  it('undefined is NOT maintained unpaved', () => {
    expect(isMaintainedUnpaved(undefined)).toBe(false);
  });
});

describe('derivePathType', () => {
  // MTB
  it('mtb=true → mtb-trail', () => {
    expect(derivePathType({ mtb: true, highway: 'path', surface: 'ground' })).toBe('mtb-trail');
  });
  it('mtb takes priority over parallel_to', () => {
    expect(derivePathType({ mtb: true, parallel_to: 'Main St', cycleway: 'track' })).toBe('mtb-trail');
  });

  // Road infrastructure
  it('parallel_to + cycleway=track → separated-lane', () => {
    expect(derivePathType({ parallel_to: 'Main St', cycleway: 'track' })).toBe('separated-lane');
  });
  it('parallel_to + cycleway=lane → bike-lane', () => {
    expect(derivePathType({ parallel_to: 'Main St', cycleway: 'lane' })).toBe('bike-lane');
  });
  it('parallel_to + cycleway=shoulder → paved-shoulder', () => {
    expect(derivePathType({ parallel_to: 'Main St', cycleway: 'shoulder' })).toBe('paved-shoulder');
  });
  it('parallel_to without cycleway → bike-lane (default)', () => {
    expect(derivePathType({ parallel_to: 'Main St' })).toBe('bike-lane');
  });
  it('parallel_to takes priority over unpaved surface', () => {
    expect(derivePathType({ parallel_to: 'Main St', surface: 'gravel' })).toBe('bike-lane');
  });

  // Unpaved
  it('unpaved surface → trail', () => {
    expect(derivePathType({ highway: 'path', surface: 'gravel' })).toBe('trail');
  });
  it('fine_gravel is unpaved → trail', () => {
    expect(derivePathType({ highway: 'cycleway', surface: 'fine_gravel' })).toBe('trail');
  });
  it('compacted is unpaved → trail', () => {
    expect(derivePathType({ highway: 'path', surface: 'compacted' })).toBe('trail');
  });

  // MUP — requires evidence of pavement
  it('asphalt cycleway → mup', () => {
    expect(derivePathType({ highway: 'cycleway', surface: 'asphalt' })).toBe('mup');
  });
  it('highway=cycleway with no surface → mup (cycleway implies pavement)', () => {
    expect(derivePathType({ highway: 'cycleway' })).toBe('mup');
  });
  it('highway=path + paved surface → mup', () => {
    expect(derivePathType({ highway: 'path', surface: 'asphalt' })).toBe('mup');
  });

  // MUP correction: path/footway with no surface → trail, not mup
  it('highway=path with no surface → trail (MUP requires evidence of pavement)', () => {
    expect(derivePathType({ highway: 'path' })).toBe('trail');
  });
  it('highway=footway with no surface → trail', () => {
    expect(derivePathType({ highway: 'footway' })).toBe('trail');
  });

  // mtb:scale=0 correction
  it('mtb:scale=0 with unpaved surface → trail (not mtb-trail)', () => {
    expect(derivePathType({ 'mtb:scale': '0', highway: 'path', surface: 'dirt' })).toBe('trail');
  });
  it('cycleway + mtb:scale=0 → mup (scale 0 = any bike)', () => {
    expect(derivePathType({ highway: 'cycleway', 'mtb:scale': '0' })).toBe('mup');
  });

  // wood surface
  it('surface=wood on cycleway → mup (wood is rideable)', () => {
    expect(derivePathType({ highway: 'cycleway', surface: 'wood' })).toBe('mup');
  });
  it('surface=wood on path → mup (wood is paved for classification)', () => {
    expect(derivePathType({ highway: 'path', surface: 'wood' })).toBe('mup');
  });

  // Networks
  it('network entries return undefined', () => {
    expect(derivePathType({ type: 'network', name: 'Capital Pathway' })).toBeUndefined();
  });

  // No tags
  it('no tags at all → trail (no evidence of pavement)', () => {
    expect(derivePathType({})).toBe('trail');
  });

  // Real-world spot checks
  it('road with cycleway=lane but no parallel_to → bike-lane (Lyon Street)', () => {
    expect(derivePathType({
      highway: 'secondary', cycleway: 'lane', surface: 'asphalt', lit: 'yes',
    })).toBe('bike-lane');
  });
  it('highway=cycleway with parallel_to → mup (Queen Elizabeth Driveway)', () => {
    expect(derivePathType({
      highway: 'cycleway', parallel_to: 'Queen Elizabeth Driveway',
      surface: 'asphalt', width: '3', smoothness: 'excellent',
    })).toBe('mup');
  });
  it('road with cycleway=lane + parallel_to → bike-lane', () => {
    expect(derivePathType({
      highway: 'primary', cycleway: 'lane', parallel_to: 'Some Road',
    })).toBe('bike-lane');
  });
});

describe('pathTypeForClustering', () => {
  it('maps trail → trail', () => {
    expect(pathTypeForClustering({ path_type: 'trail' })).toBe('trail');
  });
  it('maps mtb-trail → trail', () => {
    expect(pathTypeForClustering({ path_type: 'mtb-trail' })).toBe('trail');
  });
  it('maps mup → paved', () => {
    expect(pathTypeForClustering({ path_type: 'mup' })).toBe('paved');
  });
  it('maps bike-lane → road', () => {
    expect(pathTypeForClustering({ path_type: 'bike-lane' })).toBe('road');
  });
  it('maps separated-lane → road', () => {
    expect(pathTypeForClustering({ path_type: 'separated-lane' })).toBe('road');
  });
  it('maps paved-shoulder → road', () => {
    expect(pathTypeForClustering({ path_type: 'paved-shoulder' })).toBe('road');
  });
  it('no path_type → null', () => {
    expect(pathTypeForClustering({})).toBe(null);
  });
  it('network with no path_type but paved tags → paved (fallback to raw tags)', () => {
    expect(pathTypeForClustering({ type: 'network', highway: 'cycleway', surface: 'asphalt' })).toBe('paved');
  });
  it('network with no path_type and trail tags → trail', () => {
    expect(pathTypeForClustering({ type: 'network', highway: 'path', surface: 'ground' })).toBe('trail');
  });
  it('network with no path_type and road tags → road', () => {
    expect(pathTypeForClustering({ type: 'network', highway: 'tertiary', parallel_to: 'Main St' })).toBe('road');
  });
  it('entry with no path_type and no tags → null', () => {
    expect(pathTypeForClustering({})).toBe(null);
  });
});

describe('classifyPathsEarly', () => {
  it('sets mtb=true on explicit MTB entries (tier 1)', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Trail 42', highway: 'path', surface: 'ground', 'mtb:scale': '3' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].mtb).toBe(true);
  });

  it('does NOT set mtb on scale 0', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Easy Path', highway: 'cycleway', surface: 'asphalt', 'mtb:scale': '0' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].mtb).toBeUndefined();
  });

  it('sets mtb=true on mtb:scale:imba entries', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Salamander', highway: 'path', 'mtb:scale:imba': '2' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].mtb).toBe(true);
  });

  it('derives path_type for all non-network entries', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Paved Path', highway: 'cycleway', surface: 'asphalt' },
      { name: 'Dirt Trail', highway: 'path', surface: 'ground' },
      { name: 'Network', type: 'network' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].path_type).toBe('mup');
    expect(entries[1].path_type).toBe('mtb-trail'); // tier-3 ambient promotes to mtb-trail
    expect(entries[2].path_type).toBeUndefined();
  });

  it('returns mtbCount', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'A', highway: 'path', 'mtb:scale': '2' },
      { name: 'B', highway: 'cycleway', surface: 'asphalt' },
    ];
    const { mtbCount } = classifyPathsEarly(entries);
    expect(mtbCount).toBe(1);
  });

  it('tier 3: ambient dirt trail → mtb (moved from late)', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Forest Path', highway: 'path', surface: 'ground' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].mtb).toBe(true);
    expect(entries[0].path_type).toBe('mtb-trail');
  });

  it('tier 3: bicycle=designated → NOT ambient mtb (early)', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Designated', highway: 'path', surface: 'ground', bicycle: 'designated' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].mtb).toBeUndefined();
    expect(entries[0].path_type).toBe('trail');
  });

  it('tier 3: fine_gravel → NOT ambient mtb (early)', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Gravel Path', highway: 'path', surface: 'fine_gravel' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].mtb).toBeUndefined();
    expect(entries[0].path_type).toBe('trail');
  });

  it('tier 3: highway=path with no surface → mtb', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Mystery', highway: 'path' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].mtb).toBe(true);
    expect(entries[0].path_type).toBe('mtb-trail');
  });

  it('tier 3: parallel_to → NOT ambient mtb', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Bank St', highway: 'cycleway', parallel_to: 'Bank Street' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].mtb).toBeUndefined();
  });

  it('tier 3: paved cycleway → NOT ambient mtb', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Laurier Bikelane', highway: 'cycleway', surface: 'asphalt' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].mtb).toBeUndefined();
    expect(entries[0].path_type).toBe('mup');
  });

  it('tier 3: highway=cycleway + ground → mtb', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Trail 55', highway: 'cycleway', surface: 'ground' },
    ];
    classifyPathsEarly(entries);
    expect(entries[0].mtb).toBe(true);
    expect(entries[0].path_type).toBe('mtb-trail');
  });
});

describe('classifyPathsLate', () => {
  it('tier 2: network with explicit MTB member → trail members inherit', () => {
    const trail41: ClassifiableEntry = { name: 'Trail 41', highway: 'path', surface: 'ground', path_type: 'trail' };
    const trail42: ClassifiableEntry = { name: 'Trail 42', highway: 'path', surface: 'ground', mtb: true, 'mtb:scale': '3', path_type: 'mtb-trail' };
    const trail43: ClassifiableEntry = { name: 'Trail 43', highway: 'path', surface: 'ground', path_type: 'trail' };
    const network: ClassifiableEntry = {
      name: 'Gatineau Trails', type: 'network',
      highway: 'path', surface: 'ground',
      _memberRefs: [trail41, trail42, trail43],
    };
    const entries = [network, trail41, trail42, trail43];
    classifyPathsLate(entries);
    expect(trail41.mtb).toBe(true);
    expect(trail41.path_type).toBe('mtb-trail');
    expect(trail43.mtb).toBe(true);
    expect(trail43.path_type).toBe('mtb-trail');
    expect(network.mtb).toBe(true);
  });

  it('tier 2: paved members do NOT inherit MTB', () => {
    const paved: ClassifiableEntry = { name: 'Paved', highway: 'cycleway', surface: 'asphalt', path_type: 'mup' };
    const dirt: ClassifiableEntry = { name: 'Dirt', highway: 'path', surface: 'ground', mtb: true, 'mtb:scale': '1', path_type: 'mtb-trail' };
    const network: ClassifiableEntry = {
      name: 'Mixed', type: 'network',
      highway: 'cycleway', surface: 'asphalt',
      _memberRefs: [paved, dirt],
    };
    classifyPathsLate([network, paved, dirt]);
    expect(paved.mtb).toBeUndefined();
    expect(paved.path_type).toBe('mup');
  });

  it('tier 2: non-network entries with _memberRefs are ignored', () => {
    const trail41: ClassifiableEntry = { name: 'Trail 41', highway: 'path', surface: 'ground', bicycle: 'designated', path_type: 'mup' };
    const trail42: ClassifiableEntry = { name: 'Trail 42', highway: 'path', surface: 'ground', mtb: true, 'mtb:scale': '3', path_type: 'mtb-trail' };
    const cluster: ClassifiableEntry = { name: 'Cluster', highway: 'path', surface: 'ground', _memberRefs: [trail41, trail42] };
    classifyPathsLate([cluster, trail41, trail42]);
    expect(trail41.mtb).toBeUndefined();
  });

  it('tier 3 does NOT run in late (moved to early)', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Forest Path', highway: 'path', surface: 'ground', path_type: 'trail' },
    ];
    classifyPathsLate(entries);
    expect(entries[0].mtb).toBeUndefined();
  });

  it('tier 2: fine_gravel member does NOT inherit MTB', () => {
    const gravel: ClassifiableEntry = { name: 'Greenbelt West', highway: 'path', surface: 'fine_gravel', path_type: 'trail' };
    const dirt: ClassifiableEntry = { name: 'Trail 42', highway: 'path', surface: 'ground', mtb: true, 'mtb:scale': '3', path_type: 'mtb-trail' };
    const network: ClassifiableEntry = {
      name: 'NCC Greenbelt', type: 'network',
      highway: 'path', surface: 'fine_gravel',
      _memberRefs: [gravel, dirt],
    };
    classifyPathsLate([network, gravel, dirt]);
    expect(gravel.mtb).toBeUndefined();
    expect(gravel.path_type).toBe('trail');
  });

  it('tier 3: fine_gravel path is NOT ambient MTB', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Moore Farm', highway: 'path', surface: 'fine_gravel', bicycle: 'yes', path_type: 'trail' },
    ];
    classifyPathsLate(entries);
    expect(entries[0].mtb).toBeUndefined();
    expect(entries[0].path_type).toBe('trail');
  });

  it('tier 3: compacted path is NOT ambient MTB', () => {
    const entries: ClassifiableEntry[] = [
      { name: 'Gravel MUP', highway: 'path', surface: 'compacted', path_type: 'trail' },
    ];
    classifyPathsLate(entries);
    expect(entries[0].mtb).toBeUndefined();
  });

  it('returns mtbCount for tier-2 entries newly labelled', () => {
    const trail: ClassifiableEntry = { name: 'Trail 41', highway: 'path', surface: 'ground', path_type: 'trail' };
    const mtbTrail: ClassifiableEntry = { name: 'Trail 42', highway: 'path', surface: 'ground', mtb: true, 'mtb:scale': '2', path_type: 'mtb-trail' };
    const network: ClassifiableEntry = {
      name: 'Gatineau', type: 'network',
      highway: 'path', surface: 'ground',
      _memberRefs: [trail, mtbTrail],
    };
    const { mtbCount } = classifyPathsLate([network, trail, mtbTrail]);
    expect(mtbCount).toBe(2); // trail + network
  });
});
