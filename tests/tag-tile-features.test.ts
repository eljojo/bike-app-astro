import { describe, it, expect } from 'vitest';
import { tagTileFeatures } from '../src/lib/maps/layers/tile-path-layer';
import type { Feature, LineString } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature<LineString> {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'LineString', coordinates: [[-75.6, 45.4], [-75.5, 45.3]] },
  };
}

describe('tagTileFeatures', () => {
  describe('index mode (non-detail)', () => {
    it('marks features with hasPage:true as interactive', () => {
      // buildTiles injects hasPage as a boolean (see GeoMetaEntry.hasPage: boolean)
      const features = [makeFeature({ _geoId: 'path-1', hasPage: true })];
      tagTileFeatures(features, false);
      expect(features[0].properties!.interactive).toBe('true');
    });

    it('does NOT mark features with hasPage:false as interactive', () => {
      const features = [makeFeature({ _geoId: 'path-1', hasPage: false })];
      tagTileFeatures(features, false);
      expect(features[0].properties!.interactive).toBeUndefined();
    });
  });

  describe('detail mode', () => {
    it('marks highlighted features with highlight property', () => {
      const geoIds = new Set(['path-1']);
      const features = [makeFeature({ _geoId: 'path-1', hasPage: true })];
      tagTileFeatures(features, true, geoIds);
      expect(features[0].properties!.highlight).toBe('true');
    });

    it('marks features with hasPage:true as interactive in detail mode', () => {
      const geoIds = new Set(['other']);
      const features = [makeFeature({ _geoId: 'path-1', hasPage: true })];
      tagTileFeatures(features, true, geoIds);
      expect(features[0].properties!.interactive).toBe('true');
    });
  });
});
