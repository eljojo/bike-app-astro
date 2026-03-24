/**
 * Shared magic-link email helper.
 * Generates a token, stores it in the emailTokens table, and sends the email.
 */

import { emailTokens } from '../../db/schema';
import { generateId } from './auth';
import { createEmailService } from '../external/email';
import { getCityConfig } from '../config/city-config';
import { env } from '../env/env.service';
import type { Database } from '../../db';

const TOKEN_EXPIRY_MINUTES = 15;

function generateToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Send a magic-link email for authentication.
 *
 * @param database - DB connection for storing the token
 * @param email - recipient email (already normalized)
 * @param userId - user ID to associate with the token (null for unregistered emails)
 * @param origin - URL origin for building the verify link
 */
export async function sendMagicLinkEmail(
  database: Database,
  email: string,
  userId: string | null,
  origin: string,
): Promise<void> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

  await database.insert(emailTokens).values({
    id: generateId(),
    userId,
    email,
    token,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });

  const magicLink = `${origin}/auth/verify?token=${token}`;

  const config = getCityConfig();
  const emailService = createEmailService(env);
  await emailService.send(
    email,
    `Sign in to ${config.display_name}`,
    `Click this link to sign in:\n\n${magicLink}\n\nThis link expires in ${TOKEN_EXPIRY_MINUTES} minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
  );
}
