import type { APIContext } from 'astro';
import { eq, and, gt, lt, sql } from 'drizzle-orm';
import { credentials, sessions, users, userSettings } from '../../db/schema';
import type { Database, DbClient } from '../../db';
import type { AppEnv } from '../config/app-env';

export interface SessionUser {
  id: string;
  email: string | null;
  username: string;
  role: 'admin' | 'editor' | 'guest';
  bannedAt: string | null;
  emailInCommits: boolean;
  analyticsOptOut: boolean;
  emailVerified: boolean;
  hasPasskey: boolean;
}

export const ANONYMOUS_USER: SessionUser = Object.freeze({
  id: '',
  username: '',
  email: null,
  role: 'guest',
  bannedAt: null,
  emailInCommits: false,
  analyticsOptOut: false,
  emailVerified: false,
  hasPasskey: false,
});

export interface WebAuthnConfig {
  rpID: string;
  rpName: string;
  origin: string;
}

/** Get user from locals if authenticated, undefined otherwise. For public endpoints with optional personalization. */
export function getOptionalUser(locals: APIContext['locals']): SessionUser | undefined {
  return (locals as unknown as Record<string, unknown>).user as SessionUser | undefined;
}

/** Normalize email for storage and lookup: lowercase, trim whitespace. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Look up a user by email (if identifier contains @) or username (otherwise). */
export async function findUserByIdentifier(database: Database, identifier: string) {
  if (identifier.includes('@')) {
    const email = normalizeEmail(identifier);
    const result = await database
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0] ?? null;
  }

  const { sanitizeUsername } = await import('../username');
  const username = sanitizeUsername(identifier);
  const result = await database
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return result[0] ?? null;
}

/** Generate a random hex string of the given byte length. */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a random ID (16-byte hex). */
export function generateId(): string {
  return randomHex(16);
}

const DEFAULT_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Build session write statements for batch/sequential execution.
 * Returns a fresh token and the required DB statements.
 */
export function buildSessionBatch(
  db: DbClient,
  userId: string,
  opts: { revokeToken?: string; durationMs?: number } = {},
): { token: string; statements: unknown[] } {
  const durationMs = opts.durationMs ?? DEFAULT_SESSION_DURATION_MS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMs);
  const token = randomHex(32);

  const statements: unknown[] = [
    db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())),
  ];

  if (opts.revokeToken) {
    statements.push(db.delete(sessions).where(eq(sessions.token, opts.revokeToken)));
  }

  statements.push(
    db.insert(sessions).values({
      id: generateId(),
      userId,
      token,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    }),
  );

  return { token, statements };
}

export function buildCredentialInsert(
  database: DbClient,
  userId: string,
  credential: { id: string; publicKey: Uint8Array | ArrayBuffer; counter: number },
  transports?: string[],
  createdAt: string = new Date().toISOString(),
): unknown {
  const keyBytes = credential.publicKey instanceof Uint8Array
    ? credential.publicKey
    : new Uint8Array(credential.publicKey);
  return database.insert(credentials).values({
    id: generateId(),
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(keyBytes),
    counter: credential.counter,
    transports: transports ? JSON.stringify(transports) : null,
    createdAt,
  });
}

/** Create a new session for a user, returning the token. Also cleans up expired sessions. */
export async function createSession(db: DbClient, userId: string): Promise<string> {
  const { token, statements } = buildSessionBatch(db, userId);
  for (const statement of statements) {
    await statement;
  }

  return token;
}

