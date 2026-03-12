export function formatDistance(km: number, decimals = 0): string {
  return `${km.toFixed(decimals)} km`;
}

export function formatElevation(meters: number): string {
  return `${Math.round(meters)} m`;
}

export function formatSpeed(kmh: number, decimals = 1): string {
  return `${kmh.toFixed(decimals)} km/h`;
}
