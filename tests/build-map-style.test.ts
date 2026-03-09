import { describe, it, expect } from 'vitest';
import {
  lineWidth,
  scaleWidth,
  buildLayers,
  buildMapStyle,
  defaultBase,
  defaultCycling,
  hcBase,
  hcCycling,
} from '../scripts/build-map-style';

const defaultPalette = { base: defaultBase, cycling: defaultCycling };
const hcPalette = { base: hcBase, cycling: hcCycling };

describe('lineWidth', () => {
  it('returns a MapLibre interpolation expression', () => {
    const result = lineWidth([[10, 1], [14, 3]]);
    expect(result[0]).toBe('interpolate');
    expect(result[1]).toEqual(['exponential', 1.6]);
    expect(result[2]).toEqual(['zoom']);
    // Flattened stops: z10→1, z14→3
    expect(result.slice(3)).toEqual([10, 1, 14, 3]);
  });
});

describe('scaleWidth', () => {
  it('multiplies every width by the factor', () => {
    expect(scaleWidth([[10, 1], [14, 3]], 2)).toEqual([[10, 2], [14, 6]]);
  });

  it('handles fractional factors', () => {
    expect(scaleWidth([[8, 4]], 0.5)).toEqual([[8, 2]]);
  });
});

describe('buildLayers', () => {
  const defaultLayers = buildLayers(defaultPalette, 'default');
  const hcLayers = buildLayers(hcPalette, 'high-contrast');

  it('produces a non-empty array of layers', () => {
    expect(defaultLayers.length).toBeGreaterThan(0);
    expect(hcLayers.length).toBeGreaterThan(0);
  });

  function layerIds(layers: any[]) {
    return new Set(layers.map((l: any) => l.id));
  }

  describe('road classes', () => {
    const ids = layerIds(defaultLayers);

    it('has major road layers (fill + casing)', () => {
      expect(ids.has('road-fill-major')).toBe(true);
      expect(ids.has('road-casing-major')).toBe(true);
    });

    it('has secondary road layers (fill + casing)', () => {
      expect(ids.has('road-fill-secondary')).toBe(true);
      expect(ids.has('road-casing-secondary')).toBe(true);
    });

    it('has country road layers (fill + casing)', () => {
      expect(ids.has('road-fill-country')).toBe(true);
      expect(ids.has('road-casing-country')).toBe(true);
    });

    it('has minor road layers (fill + casing)', () => {
      expect(ids.has('road-fill-minor')).toBe(true);
      expect(ids.has('road-casing-minor')).toBe(true);
    });

    it('has service road layers (fill + casing)', () => {
      expect(ids.has('road-fill-service')).toBe(true);
      expect(ids.has('road-casing-service')).toBe(true);
    });
  });

  describe('secondary roads are distinct from major', () => {
    it('uses different fill colors', () => {
      expect(defaultBase.secondaryRoad).not.toBe(defaultBase.majorRoad);
    });

    it('uses different casing colors', () => {
      expect(defaultBase.secondaryRoadCasing).not.toBe(defaultBase.majorRoadCasing);
    });
  });

  describe('HC road colors are lighter than default', () => {
    function hexBrightness(hex: string): number {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return r + g + b;
    }

    const roadColorPairs: [string, string, string][] = [
      ['majorRoad', defaultBase.majorRoad, hcBase.majorRoad],
      ['majorRoadCasing', defaultBase.majorRoadCasing, hcBase.majorRoadCasing],
      ['secondaryRoad', defaultBase.secondaryRoad, hcBase.secondaryRoad],
      ['secondaryRoadCasing', defaultBase.secondaryRoadCasing, hcBase.secondaryRoadCasing],
      ['countryRoad', defaultBase.countryRoad, hcBase.countryRoad],
      ['countryRoadCasing', defaultBase.countryRoadCasing, hcBase.countryRoadCasing],
      ['road', defaultBase.road, hcBase.road],
      ['roadCasing', defaultBase.roadCasing, hcBase.roadCasing],
    ];

    for (const [name, defaultColor, hcColor] of roadColorPairs) {
      it(`${name}: HC (${hcColor}) is lighter than default (${defaultColor})`, () => {
        expect(hexBrightness(hcColor)).toBeGreaterThan(hexBrightness(defaultColor));
      });
    }
  });

  describe('bike infrastructure layers', () => {
    it('has oasis (cycleway) layers', () => {
      const oasisIds = defaultLayers.filter((l: any) => l.id.startsWith('oasis-')).map((l: any) => l.id);
      expect(oasisIds.length).toBeGreaterThan(0);
    });

    it('has exposed (bike lane) layer', () => {
      const ids = layerIds(defaultLayers);
      expect(ids.has('road-cycleway-overlay')).toBe(true);
    });
  });

  describe('terrain layers', () => {
    it('has hillshade layer', () => {
      const ids = layerIds(defaultLayers);
      expect(ids.has('hillshade')).toBe(true);
    });

    it('has contour line layers', () => {
      const ids = layerIds(defaultLayers);
      expect(ids.has('contour-line')).toBe(true);
      expect(ids.has('contour-line-major')).toBe(true);
    });
  });

  describe('landcover layers include key classes', () => {
    it('forest filter includes wood and orchard', () => {
      const forestLayer = defaultLayers.find((l: any) => l.id === 'landcover-forest');
      expect(forestLayer).toBeDefined();
      const filter = JSON.stringify(forestLayer!.filter);
      expect(filter).toContain('wood');
      expect(filter).toContain('orchard');
    });

    it('park filter includes common, golf_course, pitch', () => {
      const parkLayer = defaultLayers.find((l: any) => l.id === 'landuse-park');
      expect(parkLayer).toBeDefined();
      const filter = JSON.stringify(parkLayer!.filter);
      expect(filter).toContain('common');
      expect(filter).toContain('golf_course');
      expect(filter).toContain('pitch');
    });
  });

  describe('road label layers', () => {
    const ids = layerIds(defaultLayers);

    it('has primary road labels', () => {
      expect(ids.has('label-road-primary')).toBe(true);
    });

    it('has secondary road labels', () => {
      expect(ids.has('label-road-secondary')).toBe(true);
    });
  });
});

describe('buildMapStyle', () => {
  it('produces a valid style object for default variant', () => {
    const style = buildMapStyle(defaultPalette, 'default', 'Test');
    expect(style.version).toBe(8);
    expect(style.name).toBe('Test');
    expect(style.sources).toBeDefined();
    expect(style.sources.outdoors).toBeDefined();
    expect(style.layers.length).toBeGreaterThan(0);
  });

  it('produces a valid style object for HC variant', () => {
    const style = buildMapStyle(hcPalette, 'high-contrast', 'Test HC');
    expect(style.version).toBe(8);
    expect(style.layers.length).toBeGreaterThan(0);
  });
});
