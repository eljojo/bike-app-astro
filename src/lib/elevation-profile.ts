interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number;
}

export interface ElevationProfileData {
  svgPath: string;
  svgArea: string;
  minEle: number;
  maxEle: number;
  elevGain: number;
  distanceKm: string;
}

const SVG_WIDTH = 800;
const SVG_HEIGHT = 150;
const PADDING = 2;
const MAX_SAMPLES = 200;

export function computeElevationProfile(points: GpxPoint[], distance_m: number): ElevationProfileData {
  const step = Math.max(1, Math.floor(points.length / MAX_SAMPLES));
  const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  const elevations = sampled.map(p => p.ele ?? 0);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  const eleRange = maxEle - minEle || 1;

  const svgPath = sampled.map((p, i) => {
    const x = PADDING + (i / (sampled.length - 1)) * (SVG_WIDTH - 2 * PADDING);
    const y = SVG_HEIGHT - PADDING - ((((p.ele ?? 0) - minEle) / eleRange) * (SVG_HEIGHT - 2 * PADDING));
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const svgArea = svgPath
    + ` L${(SVG_WIDTH - PADDING).toFixed(1)},${SVG_HEIGHT - PADDING}`
    + ` L${PADDING},${SVG_HEIGHT - PADDING} Z`;

  const elevGain = sampled.reduce((gain, p, i) => {
    if (i === 0) return 0;
    const prev = sampled[i - 1].ele ?? 0;
    const curr = p.ele ?? 0;
    return gain + (curr > prev ? curr - prev : 0);
  }, 0);

  return {
    svgPath,
    svgArea,
    minEle: Math.round(minEle),
    maxEle: Math.round(maxEle),
    elevGain: Math.round(elevGain),
    distanceKm: (distance_m / 1000).toFixed(1),
  };
}
