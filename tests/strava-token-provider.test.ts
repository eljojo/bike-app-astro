import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AppEnv } from '../src/lib/config/app-env';

// Mock the external Strava API (network boundary — keep mocked)
vi.mock('../src/lib/external/strava-api', () => ({
	refreshToken: vi.fn(),
}));

import { refreshToken } from '../src/lib/external/strava-api';
const mockRefresh = vi.mocked(refreshToken);

const appEnv: AppEnv = {
	STRAVA_CLIENT_ID: 'test-client-id',
	STRAVA_CLIENT_SECRET: 'test-client-secret',
} as any;

describe('createStravaTokenProvider', () => {
	const dbPath = path.join(import.meta.dirname, '.test-strava-token.db');
	let database: any;

	function cleanupDb() {
		for (const ext of ['', '-wal', '-shm']) {
			const f = dbPath + ext;
			if (fs.existsSync(f)) fs.unlinkSync(f);
		}
	}

	beforeEach(async () => {
		vi.clearAllMocks();
		cleanupDb();
		const { createLocalDb } = await import('../src/db/local');
		database = createLocalDb(dbPath);

		// Seed a user (foreign key requirement)
		const { users } = await import('../src/db/schema');
		await database.insert(users).values({
			id: 'user-1', email: 'test@test.com', username: 'testuser', role: 'editor',
			createdAt: new Date().toISOString(),
		});
	});

	afterAll(() => {
		cleanupDb();
	});

	async function seedToken(userId: string, token: { accessToken: string; refreshToken: string; expiresAt: number }) {
		const { stravaTokens } = await import('../src/db/schema');
		await database.insert(stravaTokens).values({
			userId,
			athleteId: '12345',
			accessToken: token.accessToken,
			refreshToken: token.refreshToken,
			expiresAt: token.expiresAt,
		});
	}

	it('returns null when no tokens in DB', async () => {
		const { createStravaTokenProvider } = await import('../src/lib/external/strava-token-provider');
		const provider = await createStravaTokenProvider(database, appEnv, 'user-1');
		expect(provider).toBeNull();
	});

	it('returns existing access token when not expired', async () => {
		const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
		await seedToken('user-1', { accessToken: 'valid-token', refreshToken: 'r', expiresAt: futureExpiry });

		const { createStravaTokenProvider } = await import('../src/lib/external/strava-token-provider');
		const provider = await createStravaTokenProvider(database, appEnv, 'user-1');
		expect(await provider!.getAccessToken()).toBe('valid-token');
		expect(mockRefresh).not.toHaveBeenCalled();
	});

	it('only returns tokens for the requested userId', async () => {
		const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
		await seedToken('user-1', { accessToken: 'user1-token', refreshToken: 'r', expiresAt: futureExpiry });

		const { createStravaTokenProvider } = await import('../src/lib/external/strava-token-provider');
		const provider = await createStravaTokenProvider(database, appEnv, 'user-2');
		expect(provider).toBeNull();
	});

	it('refreshes token when expiring within 60 seconds', async () => {
		const almostExpired = Math.floor(Date.now() / 1000) + 30;
		await seedToken('user-1', { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: almostExpired });

		mockRefresh.mockResolvedValue({
			access_token: 'new-token',
			refresh_token: 'new-refresh',
			expires_at: Math.floor(Date.now() / 1000) + 3600,
		});

		const { createStravaTokenProvider } = await import('../src/lib/external/strava-token-provider');
		const provider = await createStravaTokenProvider(database, appEnv, 'user-1');
		expect(await provider!.getAccessToken()).toBe('new-token');
		expect(mockRefresh).toHaveBeenCalledWith('test-client-id', 'test-client-secret', 'old-refresh');

		// Verify persisted to DB
		const { stravaTokens } = await import('../src/db/schema');
		const { eq } = await import('drizzle-orm');
		const rows = await database.select().from(stravaTokens).where(eq(stravaTokens.userId, 'user-1'));
		expect(rows[0].accessToken).toBe('new-token');
	});

	it('refreshes token when already expired', async () => {
		const expired = Math.floor(Date.now() / 1000) - 100;
		await seedToken('user-1', { accessToken: 'expired-token', refreshToken: 'refresh-me', expiresAt: expired });

		mockRefresh.mockResolvedValue({
			access_token: 'fresh-token',
			refresh_token: 'fresh-refresh',
			expires_at: Math.floor(Date.now() / 1000) + 3600,
		});

		const { createStravaTokenProvider } = await import('../src/lib/external/strava-token-provider');
		const provider = await createStravaTokenProvider(database, appEnv, 'user-1');
		expect(await provider!.getAccessToken()).toBe('fresh-token');
	});

	it('throws when credentials missing during refresh', async () => {
		const expired = Math.floor(Date.now() / 1000) - 100;
		await seedToken('user-1', { accessToken: 'old', refreshToken: 'old', expiresAt: expired });

		const { createStravaTokenProvider } = await import('../src/lib/external/strava-token-provider');
		const provider = await createStravaTokenProvider(database, {} as any, 'user-1');
		await expect(provider!.getAccessToken()).rejects.toThrow('Strava credentials not configured');
	});

	it('caches refreshed token for subsequent calls', async () => {
		const almostExpired = Math.floor(Date.now() / 1000) + 10;
		await seedToken('user-1', { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: almostExpired });

		mockRefresh.mockResolvedValue({
			access_token: 'refreshed',
			refresh_token: 'new-refresh',
			expires_at: Math.floor(Date.now() / 1000) + 7200,
		});

		const { createStravaTokenProvider } = await import('../src/lib/external/strava-token-provider');
		const provider = await createStravaTokenProvider(database, appEnv, 'user-1');

		expect(await provider!.getAccessToken()).toBe('refreshed');
		expect(mockRefresh).toHaveBeenCalledTimes(1);
		expect(await provider!.getAccessToken()).toBe('refreshed');
		expect(mockRefresh).toHaveBeenCalledTimes(1);
	});
});
