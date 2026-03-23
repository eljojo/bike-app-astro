/**
 * Shared sync context builder for stats API endpoints.
 * Loads API key, city config, redirects — everything the sync functions need.
 */
import { env } from '../env/env.service';
import { CITY } from '../config/config';
import { getCityConfig } from '../config/city-config';
import { fetchJson } from '../content/load-admin-content.server';

export interface SyncContext {
  apiKey: string;
  siteId: string;
  city: string;
  locales: string[];
  defaultLocale: string;
  redirects: Record<string, string>;
}

/**
 * Build the sync context from env + city config + prerendered redirects.
 * Returns null if PLAUSIBLE_API_KEY is not set (local dev without API key).
 *
 * @param baseUrl - The request URL origin, used for ASSETS.fetch of redirects.json
 */
export async function buildSyncContext(baseUrl: string): Promise<SyncContext | null> {
  const apiKey = env.PLAUSIBLE_API_KEY;
  if (!apiKey) return null;

  const cityConfig = getCityConfig();

  let redirects: Record<string, string> = {};
  try {
    const raw = await fetchJson<Record<string, string>>(new URL('/admin/data/redirects.json', baseUrl));
    redirects = raw;
    console.log(`buildSyncContext: loaded ${Object.keys(redirects).length} redirects, sample: ${JSON.stringify(Object.entries(redirects).slice(0, 2))}`);
  } catch (err) {
    console.error('buildSyncContext: FAILED to load redirects.json:', err);
  }

  return {
    apiKey,
    siteId: cityConfig.plausible_domain,
    city: CITY,
    locales: cityConfig.locales ?? [cityConfig.locale],
    defaultLocale: cityConfig.locale,
    redirects,
  };
}
