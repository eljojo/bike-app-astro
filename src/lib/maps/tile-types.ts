export interface TileManifestEntry {
  id: string;
  bounds: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  featureCount: number;
  file: string;
}
