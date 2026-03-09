import { describe, it, expect } from 'vitest';
import { loadToggleState } from '../../src/components/admin/MapControls';

describe('MapControls toggle state', () => {
  it('returns default state when localStorage is empty', () => {
    expect(loadToggleState('map-photos', true)).toBe(true);
    expect(loadToggleState('map-places', true)).toBe(true);
    expect(loadToggleState('map-gps', false)).toBe(false);
  });
});
