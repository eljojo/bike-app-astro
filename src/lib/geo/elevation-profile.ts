interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number;
}

const MAX_SAMPLES = 200;

export interface ElevationPoint {
  km: number;
  ele: number;
  lat: number;
  lng: number;
}

/** Downsample GPX points to ~200 samples with computed km position. Used by interactive elevation chart. */
export function computeElevationPoints(points: GpxPoint[], distance_m: number): ElevationPoint[] {
  const step = Math.max(1, Math.floor(points.length / MAX_SAMPLES));
  const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const distKm = distance_m / 1000;
  return sampled.map((p, i) => ({
    km: sampled.length > 1 ? (i / (sampled.length - 1)) * distKm : 0,
    ele: p.ele ?? 0,
    lat: p.lat,
    lng: p.lon,
  }));
}
