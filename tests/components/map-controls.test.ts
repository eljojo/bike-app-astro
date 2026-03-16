import { describe, it, expect, vi } from 'vitest';
import { loadToggleState } from '../../src/components/admin/MapControls';

describe('MapControls toggle state', () => {
  it('returns default state when localStorage is empty', () => {
    expect(loadToggleState('map-photos', true)).toBe(true);
    expect(loadToggleState('map-places', true)).toBe(true);
    expect(loadToggleState('map-gps', false)).toBe(false);
  });

  it('reads stored value from localStorage', () => {
    const mockStorage: Record<string, string> = { 'map-photos': 'false' };
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
    });

    expect(loadToggleState('map-photos', true)).toBe(false);
    expect(loadToggleState('map-places', true)).toBe(true); // not in storage, uses default

    vi.unstubAllGlobals();
  });
});
