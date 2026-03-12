import { eq } from 'drizzle-orm';
import { stravaTokens } from '../db/schema';
import { refreshToken } from './strava-api';
import type { AppEnv } from './app-env';
import type { Database } from '../db';

/**
 * Create a token provider that reads Strava tokens from D1 and refreshes
 * automatically when expired. Returns null if no tokens are stored.
 */
export async function createStravaTokenProvider(
  database: Database,
  appEnv: AppEnv,
): Promise<{ getAccessToken: () => Promise<string> } | null> {
  const rows = await database.select().from(stravaTokens).where(eq(stravaTokens.id, 1));
  if (rows.length === 0) return null;

  let { accessToken, refreshToken: refreshTokenValue, expiresAt } = rows[0];

  return {
    async getAccessToken(): Promise<string> {
      const now = Math.floor(Date.now() / 1000);
      // Refresh if expiring within 60 seconds
      if (expiresAt - now < 60) {
        if (!appEnv.STRAVA_CLIENT_ID || !appEnv.STRAVA_CLIENT_SECRET) {
          throw new Error('Strava credentials not configured');
        }
        const result = await refreshToken(appEnv.STRAVA_CLIENT_ID, appEnv.STRAVA_CLIENT_SECRET, refreshTokenValue);
        accessToken = result.access_token;
        refreshTokenValue = result.refresh_token;
        expiresAt = result.expires_at;

        // Persist refreshed tokens
        await database
          .update(stravaTokens)
          .set({
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            expiresAt: result.expires_at,
          })
          .where(eq(stravaTokens.id, 1));
      }
      return accessToken;
    },
  };
}
