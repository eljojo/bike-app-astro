import { adjustedElevationGainPerKm } from './route-insights';

/**
 * Route difficulty scoring.
 *
 * Philosophy: We're measuring accessibility — how attractive is this route
 * to the average person? A low score means "almost anyone would enjoy this."
 * A high score means "you need to know what you're getting into."
 *
 * This isn't a hardcore cycling metric. It's a human-friendly signal that
 * helps people find routes they'll actually enjoy. The score blends objective
 * data (distance, gradient, surface) with curator judgment (tags like "easy",
 * "family friendly", "hard"). The curator's voice matters — they've ridden
 * these routes and know which ones *feel* approachable vs intimidating,
 * beyond what the numbers say.
 */

/**
 * How psychologically comfortable is this route?
 *
 * This isn't about terrain roughness — it's about perceived safety.
 * Bike paths are guaranteed car-free. Gravel means nature, away from
 * traffic. Road means riding meters from cars, which is the scariest
 * thing for most people. Single track requires technical skill AND
 * remote terrain.
 */
export function surfaceScore(tags: string[]): number {
  if (tags.includes('single track')) return 1.0;
  if (tags.includes('road')) return 0.8;
  if (tags.includes('gravel')) return 0.3;
  if (tags.includes('bike path')) return 0.0;
  return 0.3;
}

/**
 * Rough estimate of ride duration in hours.
 * Not meant to be precise — just captures "is this a morning ride or
 * an all-day affair?" which matters for accessibility.
 */
export function estimatedHours(
  distanceKm: number, elevationGainM: number, surface: number,
): number {
  const baseSpeed = surface > 0.5 ? 16 : 20;
  const climbingHours = (elevationGainM / 100) * (10 / 60);
  return distanceKm / baseSpeed + climbingHours;
}

/**
 * Composite difficulty score.
 *
 * Five factors, each capturing a different aspect of "would the average
 * person enjoy this?":
 *
 * - Duration: "How much of my day is this?" Linear — a 4-hour ride is
 *   genuinely twice the commitment of a 2-hour ride. Primary sort axis.
 * - Climb: Total elevation gain, not per-km. A 90km ride with 400m
 *   total climbing is easier than a 60km ride with 1000m.
 * - Gradient: "Is there a hill that'll kill me?" Even one steep section
 *   makes a route intimidating. Exponential because 15% is terrifying,
 *   7% is manageable.
 * - Surface: Bike paths feel safe; gravel requires confidence
 * - Tags: The curator has ridden these routes. When they say "family
 *   friendly" or "hard", that judgment outweighs the numbers.
 */
export function difficultyScore(input: {
  distanceKm: number;
  elevationGainPerKm: number;
  maxGradientPct: number;
  estimatedHours: number;
  surfaceScore: number;
  tags: string[];
}): number {
  const durationFactor = input.estimatedHours * 4;
  const climbFactor = input.elevationGainPerKm * input.distanceKm / 165;
  const gradientFactor = Math.pow(Math.min(input.maxGradientPct, 20) / 10, 1.5) * 5;
  const surfaceFactor = input.surfaceScore * 3;
  const tagFactor = tagModifier(input.tags);

  const raw = durationFactor + climbFactor + gradientFactor + surfaceFactor + tagFactor;
  return Math.round(Math.max(0, raw) * 10) / 10;
}

function tagModifier(tags: string[]): number {
  let mod = 0;
  if (tags.includes('easy') || tags.includes('family friendly')) mod -= 3;
  if (tags.includes('chill')) mod -= 3;
  if (tags.includes('hard')) mod += 3;
  if (tags.includes('elevation')) mod += 1;
  return mod;
}

/**
 * Score a route's variants. Returns an array of scores (one per variant
 * that has GPX data). Callers can use Math.min for easiest variant or
 * the full array for label ranges.
 */
export function scoreRoute(route: {
  data: {
    distance_km: number;
    tags: string[];
    variants: { gpx: string; distance_km?: number }[];
    gpxTracks: Record<string, {
      elevation_gain_m: number;
      max_gradient_pct: number;
      points: { ele: number }[];
    }>;
  };
}): number[] {
  const scores: number[] = [];
  for (const v of route.data.variants) {
    const track = route.data.gpxTracks[v.gpx];
    if (!track) continue;
    const distKm = v.distance_km || route.data.distance_km;
    const gain = track.elevation_gain_m;
    const points = track.points;
    const startEle = points[0]?.ele ?? 0;
    const endEle = points[points.length - 1]?.ele ?? 0;
    const gainPerKm = adjustedElevationGainPerKm(gain, endEle - startEle, distKm);
    const surface = surfaceScore(route.data.tags);
    const hours = estimatedHours(distKm, gain, surface);
    scores.push(difficultyScore({
      distanceKm: distKm, elevationGainPerKm: gainPerKm,
      maxGradientPct: track.max_gradient_pct, estimatedHours: hours,
      surfaceScore: surface, tags: route.data.tags,
    }));
  }
  return scores;
}

/**
 * Convert a numeric score to a difficulty tier key by comparing it
 * against all scores on the site. Returns a key for use with i18n.
 *
 * The tiers are relative to this city's routes, so "hardest" means
 * "hardest for Ottawa" — not hardest in the world.
 */
export function difficultyLabel(
  score: number, allScores: number[],
): string {
  const sorted = [...allScores].sort((a, b) => a - b);
  const position = sorted.filter(s => s <= score).length / sorted.length;

  if (position <= 0.2) return 'easiest';
  if (position <= 0.4) return 'easy';
  if (position <= 0.6) return 'average';
  if (position <= 0.8) return 'hard';
  return 'hardest';
}
