import { describe, it, expect } from 'vitest';
import { findNearbyPlaces } from '../src/lib/proximity';

describe('findNearbyPlaces', () => {
  const trackPoints = [
    { lat: 45.4215, lon: -75.6972 },
    { lat: 45.4315, lon: -75.6872 },
    { lat: 45.4415, lon: -75.6772 },
  ];

  it('finds places within 300m of the track', () => {
    const places = [
      { id: 'near', name: 'Near Place', category: 'cafe', lat: 45.4220, lng: -75.6970 },
      { id: 'far', name: 'Far Place', category: 'park', lat: 45.5000, lng: -75.5000 },
    ];
    const result = findNearbyPlaces(trackPoints, places);
    expect(result.map(p => p.id)).toContain('near');
    expect(result.map(p => p.id)).not.toContain('far');
  });

  it('returns empty for empty track', () => {
    const result = findNearbyPlaces([], [{ id: 'x', name: 'X', category: 'cafe', lat: 45.42, lng: -75.69 }]);
    expect(result).toHaveLength(0);
  });
});
