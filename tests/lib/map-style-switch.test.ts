import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getStyleUrl, loadStylePreference, switchStyle } from '../../src/lib/map-style-switch';
import { MAP_STYLE_URL, MAP_STYLE_HC_URL } from '../../src/lib/map-style-url';

describe('getStyleUrl', () => {
  it('returns default URL for "default" key', () => {
    expect(getStyleUrl('default')).toBe(MAP_STYLE_URL);
  });

  it('returns HC URL for "high-contrast" key', () => {
    expect(getStyleUrl('high-contrast')).toBe(MAP_STYLE_HC_URL);
  });
});

describe('loadStylePreference', () => {
  it('returns "default" when localStorage is unavailable', () => {
    // In Node (no browser), typeof localStorage === 'undefined'
    expect(loadStylePreference()).toBe('default');
  });

  describe('with localStorage', () => {
    let storage: Record<string, string>;

    beforeEach(() => {
      storage = {};
      (globalThis as any).localStorage = {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, val: string) => { storage[key] = val; },
        removeItem: (key: string) => { delete storage[key]; },
        clear: () => { storage = {}; },
      };
    });

    afterEach(() => {
      delete (globalThis as any).localStorage;
    });

    it('returns "default" when nothing stored', () => {
      expect(loadStylePreference()).toBe('default');
    });

    it('returns "high-contrast" when stored', () => {
      storage['map-style'] = 'high-contrast';
      expect(loadStylePreference()).toBe('high-contrast');
    });

    it('returns "default" for unknown stored value', () => {
      storage['map-style'] = 'funky';
      expect(loadStylePreference()).toBe('default');
    });
  });
});

describe('switchStyle', () => {
  it('calls setStyle with the correct URL and registers style.load listener', () => {
    const setStyle = vi.fn();
    const once = vi.fn();
    const fakeMap = { setStyle, once };
    const replaySetup = vi.fn();

    switchStyle(fakeMap, 'high-contrast', replaySetup);

    expect(setStyle).toHaveBeenCalledWith(MAP_STYLE_HC_URL);
    expect(once).toHaveBeenCalledWith('style.load', replaySetup);
  });

  it('uses default URL for "default" key', () => {
    const setStyle = vi.fn();
    const once = vi.fn();
    const fakeMap = { setStyle, once };

    switchStyle(fakeMap, 'default', vi.fn());

    expect(setStyle).toHaveBeenCalledWith(MAP_STYLE_URL);
  });
});
