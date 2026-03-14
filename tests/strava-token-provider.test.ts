import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStravaTokenProvider } from '../src/lib/strava-token-provider';
import type { AppEnv } from '../src/lib/app-env';

// Mock strava-api module
vi.mock('../src/lib/strava-api', () => ({
  refreshToken: vi.fn(),
}));

import { refreshToken } from '../src/lib/strava-api';
const mockRefresh = vi.mocked(refreshToken);

function mockDatabase(rows: any[]) {
  const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }),
    update: updateFn,
    _updateSet: updateSet,
  } as any;
}

const appEnv: AppEnv = {
  STRAVA_CLIENT_ID: 'test-client-id',
  STRAVA_CLIENT_SECRET: 'test-client-secret',
} as any;

describe('createStravaTokenProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no tokens in DB', async () => {
    const db = mockDatabase([]);
    const provider = await createStravaTokenProvider(db, appEnv, 'user-1');
    expect(provider).toBeNull();
  });

  it('returns existing access token when not expired', async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const db = mockDatabase([{
      accessToken: 'valid-token',
      refreshToken: 'refresh-token',
      expiresAt: futureExpiry,
    }]);

    const provider = await createStravaTokenProvider(db, appEnv, 'user-1');
    expect(provider).not.toBeNull();

    const token = await provider!.getAccessToken();
    expect(token).toBe('valid-token');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes token when expiring within 60 seconds', async () => {
    const almostExpired = Math.floor(Date.now() / 1000) + 30; // 30s from now
    const db = mockDatabase([{
      accessToken: 'old-token',
      refreshToken: 'old-refresh',
      expiresAt: almostExpired,
    }]);

    const newExpiry = Math.floor(Date.now() / 1000) + 3600;
    mockRefresh.mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'new-refresh',
      expires_at: newExpiry,
    });

    const provider = await createStravaTokenProvider(db, appEnv, 'user-1');
    const token = await provider!.getAccessToken();

    expect(token).toBe('new-token');
    expect(mockRefresh).toHaveBeenCalledWith('test-client-id', 'test-client-secret', 'old-refresh');
    // Should persist to DB
    expect(db.update).toHaveBeenCalled();
  });

  it('refreshes token when already expired', async () => {
    const expired = Math.floor(Date.now() / 1000) - 100; // 100s ago
    const db = mockDatabase([{
      accessToken: 'expired-token',
      refreshToken: 'refresh-me',
      expiresAt: expired,
    }]);

    mockRefresh.mockResolvedValue({
      access_token: 'fresh-token',
      refresh_token: 'fresh-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });

    const provider = await createStravaTokenProvider(db, appEnv, 'user-1');
    const token = await provider!.getAccessToken();
    expect(token).toBe('fresh-token');
  });

  it('throws when credentials missing during refresh', async () => {
    const expired = Math.floor(Date.now() / 1000) - 100;
    const db = mockDatabase([{
      accessToken: 'old',
      refreshToken: 'old',
      expiresAt: expired,
    }]);

    const noCredsEnv: AppEnv = {} as any;
    const provider = await createStravaTokenProvider(db, noCredsEnv, 'user-1');
    await expect(provider!.getAccessToken()).rejects.toThrow('Strava credentials not configured');
  });

  it('caches refreshed token for subsequent calls', async () => {
    const almostExpired = Math.floor(Date.now() / 1000) + 10;
    const db = mockDatabase([{
      accessToken: 'old',
      refreshToken: 'old-refresh',
      expiresAt: almostExpired,
    }]);

    const futureExpiry = Math.floor(Date.now() / 1000) + 7200;
    mockRefresh.mockResolvedValue({
      access_token: 'refreshed',
      refresh_token: 'new-refresh',
      expires_at: futureExpiry,
    });

    const provider = await createStravaTokenProvider(db, appEnv, 'user-1');

    // First call triggers refresh
    const token1 = await provider!.getAccessToken();
    expect(token1).toBe('refreshed');
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    // Second call should use cached token (expiresAt is far in the future now)
    const token2 = await provider!.getAccessToken();
    expect(token2).toBe('refreshed');
    expect(mockRefresh).toHaveBeenCalledTimes(1); // not called again
  });
});
