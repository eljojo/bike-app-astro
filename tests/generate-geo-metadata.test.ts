import { describe, it, expect } from 'vitest';

interface PageInput {
  slug: string;
  name: string;
  geoFiles: string[];
  memberOf?: string;
  surface?: string;
  standalone: boolean;
  path_type?: string;
  length_km?: number;
}

interface GeoMetaEntry {
  slug: string;
  name: string;
  memberOf: string;
  surface: string;
  hasPage: boolean;
  path_type: string;
  length_km: number;
}

function buildGeoMetadata(pages: PageInput[]): Record<string, GeoMetaEntry> {
  const metadata: Record<string, GeoMetaEntry> = {};

  for (const page of pages) {
    for (const file of page.geoFiles) {
      const geoId = file.replace(/\.geojson$/, '');
      if (metadata[geoId]) continue; // first-write-wins
      metadata[geoId] = {
        slug: page.slug,
        name: page.name,
        memberOf: page.memberOf ?? '',
        surface: page.surface ?? '',
        hasPage: page.standalone,
        path_type: page.path_type ?? '',
        length_km: page.length_km ?? 0,
      };
    }
  }

  return metadata;
}

describe('buildGeoMetadata', () => {
  it('maps geoId to page metadata correctly (all fields)', () => {
    const pages: PageInput[] = [
      {
        slug: 'ottawa-river-pathway',
        name: 'Ottawa River Pathway',
        geoFiles: ['r123456.geojson'],
        memberOf: 'capital-pathway-network',
        surface: 'paved',
        standalone: true,
        path_type: 'shared-use-path',
        length_km: 12.5,
      },
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

  it('first-write-wins: member page takes priority over network page for shared geoId', () => {
    const memberPage: PageInput = {
      slug: 'rideau-river-pathway',
      name: 'Rideau River Pathway',
      geoFiles: ['r789.geojson'],
      memberOf: 'eastern-pathways',
      surface: 'paved',
      standalone: true,
      path_type: 'shared-use-path',
      length_km: 8.2,
    };
    const networkPage: PageInput = {
      slug: 'eastern-pathways',
      name: 'Eastern Pathways Network',
      geoFiles: ['r789.geojson', 'r101.geojson'],
      standalone: true,
      path_type: 'shared-use-path',
      length_km: 20.0,
    };

    // member appears before network — simulating loadBikePathEntries order
    const result = buildGeoMetadata([memberPage, networkPage]);

    // r789 should be owned by the member, not the network
    expect(result['r789'].slug).toBe('rideau-river-pathway');
    expect(result['r789'].name).toBe('Rideau River Pathway');
    expect(result['r789'].memberOf).toBe('eastern-pathways');

    // r101 is exclusive to the network, so the network owns it
    expect(result['r101'].slug).toBe('eastern-pathways');
  });

  it('defaults missing optional fields to empty string or zero', () => {
    const pages: PageInput[] = [
      {
        slug: 'bare-path',
        name: 'Bare Path',
        geoFiles: ['r999.geojson'],
        standalone: false,
      },
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
    const pages: PageInput[] = [
      {
        slug: 'trans-canada-trail',
        name: 'Trans Canada Trail',
        geoFiles: ['r111.geojson', 'r222.geojson', 'r333.geojson'],
        surface: 'gravel',
        standalone: true,
        path_type: 'shared-use-path',
        length_km: 45.0,
      },
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
