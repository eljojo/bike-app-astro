import { describe, it, expect } from 'vitest';
import { buildGeoMetadata, type GeoMetaPage } from '../scripts/generate-geo-metadata';

function makePage(overrides: Partial<GeoMetaPage> & { slug: string; name: string; geoFiles: string[] }): GeoMetaPage {
  return {
    standalone: true,
    ...overrides,
  };
}

describe('buildGeoMetadata', () => {
  it('maps geoId to page metadata correctly (all fields)', () => {
    const pages: GeoMetaPage[] = [
      makePage({
        slug: 'ottawa-river-pathway',
        name: 'Ottawa River Pathway',
        geoFiles: ['r123456.geojson'],
        memberOf: 'capital-pathway-network',
        surface: 'paved',
        standalone: true,
        path_type: 'shared-use-path',
        length_km: 12.5,
      }),
    ];

    const result = buildGeoMetadata(pages);

    expect(result['r123456']).toEqual({
      slug: 'ottawa-river-pathway',
      name: 'Ottawa River Pathway',
      memberOf: 'capital-pathway-network',
      surface: 'paved',
      hasPage: true,
      path_type: 'shared-use-path',
      length_km: 12.5,
    });
  });

  it('member page takes priority over network page for shared geoId (members first order)', () => {
    const memberPage: GeoMetaPage = makePage({
      slug: 'rideau-river-pathway',
      name: 'Rideau River Pathway',
      geoFiles: ['r789.geojson'],
      memberOf: 'eastern-pathways',
      surface: 'paved',
      path_type: 'shared-use-path',
      length_km: 8.2,
    });
    const networkPage: GeoMetaPage = makePage({
      slug: 'eastern-pathways',
      name: 'Eastern Pathways Network',
      geoFiles: ['r789.geojson', 'r101.geojson'],
      path_type: 'shared-use-path',
      length_km: 20.0,
      memberRefs: [{ slug: 'rideau-river-pathway' }],
    });

    const result = buildGeoMetadata([memberPage, networkPage]);

    // r789 should be owned by the member, not the network
    expect(result['r789'].slug).toBe('rideau-river-pathway');
    expect(result['r789'].name).toBe('Rideau River Pathway');
    expect(result['r789'].memberOf).toBe('eastern-pathways');

    // r101 is exclusive to the network, so the network owns it
    expect(result['r101'].slug).toBe('eastern-pathways');
  });

  it('member page STILL wins when the network page appears first in the input order', () => {
    // Regression for the Gatineau Cycling Network bug: markdown-only
    // `includes:` networks are returned by loadBikePathEntries BEFORE
    // their members, so first-write-wins without sorting would claim
    // every member's geoId with the network slug. The tile features
    // would then carry slug='gatineau-cycling-network' instead of
    // slug='sentier-de-lile' etc., and list-item hover/lock on the
    // bikeways tab would match no features and appear broken.
    const memberA: GeoMetaPage = makePage({
      slug: 'sentier-de-lile',
      name: "Sentier de l'Île",
      geoFiles: ['215129.geojson'],
      path_type: 'mup',
      surface: 'asphalt',
    });
    const memberB: GeoMetaPage = makePage({
      slug: 'sentier-du-lac-leamy-pathway',
      name: 'Sentier du Lac Leamy Pathway',
      geoFiles: ['215130.geojson'],
      path_type: 'mup',
      surface: 'asphalt',
    });
    const networkPage: GeoMetaPage = makePage({
      slug: 'gatineau-cycling-network',
      name: 'Gatineau Cycling Network',
      // Network aggregates member geoFiles
      geoFiles: ['215129.geojson', '215130.geojson'],
      path_type: 'mup',
      memberRefs: [{ slug: 'sentier-de-lile' }, { slug: 'sentier-du-lac-leamy-pathway' }],
    });

    // Network appears FIRST — the broken loadBikePathEntries order
    const result = buildGeoMetadata([networkPage, memberA, memberB]);

    expect(result['215129'].slug).toBe('sentier-de-lile');
    expect(result['215129'].name).toBe("Sentier de l'Île");
    expect(result['215130'].slug).toBe('sentier-du-lac-leamy-pathway');
    expect(result['215130'].name).toBe('Sentier du Lac Leamy Pathway');
  });

  it('defaults missing optional fields to empty string or zero', () => {
    const pages: GeoMetaPage[] = [
      makePage({
        slug: 'bare-path',
        name: 'Bare Path',
        geoFiles: ['r999.geojson'],
        standalone: false,
      }),
    ];

    const result = buildGeoMetadata(pages);

    expect(result['r999']).toEqual({
      slug: 'bare-path',
      name: 'Bare Path',
      memberOf: '',
      surface: '',
      hasPage: false,
      path_type: '',
      length_km: 0,
    });
  });

  it('handles pages with multiple geoFiles (all mapped to same slug)', () => {
    const pages: GeoMetaPage[] = [
      makePage({
        slug: 'trans-canada-trail',
        name: 'Trans Canada Trail',
        geoFiles: ['r111.geojson', 'r222.geojson', 'r333.geojson'],
        surface: 'gravel',
        path_type: 'shared-use-path',
        length_km: 45.0,
      }),
    ];

    const result = buildGeoMetadata(pages);

    expect(result['r111'].slug).toBe('trans-canada-trail');
    expect(result['r222'].slug).toBe('trans-canada-trail');
    expect(result['r333'].slug).toBe('trans-canada-trail');
    expect(result['r111'].name).toBe('Trans Canada Trail');
    expect(result['r222'].surface).toBe('gravel');
    expect(result['r333'].length_km).toBe(45.0);
  });

  it('handles empty pages array', () => {
    const result = buildGeoMetadata([]);

    expect(result).toEqual({});
    expect(Object.keys(result)).toHaveLength(0);
  });
});