/** Validate a session token. Returns the user if valid, null otherwise. */
export async function validateSession(db: Database, token: string): Promise<SessionUser | null> {
  const result = await db
    .select({
      userId: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      bannedAt: users.bannedAt,
      emailVerified: users.emailVerified,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.token, token),
        gt(sessions.expiresAt, new Date().toISOString())
      )
    )
    .limit(1);

  if (result.length === 0) return null;

  const row = result[0];

  // Fetch settings separately to avoid LEFT JOIN issues with WAL mode
  const settings = await db
    .select({
      emailInCommits: userSettings.emailInCommits,
      analyticsOptOut: userSettings.analyticsOptOut,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, row.userId))
    .limit(1);

  // Count credentials separately (same pattern as settings — avoids LEFT JOIN with WAL mode)
  const credentialCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(credentials)
    .where(eq(credentials.userId, row.userId));

  const hasPasskey = (credentialCount[0]?.count ?? 0) > 0;

  const s = settings[0];
  return {
    id: row.userId,
    email: row.email,
    username: row.username,
    role: row.role as SessionUser['role'],
    bannedAt: row.bannedAt,
    emailInCommits: s?.emailInCommits ?? false,
    analyticsOptOut: s?.analyticsOptOut ?? false,
    emailVerified: Boolean(row.emailVerified),
    hasPasskey,
  };
}

/** Destroy a session by token. */
export async function destroySession(db: DbClient, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

/** Get WebAuthn relying party configuration, derived from the request URL.
 *  Env vars WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, WEBAUTHN_ORIGIN override if set. */
export function getWebAuthnConfig(requestUrl: string, env: Partial<AppEnv> = {}): WebAuthnConfig {
  const url = new URL(requestUrl);
  return {
    rpID: env.WEBAUTHN_RP_ID || url.hostname,
    rpName: env.WEBAUTHN_RP_NAME || 'whereto-bike',
    origin: env.WEBAUTHN_ORIGIN || url.origin,
  };
}

const DEFAULT_SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

/** Set session cookies on a response. */
export function setSessionCookies(
  cookies: AstroCookies,
  token: string,
  maxAge: number = DEFAULT_SESSION_MAX_AGE,
): void {
  cookies.set('session_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  cookies.set('logged_in', '1', {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

/** Clear session cookies. */
export function clearSessionCookies(cookies: AstroCookies): void {
  cookies.delete('session_token', { path: '/' });
  cookies.delete('logged_in', { path: '/' });
}

/** Store a WebAuthn challenge in a short-lived httpOnly cookie. */
export function storeChallenge(cookies: AstroCookies, challenge: string): void {
  cookies.set('webauthn_challenge', challenge, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 300, // 5 minutes
  });
}

/** Retrieve and consume a stored WebAuthn challenge from cookie. */
export function retrieveChallenge(cookies: AstroCookies): string | null {
  const challenge = cookies.get('webauthn_challenge')?.value || null;
  if (challenge) {
    cookies.delete('webauthn_challenge', { path: '/' });
  }
  return challenge;
}

/** Check if the users table is empty (for /setup flow). */
export async function isFirstUser(db: Database): Promise<boolean> {
  const result = await db.select({ id: users.id }).from(users).limit(1);
  return result.length === 0;
}

/** Require an authenticated user. Throws if not logged in. */
export function requireUser(user: SessionUser | null | undefined): SessionUser {
  if (!user) throw new Error('Unauthorized');
  return user;
}

/** Require an admin user. Throws if not admin. */
export function requireAdmin(user: SessionUser | null | undefined): SessionUser {
  const u = requireUser(user);
  if (u.role !== 'admin') throw new Error('Admin access required');
  return u;
}

/** Store a WebAuthn credential for a user. */
export async function storeCredential(
  database: DbClient,
  userId: string,
  credential: { id: string; publicKey: Uint8Array | ArrayBuffer; counter: number },
  transports?: string[],
): Promise<void> {
  await buildCredentialInsert(database, userId, credential, transports);
}

/** Create session and set cookies in one call. */
export async function createSessionWithCookies(
  database: DbClient,
  userId: string,
  cookies: AstroCookies,
  opts: { durationMs?: number; maxAge?: number } = {},
): Promise<string> {
  const { token, statements } = buildSessionBatch(database, userId, { durationMs: opts.durationMs });
  for (const statement of statements) {
    await statement;
  }
  setSessionCookies(cookies, token, opts.maxAge);
  return token;
}

// Re-export AstroCookies type reference for use in auth.ts
// The actual type comes from astro at runtime
type AstroCookies = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string, options?: Record<string, unknown>): void;
};
