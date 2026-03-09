const THUNDERFOREST_BASE = 'https://api.thunderforest.com';

export function buildThunderforestUrl(path: string, apiKey: string): string {
  return `${THUNDERFOREST_BASE}/${path}?apikey=${apiKey}`;
}

export function contentTypeForPath(path: string): string {
  if (path.endsWith('.pbf')) return 'application/x-protobuf';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
