const ELEVATION_KEYS: [number, string][] = [
  [0.05, 'flat'],
  [0.1, 'mostly_flat'],
  [0.2, 'fairly_flat'],
  [0.4, 'average'],
  [0.5, 'above_average'],
  [0.8, 'hard'],
  [0.9, 'very_hard'],
];

export function quantiles(data: number[], probs: number[]): number[] {
  const values = [...data].sort((a, b) => a - b);
  return probs.map(prob => {
    const h = 1 + (values.length - 1) * prob;
    const mod = h % 1;
    return Math.round((1 - mod) * values[Math.floor(h) - 1] + mod * values[Math.ceil(h) - 1]);
  });
}

export function elevationConclusion(elevation: number, allElevations: number[]): string {
  const thresholds = ELEVATION_KEYS.map(([p]) => p);
  const q = quantiles(allElevations, thresholds);
  for (let i = 0; i < q.length; i++) {
    if (q[i] >= elevation) return ELEVATION_KEYS[i][1];
  }
  return ELEVATION_KEYS[ELEVATION_KEYS.length - 1][1];
}

export function elevationTags(elevationGain: number | null, allElevations: number[]): string[] {
  if (elevationGain == null || elevationGain <= 0) return [];
  const [low, high] = quantiles(allElevations, [0.15, 0.85]);
  if (elevationGain <= low) return ['flat'];
  if (elevationGain >= high) return ['elevation'];
  return [];
}

export function getAllElevations(routes: { data: { status: string; variants: { gpx: string }[]; gpxTracks: Record<string, { elevation_gain_m: number } | undefined> } }[]): number[] {
  return routes
    .filter(r => r.data.status === 'published')
    .map(r => {
      const gpx = r.data.variants[0]?.gpx;
      return gpx ? r.data.gpxTracks[gpx]?.elevation_gain_m : null;
    })
    .filter((e): e is number => e != null && e > 0);
}
