import { eq, and, gt, isNull, lt } from 'drizzle-orm';
import { sessions, users, inviteCodes } from '../db/schema';
import type { Database } from '../db';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'editor';
}

export interface WebAuthnConfig {
  rpID: string;
  rpName: string;
  origin: string;
}

/** Normalize email for storage and lookup: lowercase, trim whitespace. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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

/** Create a new session for a user, returning the token. Also cleans up expired sessions. */
export async function createSession(db: Database, userId: string): Promise<string> {
  const token = randomHex(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Clean up expired sessions (fire-and-forget, don't block login)
  await db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString()));

  await db.insert(sessions).values({
    id: generateId(),
    userId,
    token,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });

  return token;
}

/** Validate a session token. Returns the user if valid, null otherwise. */
export async function validateSession(db: Database, token: string): Promise<SessionUser | null> {
  const result = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
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
  return {
    id: row.userId,
    email: row.email,
    displayName: row.displayName,
    role: row.role as 'admin' | 'editor',
  };
}

/** Destroy a session by token. */
export async function destroySession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

/** Get WebAuthn relying party configuration, derived from the request URL.
 *  Env vars WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, WEBAUTHN_ORIGIN override if set. */
export function getWebAuthnConfig(requestUrl: string, env: Record<string, string> = {}): WebAuthnConfig {
  const url = new URL(requestUrl);
  return {
    rpID: env.WEBAUTHN_RP_ID || url.hostname,
    rpName: env.WEBAUTHN_RP_NAME || 'whereto-bike',
    origin: env.WEBAUTHN_ORIGIN || url.origin,
  };
}

const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

/** Set session cookies on a response. */
export function setSessionCookies(
  cookies: AstroCookies,
  token: string
): void {
  cookies.set('session_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  cookies.set('logged_in', '1', {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
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

/** Validate an invite code. Returns the invite code record if valid, null otherwise. */
export async function validateInviteCode(
  db: Database,
  code: string
): Promise<{ id: string; createdBy: string } | null> {
  const result = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.code, code))
    .limit(1);

  if (result.length === 0) return null;

  const invite = result[0];
  if (invite.usedBy) return null;
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) return null;

  return { id: invite.id, createdBy: invite.createdBy };
}

/** Atomically mark an invite code as used. Returns false if already claimed. */
export async function markInviteCodeUsed(
  db: Database,
  inviteId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .update(inviteCodes)
    .set({ usedBy: userId })
    .where(and(eq(inviteCodes.id, inviteId), isNull(inviteCodes.usedBy)));
  return (result as any).rowsAffected === 1;
}

/** Check if the users table is empty (for /setup flow). */
export async function isFirstUser(db: Database): Promise<boolean> {
  const result = await db.select({ id: users.id }).from(users).limit(1);
  return result.length === 0;
}

// Re-export AstroCookies type reference for use in auth.ts
// The actual type comes from astro at runtime
type AstroCookies = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string, options?: Record<string, unknown>): void;
};
