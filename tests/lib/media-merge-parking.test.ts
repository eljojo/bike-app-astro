import { describe, it, expect } from 'vitest';
import { mergeParkedMedia } from '../../src/lib/media/media-merge';

describe('mergeParkedMedia', () => {
  it('adds newly parked photos to existing parked list', () => {
    const existing = [
      { key: 'old1', lat: 45.0, lng: -75.0, width: 800, height: 600 },
    ];
    const toAdd = [
      { key: 'new1', lat: 45.1, lng: -75.1, width: 1200, height: 900, caption: 'New' },
    ];
    const toRemove = new Set<string>();
    const result = mergeParkedMedia(existing, toAdd, toRemove);
    expect(result).toHaveLength(2);
    expect(result.find(p => p.key === 'new1')).toBeDefined();
  });

  it('removes un-parked photos', () => {
    const existing = [
      { key: 'p1', lat: 45.0, lng: -75.0, width: 800, height: 600 },
      { key: 'p2', lat: 45.1, lng: -75.1, width: 1000, height: 800 },
    ];
    const toAdd: any[] = [];
    const toRemove = new Set(['p1']);
    const result = mergeParkedMedia(existing, toAdd, toRemove);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('p2');
  });

  it('handles simultaneous add and remove', () => {
    const existing = [{ key: 'p1', lat: 45.0, lng: -75.0, width: 800, height: 600 }];
    const toAdd = [{ key: 'p2', lat: 45.2, lng: -75.2, width: 600, height: 400 }];
    const toRemove = new Set(['p1']);
    const result = mergeParkedMedia(existing, toAdd, toRemove);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('p2');
  });

  it('deduplicates by key when adding', () => {
    const existing = [{ key: 'p1', lat: 45.0, lng: -75.0, width: 800, height: 600 }];
    const toAdd = [{ key: 'p1', lat: 45.0, lng: -75.0, width: 800, height: 600 }];
    const toRemove = new Set<string>();
    const result = mergeParkedMedia(existing, toAdd, toRemove);
    expect(result).toHaveLength(1);
  });
});
