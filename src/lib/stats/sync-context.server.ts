/**
 * Shared sync context builder for stats API endpoints.
 * Loads API key, city config, redirects — everything the sync functions need.
 */
import { env } from '../env/env.service';
import { CITY } from '../config/config';
import { getCityConfig } from '../config/city-config';
import routeRedirects from 'virtual:bike-app/route-redirects';

export interface SyncContext {
  apiKey: string;
  siteId: string;
  city: string;
  locales: string[];
  defaultLocale: string;
  redirects: Record<string, string>;
}

/**
 * Build the sync context from env + city config + build-time redirects.
 * Returns null if PLAUSIBLE_API_KEY is not set (local dev without API key).
 */
export async function buildSyncContext(_baseUrl: string): Promise<SyncContext | null> {
  const apiKey = env.PLAUSIBLE_API_KEY;
  if (!apiKey) return null;

  const cityConfig = getCityConfig();

  return {
    apiKey,
    siteId: cityConfig.plausible_domain,
    city: CITY,
    locales: cityConfig.locales ?? [cityConfig.locale],
    defaultLocale: cityConfig.locale,
    redirects: routeRedirects,
  };
}
