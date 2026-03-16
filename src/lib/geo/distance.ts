function roundTo5(km: number): number {
  return Math.round(km / 5) * 5;
}

export function formatDistance(distances_km: number[]): string {
  if (distances_km.length === 0) return '';

  const min = Math.min(...distances_km);
  const max = Math.max(...distances_km);

  if (max - min > 5) {
    return `${roundTo5(min)}-${roundTo5(max)} km`;
  }
  return `${roundTo5(min)} km`;
}
