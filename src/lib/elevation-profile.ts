interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number;
}

export interface AxisTick {
  value: number;
  label: string;
  position: number; // SVG coordinate
}

export interface ElevationProfileData {
  svgPath: string;
  svgArea: string;
  minEle: number;
  maxEle: number;
  elevGain: number;
  distanceKm: string;
  yTicks: AxisTick[];
  xTicks: AxisTick[];
}

const SVG_WIDTH = 800;
const SVG_HEIGHT = 200;
const LEFT_PAD = 50;
const RIGHT_PAD = 10;
const TOP_PAD = 10;
const BOTTOM_PAD = 25;
const MAX_SAMPLES = 200;

export const CHART = { width: SVG_WIDTH, height: SVG_HEIGHT, left: LEFT_PAD, right: RIGHT_PAD, top: TOP_PAD, bottom: BOTTOM_PAD } as const;

function niceStep(range: number, targetTicks: number): number {
  const rough = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm <= 1.5) return mag;
  if (norm <= 3.5) return 2 * mag;
  if (norm <= 7.5) return 5 * mag;
  return 10 * mag;
}

export function computeElevationProfile(points: GpxPoint[], distance_m: number): ElevationProfileData {
  const step = Math.max(1, Math.floor(points.length / MAX_SAMPLES));
  const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  const elevations = sampled.map(p => p.ele ?? 0);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  const eleRange = maxEle - minEle || 1;

  const plotLeft = LEFT_PAD;
  const plotRight = SVG_WIDTH - RIGHT_PAD;
  const plotTop = TOP_PAD;
  const plotBottom = SVG_HEIGHT - BOTTOM_PAD;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const svgPath = sampled.map((p, i) => {
    const x = plotLeft + (i / (sampled.length - 1)) * plotW;
    const y = plotBottom - (((p.ele ?? 0) - minEle) / eleRange) * plotH;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const svgArea = svgPath
    + ` L${plotRight.toFixed(1)},${plotBottom}`
    + ` L${plotLeft},${plotBottom} Z`;

  const elevGain = sampled.reduce((gain, p, i) => {
    if (i === 0) return 0;
    const prev = sampled[i - 1].ele ?? 0;
    const curr = p.ele ?? 0;
    return gain + (curr > prev ? curr - prev : 0);
  }, 0);

  // Y-axis ticks (elevation)
  const yStep = niceStep(eleRange, 4);
  const yStart = Math.ceil(minEle / yStep) * yStep;
  const yTicks: AxisTick[] = [];
  for (let v = yStart; v <= maxEle; v += yStep) {
    const position = plotBottom - ((v - minEle) / eleRange) * plotH;
    yTicks.push({ value: v, label: `${Math.round(v)}m`, position });
  }

  // X-axis ticks (distance)
  const distKm = distance_m / 1000;
  const xStep = niceStep(distKm, 5);
  const xTicks: AxisTick[] = [];
  for (let v = 0; v <= distKm; v += xStep) {
    const position = plotLeft + (v / distKm) * plotW;
    xTicks.push({ value: v, label: `${v}`, position });
  }

  return {
    svgPath,
    svgArea,
    minEle: Math.round(minEle),
    maxEle: Math.round(maxEle),
    elevGain: Math.round(elevGain),
    distanceKm: distKm.toFixed(1),
    yTicks,
    xTicks,
  };
}
