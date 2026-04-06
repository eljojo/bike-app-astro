// detect-mtb.test.mjs
//
// MTB detection: label trails that aren't road-bike-friendly.
// Three tiers: explicit (mtb:scale tag), inferred (cluster has MTB),
// ambient (dirt path without cycling designation = probably MTB).

import { describe, it, expect } from 'vitest';
import { detectMtb } from '../../../scripts/pipeline/lib/detect-mtb.mjs';

describe('detectMtb', () => {
  // Tier 1: explicit mtb:scale tag
  it('mtb:scale tag → mtb: true', () => {
    const entries = [
      { name: 'Trail 42', highway: 'path', surface: 'ground', 'mtb:scale': '3' },
    ];
    detectMtb(entries);
    expect(entries[0].mtb).toBe(true);
  });

  it('mtb:scale 0 → NOT mtb (means any bike, no difficulty)', () => {
    const entries = [
      { name: 'Trillium Pathway', highway: 'cycleway', surface: 'asphalt', 'mtb:scale': '0', bicycle: 'designated' },
    ];
    detectMtb(entries);
    expect(entries[0].mtb).toBeUndefined();
  });

  it('mtb:scale:imba tag → mtb: true', () => {
    const entries = [
      { name: 'Salamander', highway: 'path', 'mtb:scale:imba': '2' },
    ];
    detectMtb(entries);
    expect(entries[0].mtb).toBe(true);
  });

  // Tier 2: inferred from network membership via _memberRefs
  it('network with one explicit MTB member (_memberRefs) → all trail members inherit mtb: true', () => {
    const trail41 = { name: 'Trail 41', highway: 'path', surface: 'ground' };
    const trail42 = { name: 'Trail 42', highway: 'path', surface: 'ground', 'mtb:scale': '3' };
    const trail43 = { name: 'Trail 43', highway: 'path', surface: 'ground' };
    const network = {
      name: 'Gatineau Trails',
      type: 'network',
      highway: 'path', surface: 'ground',
      _memberRefs: [trail41, trail42, trail43],
    };
    const entries = [network, trail41, trail42, trail43];
    detectMtb(entries);
    // Explicit MTB member
    expect(trail42.mtb).toBe(true);
    // Non-MTB trail members inherit from the network
    expect(trail41.mtb).toBe(true); // inferred
    expect(trail43.mtb).toBe(true); // inferred
    // Network itself inherits (it's trail-type, not paved)
    expect(network.mtb).toBe(true);
  });

  it('network with one explicit MTB member (slug members) → trail members inherit mtb: true', () => {
    // Slug for "Trail 42" → "trail-42", etc.
    const trail41 = { name: 'Trail 41', highway: 'path', surface: 'ground' };
    const trail42 = { name: 'Trail 42', highway: 'path', surface: 'ground', 'mtb:scale': '3' };
    const trail43 = { name: 'Trail 43', highway: 'path', surface: 'ground' };
    const network = {
      name: 'Gatineau Trails',
      type: 'network',
      highway: 'path', surface: 'ground',
      members: ['trail-41', 'trail-42', 'trail-43'],
    };
    const entries = [network, trail41, trail42, trail43];
    detectMtb(entries);
    expect(trail42.mtb).toBe(true); // explicit
    expect(trail41.mtb).toBe(true); // inferred via network
    expect(trail43.mtb).toBe(true); // inferred via network
  });

  it('network with MTB member does NOT infect paved members', () => {
    const pavedConnector = { name: 'Paved Connector', highway: 'cycleway', surface: 'asphalt' };
    const dirtTrail = { name: 'Dirt Trail', highway: 'path', surface: 'ground', 'mtb:scale': '1' };
    const network = {
      name: 'Mixed Network',
      type: 'network',
      highway: 'cycleway', surface: 'asphalt',
      _memberRefs: [pavedConnector, dirtTrail],
    };
    const entries = [network, pavedConnector, dirtTrail];
    detectMtb(entries);
    expect(pavedConnector.mtb).toBeUndefined(); // paved stays paved
    expect(dirtTrail.mtb).toBe(true);           // dirt trail is MTB (explicit)
  });

  it('non-network entry with members field is ignored by Tier 2', () => {
    // Entries without type: 'network' should NOT trigger Tier 2 inference
    const trail41 = { name: 'Trail 41', highway: 'path', surface: 'ground' };
    const trail42 = { name: 'Trail 42', highway: 'path', surface: 'ground', 'mtb:scale': '3' };
    const cluster = {
      name: 'Some Cluster',
      // no type: 'network'
      highway: 'path', surface: 'ground',
      _memberRefs: [trail41, trail42],
    };
    // We need to exclude trail41 from Tier 3 MTB to test Tier 2 isolation.
    // Make trail41 designated cycling so Tier 3 won't auto-label it.
    trail41.bicycle = 'designated';
    const entries = [cluster, trail41, trail42];
    detectMtb(entries);
    expect(trail42.mtb).toBe(true);      // explicit Tier 1
    expect(trail41.mtb).toBeUndefined(); // NOT inferred — cluster is not type: 'network'
  });

  // Tier 3: ambient — dirt path without cycling designation
  it('highway=path + ground surface + no bicycle tag → mtb: true', () => {
    const entries = [
      { name: 'Trail 41', highway: 'path', surface: 'ground' },
    ];
    detectMtb(entries);
    expect(entries[0].mtb).toBe(true);
  });

  it('highway=path + no surface + no bicycle tag → mtb: true', () => {
    const entries = [
      { name: 'Mystery Trail', highway: 'path' },
    ];
    detectMtb(entries);
    expect(entries[0].mtb).toBe(true);
  });

  // Should NOT be MTB
  it('highway=path + bicycle=designated → NOT mtb (proper cycling infra)', () => {
    const entries = [
      { name: 'NCC Pathway', highway: 'path', surface: 'asphalt', bicycle: 'designated' },
    ];
    detectMtb(entries);
    expect(entries[0].mtb).toBeUndefined();
  });

  it('highway=cycleway + asphalt → NOT mtb', () => {
    const entries = [
      { name: 'Laurier Bikelane', highway: 'cycleway', surface: 'asphalt' },
    ];
    detectMtb(entries);
    expect(entries[0].mtb).toBeUndefined();
  });

  it('highway=cycleway + ground → mtb (paved tag but dirt surface)', () => {
    const entries = [
      { name: 'Trail 55', highway: 'cycleway', surface: 'ground' },
    ];
    detectMtb(entries);
    expect(entries[0].mtb).toBe(true);
  });

  it('parallel_to road entries → never mtb', () => {
    const entries = [
      { name: 'Bank Street', highway: 'cycleway', parallel_to: 'Bank Street' },
    ];
    detectMtb(entries);
    expect(entries[0].mtb).toBeUndefined();
  });
});
