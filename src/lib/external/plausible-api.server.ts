/**
 * Plausible Stats API v2 client.
 * Vendor isolation: all Plausible HTTP calls go through this file.
 * See: https://plausible.io/docs/stats-api
 */

export interface PlausibleRow {
  dimensions: string[];
  metrics: number[];
}

export interface PlausibleQueryResult {
  results: PlausibleRow[];
  meta: Record<string, unknown>;
  query: Record<string, unknown>;
}

/** Parse a Plausible API response — extracts the results array. */
export function parsePlausibleResponse(response: PlausibleQueryResult): PlausibleRow[] {
  return response.results;
}

interface PlausibleQueryParams {
  siteId: string;
  metrics: string[];
  dateRange: string | [string, string];
  dimensions?: string[];
  filters?: unknown[];
  pagination?: { limit: number; offset?: number };
}

/** Build a Plausible Stats API v2 query request body. */
export function buildQueryBody(params: PlausibleQueryParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    site_id: params.siteId,
    metrics: params.metrics,
    date_range: params.dateRange,
  };
  if (params.dimensions) body.dimensions = params.dimensions;
  if (params.filters?.length) body.filters = params.filters;
  if (params.pagination) body.pagination = params.pagination;
  return body;
}

/**
 * Execute a query against the Plausible Stats API.
 * Handles rate limiting with exponential backoff (max 3 retries).
 */
export async function queryPlausible(
  apiKey: string,
  params: PlausibleQueryParams,
): Promise<PlausibleRow[]> {
  const body = buildQueryBody(params);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }

    const response = await fetch('https://plausible.io/api/v2/query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      lastError = new Error(`Plausible API rate limited (attempt ${attempt + 1}/3)`);
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Plausible API error ${response.status}: ${text}`);
    }

    const data = await response.json() as PlausibleQueryResult;
    return parsePlausibleResponse(data);
  }

  throw lastError ?? new Error('Plausible API request failed');
}
