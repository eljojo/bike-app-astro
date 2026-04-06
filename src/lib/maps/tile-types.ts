export interface TileManifestEntry {
  id: string;
  bounds: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  featureCount: number;
  file: string;
}

/** Metadata baked into each tile feature's properties. */
export interface TileFeatureMeta {
  _geoId: string;
  _fid: string;
  slug: string;
  name: string;
  memberOf: string;
  surface: string;
  hasPage: boolean;
  path_type: string;
  length_km: number;
}
